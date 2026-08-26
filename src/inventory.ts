import { z } from 'zod';
import type { AccountingDB } from './db';
import { db } from './db';
import type { ProjectionPeriod } from './accountingProjections';
import { TransactionType } from './models';

export const INVENTORY_QUANTITY_SCALE = 1_000 as const;

export const InventoryDirection = {
  IN: 'IN',
  OUT: 'OUT',
} as const;
export type InventoryDirection = typeof InventoryDirection[keyof typeof InventoryDirection];

export const InventoryItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const InventoryOpeningSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().uuid(),
  effectiveDate: z.number().int().nonnegative(),
  quantityMilli: z.number().int().nonnegative(),
  unitCostVnd: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type InventoryOpening = z.infer<typeof InventoryOpeningSchema>;

export const InventoryMovementSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  date: z.number().int().nonnegative(),
  direction: z.nativeEnum(InventoryDirection),
  quantityMilli: z.number().int().positive(),
  unitCostVnd: z.number().int().nonnegative(),
  transactionId: z.string().uuid().optional(),
  documentNumber: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  reversalOfMovementId: z.string().uuid().optional(),
  status: z.enum(['POSTED', 'REVERSED']).default('POSTED'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type InventoryMovement = z.infer<typeof InventoryMovementSchema>;

export interface InventoryS2cIssue {
  code:
    | 'MISSING_OPENING'
    | 'OPENING_AFTER_PERIOD_START'
    | 'MISSING_ITEM'
    | 'MISSING_DOCUMENT_NUMBER'
    | 'NEGATIVE_QUANTITY'
    | 'NEGATIVE_VALUE';
  message: string;
  itemId?: string;
  movementId?: string;
}

export interface InventoryS2cRow {
  movementId: string;
  transactionId?: string;
  date: number;
  documentNumber?: string;
  description?: string;
  direction: InventoryDirection;
  quantityMilli: number;
  unitCostVnd: number;
  valueVnd: number;
  quantityBalanceMilli: number;
  valueBalanceVnd: number;
}

export interface InventoryS2cSection {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  openingQuantityMilli: number;
  openingValueVnd: number;
  rows: readonly InventoryS2cRow[];
  inboundQuantityMilli: number;
  inboundValueVnd: number;
  outboundQuantityMilli: number;
  outboundValueVnd: number;
  closingQuantityMilli: number;
  closingValueVnd: number;
}

export interface InventoryS2cBook {
  code: 'S2c-DNSN';
  status: 'IMPLEMENTED' | 'PARTIAL';
  issues: readonly InventoryS2cIssue[];
  sections: readonly InventoryS2cSection[];
}

export interface ProjectInventoryS2cInput {
  items: readonly InventoryItem[];
  openings: readonly InventoryOpening[];
  movements: readonly InventoryMovement[];
  period: ProjectionPeriod;
}

export interface CreateInventoryItemInput {
  code: string;
  name: string;
  unit: string;
  openingEffectiveDate: number;
  openingQuantityMilli: number;
  openingUnitCostVnd: number;
}

export interface PostInventoryMovementInput {
  itemId: string;
  date: number;
  direction: InventoryDirection;
  quantityMilli: number;
  unitCostVnd: number;
  transactionId?: string;
  documentNumber?: string;
  description?: string;
}

export function inventoryOpeningId(itemId: string): string {
  return `inventory-opening:${itemId}`;
}

export function parseInventoryQuantityToMilli(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error('Số lượng phải không âm và có tối đa 3 chữ số thập phân.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const result = Number(whole) * INVENTORY_QUANTITY_SCALE + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Số lượng vượt phạm vi an toàn.');
  return result;
}

export function formatInventoryQuantity(quantityMilli: number): string {
  if (!Number.isSafeInteger(quantityMilli)) throw new Error('Inventory quantity must be a safe integer');
  const sign = quantityMilli < 0 ? '-' : '';
  const absolute = Math.abs(quantityMilli);
  const whole = Math.floor(absolute / INVENTORY_QUANTITY_SCALE);
  const fraction = String(absolute % INVENTORY_QUANTITY_SCALE).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function inventoryLineValueVnd(quantityMilli: number, unitCostVnd: number): number {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
    throw new Error('Inventory quantity must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(unitCostVnd) || unitCostVnd < 0) {
    throw new Error('Inventory unit cost must be a non-negative safe VND integer');
  }
  const numerator = BigInt(quantityMilli) * BigInt(unitCostVnd);
  const rounded = (numerator + 500n) / 1000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Inventory line value exceeds safe VND integer range');
  }
  return Number(rounded);
}

function addSafe(current: number, delta: number, label: string): number {
  const next = current + delta;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe integer range`);
  return next;
}

function signedMovement(movement: InventoryMovement): { quantity: number; value: number } {
  const value = inventoryLineValueVnd(movement.quantityMilli, movement.unitCostVnd);
  const sign = movement.direction === InventoryDirection.IN ? 1 : -1;
  return { quantity: sign * movement.quantityMilli, value: sign * value };
}

export function projectInventoryS2c(input: ProjectInventoryS2cInput): InventoryS2cBook {
  const issues: InventoryS2cIssue[] = [];
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const openingByItem = new Map<string, InventoryOpening>();
  for (const opening of input.openings) {
    if (!itemsById.has(opening.itemId)) {
      issues.push({ code: 'MISSING_ITEM', message: `Inventory opening references missing item ${opening.itemId}`, itemId: opening.itemId });
      continue;
    }
    if (openingByItem.has(opening.itemId)) throw new Error(`Duplicate inventory opening for item ${opening.itemId}`);
    openingByItem.set(opening.itemId, opening);
  }

  const movementsByItem = new Map<string, InventoryMovement[]>();
  for (const movement of input.movements) {
    if (!itemsById.has(movement.itemId)) {
      issues.push({ code: 'MISSING_ITEM', message: `Inventory movement references missing item ${movement.itemId}`, itemId: movement.itemId, movementId: movement.id });
      continue;
    }
    const list = movementsByItem.get(movement.itemId) ?? [];
    list.push(movement);
    movementsByItem.set(movement.itemId, list);
  }

  const relevantIds = new Set<string>();
  for (const item of input.items) {
    const opening = openingByItem.get(item.id);
    const movements = movementsByItem.get(item.id) ?? [];
    if ((opening && opening.effectiveDate <= input.period.end) || movements.some((m) => m.date <= input.period.end)) {
      relevantIds.add(item.id);
    }
  }

  const sections: InventoryS2cSection[] = [];
  for (const itemId of [...relevantIds].sort((a, b) => {
    const left = itemsById.get(a)!;
    const right = itemsById.get(b)!;
    return left.code.localeCompare(right.code) || a.localeCompare(b);
  })) {
    const item = itemsById.get(itemId)!;
    const opening = openingByItem.get(itemId);
    if (!opening) {
      issues.push({ code: 'MISSING_OPENING', message: `S2c requires an explicit opening position for item ${item.code}`, itemId });
      continue;
    }
    if (opening.effectiveDate > input.period.start) {
      issues.push({ code: 'OPENING_AFTER_PERIOD_START', message: `Opening for item ${item.code} starts after the reporting period begins`, itemId });
      continue;
    }

    let quantityBalance = opening.quantityMilli;
    let valueBalance = inventoryLineValueVnd(opening.quantityMilli, opening.unitCostVnd);
    const sorted = (movementsByItem.get(itemId) ?? [])
      .slice()
      .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));

    for (const movement of sorted) {
      if (movement.date >= input.period.start) break;
      const signed = signedMovement(movement);
      quantityBalance = addSafe(quantityBalance, signed.quantity, 'Inventory opening quantity');
      valueBalance = addSafe(valueBalance, signed.value, 'Inventory opening value');
      if (quantityBalance < 0) issues.push({ code: 'NEGATIVE_QUANTITY', message: `Item ${item.code} has negative quantity before period start`, itemId, movementId: movement.id });
      if (valueBalance < 0) issues.push({ code: 'NEGATIVE_VALUE', message: `Item ${item.code} has negative inventory value before period start`, itemId, movementId: movement.id });
    }

    const openingQuantityMilli = quantityBalance;
    const openingValueVnd = valueBalance;
    let inboundQuantityMilli = 0;
    let inboundValueVnd = 0;
    let outboundQuantityMilli = 0;
    let outboundValueVnd = 0;
    const rows: InventoryS2cRow[] = [];

    for (const movement of sorted) {
      if (movement.date < input.period.start || movement.date > input.period.end) continue;
      if (!movement.documentNumber) {
        issues.push({ code: 'MISSING_DOCUMENT_NUMBER', message: `S2c movement for item ${item.code} requires a document number`, itemId, movementId: movement.id });
      }
      const lineValue = inventoryLineValueVnd(movement.quantityMilli, movement.unitCostVnd);
      const signed = signedMovement(movement);
      quantityBalance = addSafe(quantityBalance, signed.quantity, 'Inventory running quantity');
      valueBalance = addSafe(valueBalance, signed.value, 'Inventory running value');
      if (movement.direction === InventoryDirection.IN) {
        inboundQuantityMilli = addSafe(inboundQuantityMilli, movement.quantityMilli, 'Inventory inbound quantity');
        inboundValueVnd = addSafe(inboundValueVnd, lineValue, 'Inventory inbound value');
      } else {
        outboundQuantityMilli = addSafe(outboundQuantityMilli, movement.quantityMilli, 'Inventory outbound quantity');
        outboundValueVnd = addSafe(outboundValueVnd, lineValue, 'Inventory outbound value');
      }
      if (quantityBalance < 0) issues.push({ code: 'NEGATIVE_QUANTITY', message: `Item ${item.code} becomes negative after movement ${movement.id}`, itemId, movementId: movement.id });
      if (valueBalance < 0) issues.push({ code: 'NEGATIVE_VALUE', message: `Item ${item.code} has negative value after movement ${movement.id}`, itemId, movementId: movement.id });
      rows.push({
        movementId: movement.id,
        transactionId: movement.transactionId,
        date: movement.date,
        documentNumber: movement.documentNumber,
        description: movement.description,
        direction: movement.direction,
        quantityMilli: movement.quantityMilli,
        unitCostVnd: movement.unitCostVnd,
        valueVnd: lineValue,
        quantityBalanceMilli: quantityBalance,
        valueBalanceVnd: valueBalance,
      });
    }

    sections.push({
      itemId,
      itemCode: item.code,
      itemName: item.name,
      unit: item.unit,
      openingQuantityMilli,
      openingValueVnd,
      rows,
      inboundQuantityMilli,
      inboundValueVnd,
      outboundQuantityMilli,
      outboundValueVnd,
      closingQuantityMilli: quantityBalance,
      closingValueVnd: valueBalance,
    });
  }

  return { code: 'S2c-DNSN', status: issues.length === 0 ? 'IMPLEMENTED' : 'PARTIAL', issues, sections };
}

const LINKED_IN_TYPES = new Set<string>([
  TransactionType.CASH_PURCHASE,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.CUSTOMER_REFUND,
]);
const LINKED_OUT_TYPES = new Set<string>([
  TransactionType.CASH_SALE,
  TransactionType.CREDIT_SALE,
  TransactionType.SUPPLIER_REFUND,
]);

export class InventoryService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  private async assertTimestampUnlocked(timestamp: number): Promise<void> {
    const locked = await this.database.periodLocks.where('status').equals('LOCKED').toArray();
    const conflict = locked.find((period) => timestamp >= period.periodStart && timestamp <= period.periodEnd);
    if (conflict) throw new Error(`Cannot change inventory because period ${conflict.periodStart}-${conflict.periodEnd} is locked`);
  }

  async createItem(input: CreateInventoryItemInput): Promise<InventoryItem> {
    const now = Date.now();
    const item = InventoryItemSchema.parse({
      id: crypto.randomUUID(),
      code: input.code,
      name: input.name,
      unit: input.unit,
      createdAt: now,
      updatedAt: now,
    });
    const opening = InventoryOpeningSchema.parse({
      id: inventoryOpeningId(item.id),
      itemId: item.id,
      effectiveDate: input.openingEffectiveDate,
      quantityMilli: input.openingQuantityMilli,
      unitCostVnd: input.openingUnitCostVnd,
      createdAt: now,
      updatedAt: now,
    });
    await this.assertTimestampUnlocked(opening.effectiveDate);
    await this.database.transaction('rw', [this.database.inventoryItems, this.database.inventoryOpenings, this.database.periodLocks], async () => {
      await this.assertTimestampUnlocked(opening.effectiveDate);
      if (await this.database.inventoryItems.where('code').equals(item.code).first()) {
        throw new Error(`Inventory item code ${item.code} already exists`);
      }
      await this.database.inventoryItems.add(item);
      await this.database.inventoryOpenings.add(opening);
    });
    return item;
  }

  async postMovement(input: PostInventoryMovementInput): Promise<InventoryMovement> {
    const now = Date.now();
    const movement = InventoryMovementSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      status: 'POSTED',
      createdAt: now,
      updatedAt: now,
    });
    await this.assertTimestampUnlocked(movement.date);
    await this.database.transaction('rw', [this.database.inventoryItems, this.database.inventoryMovements, this.database.transactions, this.database.periodLocks], async () => {
      await this.assertTimestampUnlocked(movement.date);
      if (!(await this.database.inventoryItems.get(movement.itemId))) throw new Error(`Inventory item ${movement.itemId} not found`);
      if (movement.transactionId) {
        const tx = await this.database.transactions.get(movement.transactionId);
        if (!tx) throw new Error(`Linked transaction ${movement.transactionId} not found`);
        if (tx.status !== 'POSTED') throw new Error('Inventory movement can link only to a POSTED transaction');
        const allowed = movement.direction === InventoryDirection.IN ? LINKED_IN_TYPES : LINKED_OUT_TYPES;
        if (!allowed.has(tx.type)) throw new Error(`Transaction ${tx.type} is incompatible with inventory direction ${movement.direction}`);
      }
      await this.database.inventoryMovements.add(movement);
    });
    return movement;
  }

  async reverseMovement(movementId: string): Promise<InventoryMovement> {
    const original = await this.database.inventoryMovements.get(movementId);
    if (!original) throw new Error(`Inventory movement ${movementId} not found`);
    if (original.status !== 'POSTED') throw new Error('Only POSTED inventory movements can be reversed');
    if (original.reversalOfMovementId) throw new Error('Reversal of an inventory reversal is not supported in V1');
    await this.assertTimestampUnlocked(original.date);
    const now = Date.now();
    await this.assertTimestampUnlocked(now);

    return this.database.transaction('rw', [this.database.inventoryMovements, this.database.periodLocks], async () => {
      await this.assertTimestampUnlocked(original.date);
      await this.assertTimestampUnlocked(now);
      const current = await this.database.inventoryMovements.get(movementId);
      if (!current || current.status !== 'POSTED') throw new Error('Inventory movement is no longer reversible');
      const existing = await this.database.inventoryMovements.where('reversalOfMovementId').equals(movementId).first();
      if (existing) throw new Error(`Inventory movement ${movementId} has already been reversed`);
      const reversal = InventoryMovementSchema.parse({
        id: crypto.randomUUID(),
        itemId: current.itemId,
        date: now,
        direction: current.direction === InventoryDirection.IN ? InventoryDirection.OUT : InventoryDirection.IN,
        quantityMilli: current.quantityMilli,
        unitCostVnd: current.unitCostVnd,
        transactionId: current.transactionId,
        documentNumber: current.documentNumber ? `REV-${current.documentNumber}` : undefined,
        description: `Reversal of inventory movement ${current.id}`,
        reversalOfMovementId: current.id,
        status: 'POSTED',
        createdAt: now,
        updatedAt: now,
      });
      await this.database.inventoryMovements.add(reversal);
      await this.database.inventoryMovements.update(current.id, { status: 'REVERSED', updatedAt: now });
      return reversal;
    });
  }
}

export const inventoryService = new InventoryService(db);

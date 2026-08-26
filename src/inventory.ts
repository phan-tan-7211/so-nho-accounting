import { z } from 'zod';
import type { AccountingDB } from './db';
import { db } from './db';
import type { ProjectionPeriod } from './accountingProjections';
import { TransactionType } from './models';

export const INVENTORY_QUANTITY_SCALE = 1_000 as const;
export const TT58_INVENTORY_VALUATION_METHOD = 'TT58_PERIOD_AVERAGE_V1' as const;

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

export interface InventoryPriorValuationSection {
  itemId: string;
  itemCode: string;
  closingQuantityMilli: number;
  closingValueVnd: number;
}

export interface InventoryPriorValuationSnapshot {
  method: typeof TT58_INVENTORY_VALUATION_METHOD;
  periodEnd: number;
  sections: readonly InventoryPriorValuationSection[];
}

export interface InventoryS2cIssue {
  code:
    | 'MISSING_OPENING'
    | 'OPENING_AFTER_PERIOD_START'
    | 'MOVEMENT_BEFORE_OPENING'
    | 'MISSING_ITEM'
    | 'MISSING_DOCUMENT_NUMBER'
    | 'NEGATIVE_QUANTITY'
    | 'NEGATIVE_VALUE'
    | 'MISSING_PRIOR_VALUATION'
    | 'PRIOR_VALUATION_ITEM_MISSING'
    | 'MISSING_REVERSAL_SOURCE'
    | 'CROSS_PERIOD_REVERSAL_UNSUPPORTED'
    | 'INVALID_PERIOD_AVERAGE_BASE';
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
  recordedUnitCostVnd: number;
  unitCostVnd: number;
  valueVnd: number;
  quantityBalanceMilli: number;
  valueBalanceVnd: number;
  reversal: boolean;
}

export interface InventoryS2cSection {
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  valuationMethod: typeof TT58_INVENTORY_VALUATION_METHOD;
  openingQuantityMilli: number;
  openingValueVnd: number;
  periodAverageUnitCostVnd: number;
  rows: readonly InventoryS2cRow[];
  inboundQuantityMilli: number;
  inboundValueVnd: number;
  outboundQuantityMilli: number;
  outboundValueVnd: number;
  legacyExplicitOutboundValueVnd: number;
  valuationAdjustmentVnd: number;
  closingQuantityMilli: number;
  closingValueVnd: number;
}

export interface InventoryS2cBook {
  code: 'S2c-DNSN';
  status: 'IMPLEMENTED' | 'PARTIAL';
  valuationMethod: typeof TT58_INVENTORY_VALUATION_METHOD;
  issues: readonly InventoryS2cIssue[];
  sections: readonly InventoryS2cSection[];
}

export interface ProjectInventoryS2cInput {
  items: readonly InventoryItem[];
  openings: readonly InventoryOpening[];
  movements: readonly InventoryMovement[];
  period: ProjectionPeriod;
  priorValuation?: InventoryPriorValuationSnapshot;
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
  unitCostVnd?: number;
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

export function tt58PeriodAverageUnitCostVnd(
  openingQuantityMilli: number,
  openingValueVnd: number,
  inboundQuantityMilli: number,
  inboundValueVnd: number,
): number {
  const quantity = openingQuantityMilli + inboundQuantityMilli;
  const value = openingValueVnd + inboundValueVnd;
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(value) || quantity < 0 || value < 0) {
    throw new Error('TT58 period-average inventory base must be non-negative safe integers');
  }
  if (quantity === 0) {
    if (value !== 0) throw new Error('TT58 period-average inventory base has value without quantity');
    return 0;
  }
  const numerator = BigInt(value) * 1000n;
  const denominator = BigInt(quantity);
  const rounded = (numerator + denominator / 2n) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TT58 period-average unit cost exceeds safe VND range');
  return Number(rounded);
}

function addSafe(current: number, delta: number, label: string): number {
  const next = current + delta;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe integer range`);
  return next;
}

function sameCalendarMonth(left: number, right: number): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

interface PeriodMovementRowInput {
  movement: InventoryMovement;
  direction: InventoryDirection;
  quantityMilli: number;
  recordedUnitCostVnd: number;
  reversal: boolean;
}

function normalizePeriodMovement(
  movement: InventoryMovement,
  byId: ReadonlyMap<string, InventoryMovement>,
  period: ProjectionPeriod,
  issues: InventoryS2cIssue[],
): PeriodMovementRowInput | null {
  if (!movement.reversalOfMovementId) {
    return {
      movement,
      direction: movement.direction,
      quantityMilli: movement.quantityMilli,
      recordedUnitCostVnd: movement.unitCostVnd,
      reversal: false,
    };
  }
  const original = byId.get(movement.reversalOfMovementId);
  if (!original) {
    issues.push({
      code: 'MISSING_REVERSAL_SOURCE',
      message: `Inventory reversal ${movement.id} references a missing source movement`,
      itemId: movement.itemId,
      movementId: movement.id,
    });
    return null;
  }
  if (original.date < period.start || original.date > period.end) {
    issues.push({
      code: 'CROSS_PERIOD_REVERSAL_UNSUPPORTED',
      message: `Inventory reversal ${movement.id} crosses reporting periods. Enter an explicit current-period correction instead of automatic reversal.`,
      itemId: movement.itemId,
      movementId: movement.id,
    });
    return null;
  }
  return {
    movement,
    direction: original.direction,
    quantityMilli: -movement.quantityMilli,
    recordedUnitCostVnd: original.unitCostVnd,
    reversal: true,
  };
}

function deriveOpeningWithoutPriorSnapshot(
  item: InventoryItem,
  opening: InventoryOpening,
  sorted: readonly InventoryMovement[],
  period: ProjectionPeriod,
  issues: InventoryS2cIssue[],
): { quantity: number; value: number } | null {
  let quantity = opening.quantityMilli;
  let value = inventoryLineValueVnd(opening.quantityMilli, opening.unitCostVnd);
  for (const movement of sorted) {
    if (movement.date >= period.start) break;
    if (movement.date < opening.effectiveDate) {
      issues.push({
        code: 'MOVEMENT_BEFORE_OPENING',
        message: `Item ${item.code} has movement ${movement.id} before its explicit opening date`,
        itemId: item.id,
        movementId: movement.id,
      });
      continue;
    }
    if (movement.direction === InventoryDirection.OUT || movement.reversalOfMovementId) {
      issues.push({
        code: 'MISSING_PRIOR_VALUATION',
        message: `Item ${item.code} has outbound/correction activity before this period but no contiguous locked S2c snapshot valued by ${TT58_INVENTORY_VALUATION_METHOD}. Unlock/relock the preceding S2c period first.`,
        itemId: item.id,
        movementId: movement.id,
      });
      return null;
    }
    quantity = addSafe(quantity, movement.quantityMilli, 'Inventory pre-period inbound quantity');
    value = addSafe(value, inventoryLineValueVnd(movement.quantityMilli, movement.unitCostVnd), 'Inventory pre-period inbound value');
  }
  return { quantity, value };
}

export function projectInventoryS2c(input: ProjectInventoryS2cInput): InventoryS2cBook {
  const issues: InventoryS2cIssue[] = [];
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  const openingByItem = new Map<string, InventoryOpening>();
  const movementById = new Map(input.movements.map((movement) => [movement.id, movement]));
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

  const priorByItem = new Map(input.priorValuation?.sections.map((section) => [section.itemId, section]) ?? []);
  const relevantIds = new Set<string>();
  for (const item of input.items) {
    const opening = openingByItem.get(item.id);
    const movements = movementsByItem.get(item.id) ?? [];
    if ((opening && opening.effectiveDate <= input.period.end) || movements.some((movement) => movement.date <= input.period.end)) relevantIds.add(item.id);
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

    const sorted = (movementsByItem.get(itemId) ?? []).slice().sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const prior = priorByItem.get(itemId);
    let openingQuantityMilli: number;
    let openingValueVnd: number;
    if (prior) {
      openingQuantityMilli = prior.closingQuantityMilli;
      openingValueVnd = prior.closingValueVnd;
    } else {
      if (input.priorValuation && opening.effectiveDate < input.period.start) {
        const priorActivityExists = sorted.some((movement) => movement.date < input.period.start);
        if (priorActivityExists) {
          issues.push({
            code: 'PRIOR_VALUATION_ITEM_MISSING',
            message: `Previous locked S2c snapshot does not contain item ${item.code}; relock the preceding period after inventory reconciliation.`,
            itemId,
          });
          continue;
        }
      }
      const derived = deriveOpeningWithoutPriorSnapshot(item, opening, sorted, input.period, issues);
      if (!derived) continue;
      openingQuantityMilli = derived.quantity;
      openingValueVnd = derived.value;
    }

    const periodRows: PeriodMovementRowInput[] = [];
    for (const movement of sorted) {
      if (movement.date < input.period.start || movement.date > input.period.end) continue;
      if (movement.date < opening.effectiveDate) {
        issues.push({
          code: 'MOVEMENT_BEFORE_OPENING',
          message: `Item ${item.code} has movement ${movement.id} before its explicit opening date`,
          itemId,
          movementId: movement.id,
        });
        continue;
      }
      if (!movement.documentNumber) {
        issues.push({ code: 'MISSING_DOCUMENT_NUMBER', message: `S2c movement for item ${item.code} requires a document number`, itemId, movementId: movement.id });
      }
      const normalized = normalizePeriodMovement(movement, movementById, input.period, issues);
      if (normalized) periodRows.push(normalized);
    }

    let inboundQuantityMilli = 0;
    let inboundValueVnd = 0;
    let outboundQuantityMilli = 0;
    let legacyExplicitOutboundValueVnd = 0;
    for (const row of periodRows) {
      if (row.direction === InventoryDirection.IN) {
        inboundQuantityMilli = addSafe(inboundQuantityMilli, row.quantityMilli, 'S2c inbound quantity');
        const value = row.quantityMilli >= 0
          ? inventoryLineValueVnd(row.quantityMilli, row.recordedUnitCostVnd)
          : -inventoryLineValueVnd(-row.quantityMilli, row.recordedUnitCostVnd);
        inboundValueVnd = addSafe(inboundValueVnd, value, 'S2c inbound value');
      } else {
        outboundQuantityMilli = addSafe(outboundQuantityMilli, row.quantityMilli, 'S2c outbound quantity');
        const legacyValue = row.quantityMilli >= 0
          ? inventoryLineValueVnd(row.quantityMilli, row.recordedUnitCostVnd)
          : -inventoryLineValueVnd(-row.quantityMilli, row.recordedUnitCostVnd);
        legacyExplicitOutboundValueVnd = addSafe(legacyExplicitOutboundValueVnd, legacyValue, 'Legacy outbound value');
      }
    }

    let periodAverageUnitCostVnd = 0;
    try {
      periodAverageUnitCostVnd = tt58PeriodAverageUnitCostVnd(
        openingQuantityMilli,
        openingValueVnd,
        inboundQuantityMilli,
        inboundValueVnd,
      );
      if (outboundQuantityMilli > 0 && openingQuantityMilli + inboundQuantityMilli <= 0) {
        throw new Error('Outbound quantity exists without a positive TT58 period-average base');
      }
    } catch (caught) {
      issues.push({
        code: 'INVALID_PERIOD_AVERAGE_BASE',
        message: `Cannot calculate TT58 period-average unit cost for item ${item.code}: ${caught instanceof Error ? caught.message : 'invalid base'}`,
        itemId,
      });
    }

    let quantityBalance = openingQuantityMilli;
    let valueBalance = openingValueVnd;
    let outboundValueVnd = 0;
    const rows: InventoryS2cRow[] = [];
    for (const normalized of periodRows) {
      const { movement } = normalized;
      let valuationUnitCost = normalized.recordedUnitCostVnd;
      let lineValue: number;
      if (normalized.direction === InventoryDirection.OUT) {
        valuationUnitCost = periodAverageUnitCostVnd;
        lineValue = normalized.quantityMilli >= 0
          ? inventoryLineValueVnd(normalized.quantityMilli, valuationUnitCost)
          : -inventoryLineValueVnd(-normalized.quantityMilli, valuationUnitCost);
        outboundValueVnd = addSafe(outboundValueVnd, lineValue, 'S2c outbound value');
        quantityBalance = addSafe(quantityBalance, -normalized.quantityMilli, 'S2c running quantity');
        valueBalance = addSafe(valueBalance, -lineValue, 'S2c running value');
      } else {
        lineValue = normalized.quantityMilli >= 0
          ? inventoryLineValueVnd(normalized.quantityMilli, valuationUnitCost)
          : -inventoryLineValueVnd(-normalized.quantityMilli, valuationUnitCost);
        quantityBalance = addSafe(quantityBalance, normalized.quantityMilli, 'S2c running quantity');
        valueBalance = addSafe(valueBalance, lineValue, 'S2c running value');
      }
      if (quantityBalance < 0) issues.push({ code: 'NEGATIVE_QUANTITY', message: `Item ${item.code} becomes negative after movement ${movement.id}`, itemId, movementId: movement.id });
      rows.push({
        movementId: movement.id,
        transactionId: movement.transactionId,
        date: movement.date,
        documentNumber: movement.documentNumber,
        description: movement.description,
        direction: normalized.direction,
        quantityMilli: normalized.quantityMilli,
        recordedUnitCostVnd: normalized.recordedUnitCostVnd,
        unitCostVnd: valuationUnitCost,
        valueVnd: lineValue,
        quantityBalanceMilli: quantityBalance,
        valueBalanceVnd: valueBalance,
        reversal: normalized.reversal,
      });
    }

    if (quantityBalance < 0) issues.push({ code: 'NEGATIVE_QUANTITY', message: `Item ${item.code} has negative closing quantity`, itemId });
    if (valueBalance < 0) issues.push({ code: 'NEGATIVE_VALUE', message: `Item ${item.code} has negative closing inventory value`, itemId });

    sections.push({
      itemId,
      itemCode: item.code,
      itemName: item.name,
      unit: item.unit,
      valuationMethod: TT58_INVENTORY_VALUATION_METHOD,
      openingQuantityMilli,
      openingValueVnd,
      periodAverageUnitCostVnd,
      rows,
      inboundQuantityMilli,
      inboundValueVnd,
      outboundQuantityMilli,
      outboundValueVnd,
      legacyExplicitOutboundValueVnd,
      valuationAdjustmentVnd: outboundValueVnd - legacyExplicitOutboundValueVnd,
      closingQuantityMilli: quantityBalance,
      closingValueVnd: valueBalance,
    });
  }

  return {
    code: 'S2c-DNSN',
    status: issues.length === 0 ? 'IMPLEMENTED' : 'PARTIAL',
    valuationMethod: TT58_INVENTORY_VALUATION_METHOD,
    issues,
    sections,
  };
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
      if (await this.database.inventoryItems.where('code').equals(item.code).first()) throw new Error(`Inventory item code ${item.code} already exists`);
      await this.database.inventoryItems.add(item);
      await this.database.inventoryOpenings.add(opening);
    });
    return item;
  }

  async postMovement(input: PostInventoryMovementInput): Promise<InventoryMovement> {
    if (input.direction === InventoryDirection.IN && input.unitCostVnd === undefined) {
      throw new Error('Inbound inventory movement requires an explicit unit cost');
    }
    const now = Date.now();
    const movement = InventoryMovementSchema.parse({
      ...input,
      unitCostVnd: input.direction === InventoryDirection.IN ? input.unitCostVnd : 0,
      id: crypto.randomUUID(),
      status: 'POSTED',
      createdAt: now,
      updatedAt: now,
    });
    await this.assertTimestampUnlocked(movement.date);
    await this.database.transaction(
      'rw',
      [this.database.inventoryItems, this.database.inventoryOpenings, this.database.inventoryMovements, this.database.transactions, this.database.periodLocks],
      async () => {
        await this.assertTimestampUnlocked(movement.date);
        if (!(await this.database.inventoryItems.get(movement.itemId))) throw new Error(`Inventory item ${movement.itemId} not found`);
        const opening = await this.database.inventoryOpenings.get(inventoryOpeningId(movement.itemId));
        if (!opening) throw new Error(`Inventory opening for item ${movement.itemId} not found`);
        if (movement.date < opening.effectiveDate) throw new Error('Inventory movement date cannot be before the item opening date');
        if (movement.transactionId) {
          const tx = await this.database.transactions.get(movement.transactionId);
          if (!tx) throw new Error(`Linked transaction ${movement.transactionId} not found`);
          if (tx.status !== 'POSTED') throw new Error('Inventory movement can link only to a POSTED transaction');
          const allowed = movement.direction === InventoryDirection.IN ? LINKED_IN_TYPES : LINKED_OUT_TYPES;
          if (!allowed.has(tx.type)) throw new Error(`Transaction ${tx.type} is incompatible with inventory direction ${movement.direction}`);
        }
        await this.database.inventoryMovements.add(movement);
      },
    );
    return movement;
  }

  async reverseMovement(movementId: string): Promise<InventoryMovement> {
    const original = await this.database.inventoryMovements.get(movementId);
    if (!original) throw new Error(`Inventory movement ${movementId} not found`);
    if (original.status !== 'POSTED') throw new Error('Only POSTED inventory movements can be reversed');
    if (original.reversalOfMovementId) throw new Error('Reversal of an inventory reversal is not supported in V1');
    await this.assertTimestampUnlocked(original.date);
    const now = Date.now();
    if (!sameCalendarMonth(original.date, now)) {
      throw new Error('Automatic inventory reversal must stay in the same accounting month. Enter an explicit current-period correction for a prior-month movement.');
    }
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

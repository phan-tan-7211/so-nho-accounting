import { describe, expect, it } from 'vitest';
import {
  InventoryDirection,
  formatInventoryQuantity,
  inventoryLineValueVnd,
  parseInventoryQuantityToMilli,
  projectInventoryS2c,
} from './inventory';
import type { InventoryItem, InventoryMovement, InventoryOpening } from './inventory';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const item: InventoryItem = {
  id: ITEM_ID,
  code: 'HH-001',
  name: 'Hàng hóa A',
  unit: 'kg',
  createdAt: 1,
  updatedAt: 1,
};
const opening: InventoryOpening = {
  id: `inventory-opening:${ITEM_ID}`,
  itemId: ITEM_ID,
  effectiveDate: 100,
  quantityMilli: 10_500,
  unitCostVnd: 20_000,
  createdAt: 1,
  updatedAt: 1,
};

function movement(overrides: Partial<InventoryMovement> & Pick<InventoryMovement, 'id' | 'date' | 'direction' | 'quantityMilli' | 'unitCostVnd'>): InventoryMovement {
  return {
    itemId: ITEM_ID,
    status: 'POSTED',
    createdAt: overrides.date,
    updatedAt: overrides.date,
    documentNumber: `DOC-${overrides.id.slice(0, 4)}`,
    ...overrides,
  };
}

describe('inventory quantity helpers', () => {
  it('parses and formats quantities using integer milli-units', () => {
    expect(parseInventoryQuantityToMilli('12')).toBe(12_000);
    expect(parseInventoryQuantityToMilli('12.345')).toBe(12_345);
    expect(parseInventoryQuantityToMilli('0,5')).toBe(500);
    expect(formatInventoryQuantity(12_340)).toBe('12.34');
    expect(() => parseInventoryQuantityToMilli('1.2345')).toThrow(/3 chữ số/);
  });

  it('calculates deterministic rounded VND values without floating point multiplication', () => {
    expect(inventoryLineValueVnd(1_500, 10_001)).toBe(15_002);
    expect(inventoryLineValueVnd(500, 1)).toBe(1);
  });
});

describe('projectInventoryS2c', () => {
  it('materializes opening, inbound, outbound and closing balances', () => {
    const book = projectInventoryS2c({
      items: [item],
      openings: [opening],
      movements: [
        movement({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', date: 120, direction: InventoryDirection.IN, quantityMilli: 2_000, unitCostVnd: 22_000 }),
        movement({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', date: 130, direction: InventoryDirection.OUT, quantityMilli: 3_500, unitCostVnd: 20_000 }),
      ],
      period: { start: 100, end: 199 },
    });

    expect(book.status).toBe('IMPLEMENTED');
    expect(book.sections[0]).toMatchObject({
      openingQuantityMilli: 10_500,
      openingValueVnd: 210_000,
      inboundQuantityMilli: 2_000,
      inboundValueVnd: 44_000,
      outboundQuantityMilli: 3_500,
      outboundValueVnd: 70_000,
      closingQuantityMilli: 9_000,
      closingValueVnd: 184_000,
    });
    expect(book.sections[0]?.rows.map((row) => row.quantityBalanceMilli)).toEqual([12_500, 9_000]);
  });

  it('derives the period opening from the explicit base opening plus prior movements', () => {
    const book = projectInventoryS2c({
      items: [item],
      openings: [opening],
      movements: [
        movement({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', date: 150, direction: InventoryDirection.IN, quantityMilli: 1_000, unitCostVnd: 20_000 }),
        movement({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', date: 220, direction: InventoryDirection.OUT, quantityMilli: 500, unitCostVnd: 20_000 }),
      ],
      period: { start: 200, end: 299 },
    });
    expect(book.sections[0]).toMatchObject({ openingQuantityMilli: 11_500, openingValueVnd: 230_000, closingQuantityMilli: 11_000, closingValueVnd: 220_000 });
  });

  it('fails closed when an active item has no explicit opening', () => {
    const book = projectInventoryS2c({
      items: [item],
      openings: [],
      movements: [movement({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', date: 120, direction: InventoryDirection.IN, quantityMilli: 1_000, unitCostVnd: 10_000 })],
      period: { start: 100, end: 199 },
    });
    expect(book.status).toBe('PARTIAL');
    expect(book.issues.map((issue) => issue.code)).toContain('MISSING_OPENING');
  });

  it('flags negative stock instead of silently accepting impossible S2c balances', () => {
    const book = projectInventoryS2c({
      items: [item],
      openings: [{ ...opening, quantityMilli: 1_000, unitCostVnd: 10_000 }],
      movements: [movement({ id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', date: 120, direction: InventoryDirection.OUT, quantityMilli: 2_000, unitCostVnd: 10_000 })],
      period: { start: 100, end: 199 },
    });
    expect(book.status).toBe('PARTIAL');
    expect(book.issues.map((issue) => issue.code)).toContain('NEGATIVE_QUANTITY');
  });

  it('keeps reversal semantics as explicit opposite movements', () => {
    const original = movement({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', date: 120, direction: InventoryDirection.IN, quantityMilli: 1_000, unitCostVnd: 10_000, status: 'REVERSED' });
    const reversal = movement({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', date: 130, direction: InventoryDirection.OUT, quantityMilli: 1_000, unitCostVnd: 10_000, reversalOfMovementId: original.id });
    const book = projectInventoryS2c({ items: [item], openings: [opening], movements: [original, reversal], period: { start: 100, end: 199 } });
    expect(book.sections[0]).toMatchObject({ closingQuantityMilli: opening.quantityMilli, closingValueVnd: 210_000 });
  });
});

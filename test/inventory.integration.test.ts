import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingProjectionService } from '../src/accountingProjectionService';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { InventoryDirection, InventoryService } from '../src/inventory';
import { AccountKind, TransactionType, Tt58ExpenseCategory } from '../src/models';
import type { Account } from '../src/models';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = { start: 100, end: 199 } as const;
let sequence = 0;
const names: string[] = [];

function databaseName(): string {
  const name = `AccountingDB-inventory-${sequence++}`;
  names.push(name);
  return name;
}

function account(): Account {
  return { id: CASH_ID, name: 'Tiền mặt', balance: 1_000_000, kind: AccountKind.CASH, createdAt: 1 };
}

function profile(): AccountingProfile {
  return {
    id: 'primary', regime: TT58_REGIME, entityType: 'MICRO_ENTERPRISE', dataStartDate: '2026-07-01',
    taxProfileConfigured: true, vatMethod: 'PERCENT_ON_REVENUE', incomeTaxMethod: 'TAXABLE_INCOME',
    createdAt: 1, updatedAt: 1,
  };
}

afterEach(async () => {
  while (names.length) {
    const name = names.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('inventory S2c integration', () => {
  it('persists explicit inventory, rejects pre-opening writes, links compatible purchase, and materializes S2c', async () => {
    const database = new AccountingDB(databaseName());
    await database.open();
    await database.accounts.put(account());
    await database.accountingProfiles.put(profile());

    const inventory = new InventoryService(database);
    const item = await inventory.createItem({
      code: 'HH-01', name: 'Hàng A', unit: 'kg', openingEffectiveDate: PERIOD.start,
      openingQuantityMilli: 5_000, openingUnitCostVnd: 10_000,
    });

    await expect(inventory.postMovement({
      itemId: item.id, date: 90, direction: InventoryDirection.IN, quantityMilli: 1_000,
      unitCostVnd: 10_000, documentNumber: 'BEFORE-OPENING',
    })).rejects.toThrow(/before the item opening date/);
    expect(await database.inventoryMovements.count()).toBe(0);

    const engine = new AccountingEngineService(database);
    const purchase = await engine.processTransaction({
      date: 120, amount: 20_000, type: TransactionType.CASH_PURCHASE, sourceAccountId: CASH_ID,
      amountBeforeVat: 20_000, vatAmount: 0, vatRate: 0, tt58ExpenseCategory: Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
      documentNumber: 'PUR-01', status: 'POSTED',
    });
    await inventory.postMovement({
      itemId: item.id, date: 120, direction: InventoryDirection.IN, quantityMilli: 2_000,
      unitCostVnd: 10_000, transactionId: purchase.id, documentNumber: 'NK-01',
    });

    const result = await new AccountingProjectionService(database).buildTt58Projection(PERIOD);
    expect(result.materializedBooks.s2c).toMatchObject({ status: 'IMPLEMENTED' });
    expect(result.materializedBooks.s2c?.sections[0]).toMatchObject({
      openingQuantityMilli: 5_000, inboundQuantityMilli: 2_000, closingQuantityMilli: 7_000,
      openingValueVnd: 50_000, closingValueVnd: 70_000,
    });
    expect(result.capabilities.find((capability) => capability.code === 'S2c-DNSN')).toMatchObject({ required: true, status: 'IMPLEMENTED', blockers: [] });

    await expect(inventory.postMovement({
      itemId: item.id, date: 130, direction: InventoryDirection.OUT, quantityMilli: 1_000,
      unitCostVnd: 10_000, transactionId: purchase.id, documentNumber: 'XK-BAD',
    })).rejects.toThrow(/incompatible/);
    database.close();
  });

  it('blocks inventory writes inside a locked period and permits later periods', async () => {
    const database = new AccountingDB(databaseName());
    await database.open();
    const inventory = new InventoryService(database);
    const item = await inventory.createItem({
      code: 'VL-01', name: 'Vật liệu', unit: 'cái', openingEffectiveDate: 1,
      openingQuantityMilli: 0, openingUnitCostVnd: 0,
    });
    await database.periodLocks.put({
      id: 'tt58-period:100:199', periodStart: 100, periodEnd: 199, status: 'LOCKED', revision: 1,
      lockedAt: 200, reportSnapshotJson: '{"schemaVersion":1,"tables":[]}',
    });

    await expect(inventory.postMovement({
      itemId: item.id, date: 150, direction: InventoryDirection.IN, quantityMilli: 1_000,
      unitCostVnd: 1_000, documentNumber: 'LOCKED',
    })).rejects.toThrow(/period 100-199 is locked/);

    const later = await inventory.postMovement({
      itemId: item.id, date: 220, direction: InventoryDirection.IN, quantityMilli: 1_000,
      unitCostVnd: 1_000, documentNumber: 'NEXT',
    });
    expect(later.status).toBe('POSTED');
    database.close();
  });
});

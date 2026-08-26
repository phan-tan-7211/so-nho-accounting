import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { AccountKind, TaxType, TransactionType } from '../src/models';
import type { Account } from '../src/models';
import { PeriodLockService } from '../src/periodLock';
import { createTaxOpeningPosition } from '../src/taxOpeningPosition';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = { start: 100, end: 199 } as const;
let dbSequence = 0;
const databasesToDelete: string[] = [];

function nextDatabaseName(): string {
  const name = `AccountingDB-period-lock-${dbSequence++}`;
  databasesToDelete.push(name);
  return name;
}

function account(): Account {
  return {
    id: CASH_ID,
    name: 'Tiền mặt',
    balance: 1_000,
    kind: AccountKind.CASH,
    createdAt: 1,
  };
}

function profile(): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: true,
    vatMethod: 'PERCENT_ON_REVENUE',
    incomeTaxMethod: 'PERCENT_ON_REVENUE',
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(async () => {
  while (databasesToDelete.length > 0) {
    const name = databasesToDelete.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('TT58 period lock integration', () => {
  it('snapshots an implemented report, blocks in-period writes, records unlock, then allows correction', async () => {
    const database = new AccountingDB(nextDatabaseName());
    await database.open();
    await database.accounts.put(account());
    await database.accountingProfiles.put(profile());

    const engine = new AccountingEngineService(database);
    const original = await engine.processTransaction({
      date: 120,
      amount: 100,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      documentNumber: 'SALE-001',
      taxActivityLabel: 'Bán hàng',
      taxRevenueAmount: 100,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      status: 'POSTED',
    });

    const locks = new PeriodLockService(database);
    const locked = await locks.lockPeriod(PERIOD);
    expect(locked.alreadyLocked).toBe(false);
    expect(locked.state).toMatchObject({ status: 'LOCKED', revision: 1 });
    expect(locked.report.tables.map((table) => table.code)).toEqual(['S1-DNSN']);
    expect(locked.report.tables[0]?.rows[0]).toMatchObject(['ENTRY']);

    const repeated = await locks.lockPeriod(PERIOD);
    expect(repeated.alreadyLocked).toBe(true);
    expect(repeated.state.revision).toBe(1);

    await expect(engine.processTransaction({
      date: 150,
      amount: 50,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      documentNumber: 'SALE-LOCKED',
      taxActivityLabel: 'Bán hàng',
      taxRevenueAmount: 50,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      status: 'POSTED',
    })).rejects.toThrow(/period .* is locked/);

    await expect(engine.reverseTransaction(original.id)).rejects.toThrow(/period .* is locked/);

    await expect(locks.putTaxOpeningPositions([
      createTaxOpeningPosition({
        taxType: TaxType.VAT,
        periodStart: PERIOD.start,
        amount: 0,
        now: 2,
      }),
    ])).rejects.toThrow(/tax opening position.*locked/i);

    await engine.processTransaction({
      date: 220,
      amount: 25,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      documentNumber: 'SALE-NEXT',
      taxActivityLabel: 'Bán hàng',
      taxRevenueAmount: 25,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      status: 'POSTED',
    });

    const unlocked = await locks.unlockPeriod(PERIOD);
    expect(unlocked.status).toBe('UNLOCKED');
    await engine.processTransaction({
      date: 160,
      amount: 10,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      documentNumber: 'SALE-CORRECTION',
      taxActivityLabel: 'Bán hàng',
      taxRevenueAmount: 10,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      status: 'POSTED',
    });

    const events = await database.periodLockEvents.orderBy('timestamp').toArray();
    expect(events.map((event) => event.action)).toEqual(['LOCK', 'UNLOCK']);
    expect(events.map((event) => event.revision)).toEqual([1, 1]);

    database.close();
  });

  it('fails closed when required TT58 books are not all implemented', async () => {
    const database = new AccountingDB(nextDatabaseName());
    await database.open();
    await database.accounts.put(account());
    await database.accountingProfiles.put({
      ...profile(),
      vatMethod: 'DEDUCTION',
      incomeTaxMethod: 'TAXABLE_INCOME',
    });

    const locks = new PeriodLockService(database);
    await expect(locks.lockPeriod(PERIOD)).rejects.toThrow(/Cannot finalize TT58 report/);
    expect(await database.periodLocks.count()).toBe(0);
    expect(await database.periodLockEvents.count()).toBe(0);

    database.close();
  });
});

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingProjectionService } from '../src/accountingProjectionService';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { TransactionType } from '../src/models';
import type { Account, Transaction } from '../src/models';
import { PartnerKind } from '../src/partners';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const LEGACY_TX_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
let dbSequence = 0;
const databasesToDelete: string[] = [];

function nextDatabaseName(): string {
  const name = `AccountingDB-projection-${dbSequence++}`;
  databasesToDelete.push(name);
  return name;
}

function account(balance = 0): Account {
  return {
    id: CASH_ID,
    name: 'Tiền mặt',
    balance,
    createdAt: 1,
  };
}

function profile(configured = true): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: configured,
    vatMethod: configured ? 'DEDUCTION' : 'UNCONFIGURED',
    incomeTaxMethod: configured ? 'TAXABLE_INCOME' : 'UNCONFIGURED',
    createdAt: 1,
    updatedAt: 1,
  };
}

function legacyIncome(date: number, amount: number): Transaction {
  return {
    id: LEGACY_TX_ID,
    date,
    amount,
    type: TransactionType.INCOME,
    destinationAccountId: CASH_ID,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
  };
}

async function openDatabase(
  accounts: readonly Account[] = [account()],
  transactions: readonly Transaction[] = [],
): Promise<AccountingDB> {
  const database = new AccountingDB(nextDatabaseName());
  await database.open();
  if (accounts.length > 0) await database.accounts.bulkPut([...accounts]);
  if (transactions.length > 0) await database.transactions.bulkPut([...transactions]);
  return database;
}

afterEach(async () => {
  while (databasesToDelete.length > 0) {
    const name = databasesToDelete.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('AccountingProjectionService', () => {
  it('reads semantic effects from IndexedDB and returns required TT58 capabilities plus activity rows', async () => {
    const database = await openDatabase();
    await database.accountingProfiles.put(profile());
    await database.partners.put({
      id: CUSTOMER_ID,
      code: 'KH-01',
      name: 'Khách A',
      kind: PartnerKind.CUSTOMER,
      active: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const engine = new AccountingEngineService(database);

    await engine.processTransaction({
      date: 100,
      amount: 110,
      type: TransactionType.CREDIT_SALE,
      partnerId: CUSTOMER_ID,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      status: 'POSTED',
    });
    await engine.processTransaction({
      date: 110,
      amount: 40,
      type: TransactionType.CUSTOMER_PAYMENT,
      destinationAccountId: CASH_ID,
      partnerId: CUSTOMER_ID,
      status: 'POSTED',
    });

    const result = await new AccountingProjectionService(database).buildTt58Projection({
      start: 90,
      end: 120,
    });

    expect(result.projection.activityCoverage.status).toBe('COMPLETE');
    expect(result.projection.positionCoverage.status).toBe('COMPLETE');
    expect(result.projection.totals.revenue).toBe(100);
    expect(result.projection.vatActivity).toEqual({ input: 0, output: 10, netOutputLessInput: 10 });
    expect(result.projection.partnerPositions).toEqual([
      { partnerId: CUSTOMER_ID, receivable: 70, payable: 0 },
    ]);
    expect(
      result.capabilities.filter((book) => book.required).map((book) => book.code),
    ).toEqual(['S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN', 'S3b-DNSN']);
    expect(result.activities.debt).toHaveLength(2);
    expect(result.activities.vat).toEqual([
      expect.objectContaining({ vatInput: 0, vatOutput: 10 }),
    ]);
    database.close();
  });

  it('surfaces partial activity coverage when a legacy row is inside the requested period', async () => {
    const legacy = legacyIncome(100, 50);
    const database = await openDatabase([account(50)], [legacy]);
    await database.accountingProfiles.put(profile());

    const result = await new AccountingProjectionService(database).buildTt58Projection({
      start: 90,
      end: 110,
    });

    expect(result.projection.activityCoverage.status).toBe('PARTIAL');
    expect(result.projection.activityCoverage.legacyTransactionIds).toEqual([legacy.id]);
    expect(result.projection.entries).toEqual([]);
    database.close();
  });

  it('keeps all required-book flags off while the tax profile is explicitly unconfigured', async () => {
    const database = await openDatabase();
    await database.accountingProfiles.put(profile(false));

    const result = await new AccountingProjectionService(database).buildTt58Projection({
      start: 0,
      end: 999,
    });

    expect(result.capabilities.some((book) => book.required)).toBe(false);
    database.close();
  });

  it('refuses to present TT58 book projections when the accounting profile is missing', async () => {
    const database = await openDatabase();
    const service = new AccountingProjectionService(database);

    await expect(service.buildTt58Projection({ start: 0, end: 999 })).rejects.toThrow(
      'TT58 accounting profile is not configured',
    );
    database.close();
  });
});

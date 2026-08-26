import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { runAccountingCutover } from '../src/accountingCutoverPersistence';
import { AccountingDB } from '../src/db';
import { DexieAccountingCutoverStore } from '../src/dexieAccountingCutoverStore';
import { TransactionType } from '../src/models';
import type { Account, AuditLog, Transaction } from '../src/models';
import type { AccountingProfile } from '../src/accountingProfile';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const TX_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const AUDIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
let dbSequence = 0;
const databasesToDelete: string[] = [];

function nextDatabaseName(): string {
  const name = `AccountingDB-cutover-test-${dbSequence++}`;
  databasesToDelete.push(name);
  return name;
}

function account(balance: number): Account {
  return {
    id: CASH_ID,
    name: 'Tiền mặt',
    balance,
    createdAt: 1,
  };
}

function legacyIncome(amount: number): Transaction {
  return {
    id: TX_ID,
    date: 1,
    amount,
    type: TransactionType.INCOME,
    destinationAccountId: CASH_ID,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
  };
}

class LegacyV2DB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
    });
    this.version(2).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
    });
  }
}

afterEach(async () => {
  while (databasesToDelete.length > 0) {
    const name = databasesToDelete.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('Dexie accounting cutover integration', () => {
  it('upgrades V2 to V3 additively, preserves records, persists cutover, and reopens idempotently', async () => {
    const name = nextDatabaseName();
    const legacy = new LegacyV2DB(name);
    const originalAccount = account(1_200);
    const originalTransaction = legacyIncome(200);
    const audit: AuditLog = {
      id: AUDIT_ID,
      transactionId: TX_ID,
      action: 'CREATE',
      timestamp: 2,
      details: 'legacy audit',
    };
    const profile: AccountingProfile = {
      id: 'primary',
      regime: 'TT58_2026_MICRO',
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-07-01',
      taxProfileConfigured: false,
      vatMethod: 'UNCONFIGURED',
      incomeTaxMethod: 'UNCONFIGURED',
      createdAt: 1,
      updatedAt: 1,
    };

    await legacy.open();
    await legacy.table('accounts').put(originalAccount);
    await legacy.table('transactions').put(originalTransaction);
    await legacy.table('auditLogs').put(audit);
    await legacy.table('accountingProfiles').put(profile);
    legacy.close();

    const upgraded = new AccountingDB(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(3);
    expect(await upgraded.accounts.get(CASH_ID)).toEqual(originalAccount);
    expect(await upgraded.transactions.get(TX_ID)).toEqual(originalTransaction);
    expect(await upgraded.auditLogs.get(AUDIT_ID)).toEqual(audit);
    expect(await upgraded.accountingProfiles.get('primary')).toEqual(profile);

    const first = await runAccountingCutover(new DexieAccountingCutoverStore(upgraded));
    expect(first.status).toBe('APPLIED');
    expect(await upgraded.openingEffects.count()).toBe(1);
    expect((await upgraded.openingEffects.toArray())[0]).toMatchObject({
      accountId: CASH_ID,
      amount: 1_000,
      kind: 'OPENING_CASH',
    });
    expect(await upgraded.migrationStates.count()).toBe(1);

    // The schema/cutover does not rewrite legacy source rows.
    expect(await upgraded.accounts.get(CASH_ID)).toEqual(originalAccount);
    expect(await upgraded.transactions.get(TX_ID)).toEqual(originalTransaction);
    upgraded.close();

    const reopened = new AccountingDB(name);
    await reopened.open();
    const second = await runAccountingCutover(new DexieAccountingCutoverStore(reopened));

    expect(second.status).toBe('ALREADY_APPLIED');
    expect(await reopened.openingEffects.count()).toBe(1);
    expect(await reopened.migrationStates.count()).toBe(1);
    reopened.close();
  });

  it('writes nothing when the persisted legacy snapshot is malformed', async () => {
    const name = nextDatabaseName();
    const legacy = new LegacyV2DB(name);
    await legacy.open();
    await legacy.table('accounts').put(account(100));
    await legacy.table('transactions').put({
      id: TX_ID,
      type: TransactionType.INCOME,
      amount: '100',
      destinationAccountId: CASH_ID,
    });
    legacy.close();

    const upgraded = new AccountingDB(name);
    await upgraded.open();
    const result = await runAccountingCutover(new DexieAccountingCutoverStore(upgraded));

    expect(result.status).toBe('BLOCKED');
    expect(await upgraded.openingEffects.count()).toBe(0);
    expect(await upgraded.migrationStates.count()).toBe(0);
    expect(await upgraded.transactions.get(TX_ID)).toMatchObject({ amount: '100' });
    upgraded.close();
  });

  it('rolls back opening-effect writes when the migration marker write fails', async () => {
    const name = nextDatabaseName();
    const legacy = new LegacyV2DB(name);
    await legacy.open();
    await legacy.table('accounts').put(account(500));
    await legacy.table('transactions').put(legacyIncome(100));
    legacy.close();

    const upgraded = new AccountingDB(name);
    await upgraded.open();
    const originalPut = upgraded.migrationStates.put;
    upgraded.migrationStates.put = (async () => {
      throw new Error('simulated Dexie marker failure');
    }) as typeof upgraded.migrationStates.put;

    await expect(
      runAccountingCutover(new DexieAccountingCutoverStore(upgraded)),
    ).rejects.toThrow('simulated Dexie marker failure');

    expect(await upgraded.openingEffects.count()).toBe(0);
    expect(await upgraded.migrationStates.count()).toBe(0);
    upgraded.migrationStates.put = originalPut;
    upgraded.close();
  });

  it('persists the global cutover marker for an empty V2 database', async () => {
    const name = nextDatabaseName();
    const legacy = new LegacyV2DB(name);
    await legacy.open();
    legacy.close();

    const upgraded = new AccountingDB(name);
    await upgraded.open();
    const result = await runAccountingCutover(new DexieAccountingCutoverStore(upgraded));

    expect(result.status).toBe('APPLIED');
    expect(await upgraded.openingEffects.count()).toBe(0);
    expect(await upgraded.migrationStates.count()).toBe(1);
    upgraded.close();
  });
});

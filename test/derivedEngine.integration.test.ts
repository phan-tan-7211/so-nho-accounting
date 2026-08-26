import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { TransactionType } from '../src/models';
import type { Account, Transaction } from '../src/models';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const LEGACY_TX_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
let dbSequence = 0;
const databasesToDelete: string[] = [];

function nextDatabaseName(): string {
  const name = `AccountingDB-derived-engine-${dbSequence++}`;
  databasesToDelete.push(name);
  return name;
}

function account(id: string, balance: number): Account {
  return {
    id,
    name: id === CASH_ID ? 'Tiền mặt' : 'Ngân hàng',
    balance,
    createdAt: 1,
  };
}

function legacyIncome(amount: number): Transaction {
  return {
    id: LEGACY_TX_ID,
    date: 1,
    amount,
    type: TransactionType.INCOME,
    destinationAccountId: CASH_ID,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
  };
}

async function openDatabase(
  accounts: readonly Account[],
  transactions: readonly Transaction[] = [],
): Promise<AccountingDB> {
  const database = new AccountingDB(nextDatabaseName());
  await database.open();
  await database.accounts.bulkPut([...accounts]);
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

describeIndexedDb('derived AccountingEngine', () => {
  it('preserves migrated legacy balance and never mutates cached balance for a new cash sale', async () => {
    const database = await openDatabase([account(CASH_ID, 1_200)], [legacyIncome(200)]);
    const engine = new AccountingEngineService(database);

    expect(await engine.getBalance(CASH_ID)).toBe(1_200);

    const created = await engine.processTransaction({
      date: 2,
      amount: 300,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      status: 'POSTED',
    });

    expect(created.type).toBe(TransactionType.CASH_SALE);
    expect((await database.accounts.get(CASH_ID))?.balance).toBe(1_200);
    expect(await engine.getBalance(CASH_ID)).toBe(1_500);
    database.close();
  });

  it('derives semantic transfer balances while cached account balances remain unchanged', async () => {
    const database = await openDatabase([
      account(CASH_ID, 500),
      account(BANK_ID, 200),
    ]);
    const engine = new AccountingEngineService(database);

    await engine.processTransaction({
      date: 2,
      amount: 100,
      type: TransactionType.TRANSFER,
      sourceAccountId: CASH_ID,
      destinationAccountId: BANK_ID,
      status: 'POSTED',
    });

    expect(await engine.getBalance(CASH_ID)).toBe(400);
    expect(await engine.getBalance(BANK_ID)).toBe(300);
    expect((await database.accounts.get(CASH_ID))?.balance).toBe(500);
    expect((await database.accounts.get(BANK_ID))?.balance).toBe(200);
    database.close();
  });

  it('rejects creation of a post-cutover legacy-only transaction without persisting it', async () => {
    const database = await openDatabase([account(CASH_ID, 100)]);
    const engine = new AccountingEngineService(database);
    await engine.getBalance(CASH_ID);
    const beforeCount = await database.transactions.count();

    await expect(
      engine.processTransaction({
        date: 2,
        amount: 100,
        type: TransactionType.INCOME,
        destinationAccountId: CASH_ID,
        status: 'POSTED',
      }),
    ).rejects.toThrow('Legacy transaction type INCOME requires explicit migration');

    expect(await database.transactions.count()).toBe(beforeCount);
    expect((await database.accounts.get(CASH_ID))?.balance).toBe(100);
    database.close();
  });

  it('rejects semantic cash effects that reference an account that does not exist', async () => {
    const database = await openDatabase([account(CASH_ID, 100)]);
    const engine = new AccountingEngineService(database);

    await expect(
      engine.processTransaction({
        date: 2,
        amount: 50,
        type: TransactionType.CASH_SALE,
        destinationAccountId: MISSING_ID,
        status: 'POSTED',
      }),
    ).rejects.toThrow(`Account ${MISSING_ID} not found`);

    expect(await database.transactions.count()).toBe(0);
    database.close();
  });

  it('reverses a semantic transaction exactly without restoring cached-balance mutations', async () => {
    const database = await openDatabase([account(CASH_ID, 1_000)]);
    const engine = new AccountingEngineService(database);

    const purchase = await engine.processTransaction({
      date: 2,
      amount: 200,
      type: TransactionType.CASH_PURCHASE,
      sourceAccountId: CASH_ID,
      status: 'POSTED',
    });
    expect(await engine.getBalance(CASH_ID)).toBe(800);

    const reversal = await engine.reverseTransaction(purchase.id);

    expect(reversal.type).toBe(TransactionType.REVERSAL);
    expect(reversal.reversalOfTransactionId).toBe(purchase.id);
    expect((await database.transactions.get(purchase.id))?.status).toBe('REVERSED');
    expect(await engine.getBalance(CASH_ID)).toBe(1_000);
    expect((await database.accounts.get(CASH_ID))?.balance).toBe(1_000);

    await expect(engine.reverseTransaction(purchase.id)).rejects.toThrow(
      'Only POSTED transactions can be reversed; found REVERSED',
    );
    database.close();
  });

  it('does not allow semantic reversal of a transaction captured in the legacy snapshot', async () => {
    const database = await openDatabase([account(CASH_ID, 500)], [legacyIncome(100)]);
    const engine = new AccountingEngineService(database);
    expect(await engine.getBalance(CASH_ID)).toBe(500);

    await expect(engine.reverseTransaction(LEGACY_TX_ID)).rejects.toThrow(
      'Migrated legacy transactions cannot use semantic REVERSAL',
    );
    database.close();
  });

  it('blocks new postings when the pre-cutover persisted snapshot is malformed', async () => {
    const database = await openDatabase([account(CASH_ID, 100)]);
    await database.table('transactions').put({
      id: LEGACY_TX_ID,
      type: TransactionType.INCOME,
      amount: '100',
      destinationAccountId: CASH_ID,
    });
    const engine = new AccountingEngineService(database);

    await expect(
      engine.processTransaction({
        date: 2,
        amount: 50,
        type: TransactionType.CASH_SALE,
        destinationAccountId: CASH_ID,
        status: 'POSTED',
      }),
    ).rejects.toThrow('Accounting cutover is blocked: MALFORMED_TRANSACTION');

    expect(await database.transactions.count()).toBe(1);
    expect(await database.openingEffects.count()).toBe(0);
    expect(await database.migrationStates.count()).toBe(0);
    database.close();
  });
});

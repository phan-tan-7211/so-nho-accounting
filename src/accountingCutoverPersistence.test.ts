import { describe, expect, it } from 'vitest';
import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
  runAccountingCutover,
} from './accountingCutoverPersistence';
import type {
  AccountingCutoverStore,
  AccountingCutoverTransaction,
  LegacyOpeningBalanceMigrationRecord,
  OpeningEffectRecord,
} from './accountingCutoverPersistence';
import { OpeningEffectKind } from './legacyOpeningBalanceMigration';
import { TransactionType } from './models';
import type { Account, Transaction } from './models';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const TX_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

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

interface MemorySnapshot {
  accounts: unknown[];
  transactions: unknown[];
  migrationState?: LegacyOpeningBalanceMigrationRecord;
  openingEffects: OpeningEffectRecord[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryCutoverStore implements AccountingCutoverStore {
  snapshot: MemorySnapshot;
  failMigrationStateWrite = false;

  constructor(accounts: readonly unknown[] = [], transactions: readonly unknown[] = []) {
    this.snapshot = {
      accounts: clone([...accounts]),
      transactions: clone([...transactions]),
      openingEffects: [],
    };
  }

  async transaction<T>(
    operation: (tx: AccountingCutoverTransaction) => Promise<T>,
  ): Promise<T> {
    const draft = clone(this.snapshot);

    const tx: AccountingCutoverTransaction = {
      readAccounts: async () => clone(draft.accounts),
      readTransactions: async () => clone(draft.transactions),
      getMigrationState: async (id) => {
        if (id !== LEGACY_OPENING_BALANCE_MIGRATION_ID) return undefined;
        return draft.migrationState ? clone(draft.migrationState) : undefined;
      },
      listOpeningEffects: async (migrationId) =>
        clone(draft.openingEffects.filter((effect) => effect.migrationId === migrationId)),
      putOpeningEffects: async (records) => {
        const ids = new Set(records.map((record) => record.id));
        draft.openingEffects = [
          ...draft.openingEffects.filter((record) => !ids.has(record.id)),
          ...clone([...records]),
        ];
      },
      putMigrationState: async (record) => {
        if (this.failMigrationStateWrite) {
          throw new Error('simulated migration-state write failure');
        }
        draft.migrationState = clone(record);
      },
    };

    const result = await operation(tx);
    this.snapshot = draft;
    return result;
  }
}

describe('accounting cutover persistence contract', () => {
  it('atomically persists opening effects and migration state for a ready snapshot', async () => {
    const store = new MemoryCutoverStore(
      [account(CASH_ID, 1_200), account(BANK_ID, 700)],
      [legacyIncome(200)],
    );

    const result = await runAccountingCutover(store);

    expect(result.status).toBe('APPLIED');
    expect(store.snapshot.migrationState?.id).toBe(LEGACY_OPENING_BALANCE_MIGRATION_ID);
    expect(store.snapshot.openingEffects).toEqual([
      {
        id: `${LEGACY_OPENING_BALANCE_MIGRATION_ID}:${CASH_ID}`,
        migrationId: LEGACY_OPENING_BALANCE_MIGRATION_ID,
        migrationVersion: 1,
        kind: OpeningEffectKind.OPENING_CASH,
        accountId: CASH_ID,
        amount: 1_000,
      },
      {
        id: `${LEGACY_OPENING_BALANCE_MIGRATION_ID}:${BANK_ID}`,
        migrationId: LEGACY_OPENING_BALANCE_MIGRATION_ID,
        migrationVersion: 1,
        kind: OpeningEffectKind.OPENING_CASH,
        accountId: BANK_ID,
        amount: 700,
      },
    ]);
  });

  it('is idempotent after cutover even when the transaction snapshot later changes', async () => {
    const store = new MemoryCutoverStore([account(CASH_ID, 500)], [legacyIncome(100)]);

    const first = await runAccountingCutover(store);
    expect(first.status).toBe('APPLIED');
    const effectsAfterFirstRun = clone(store.snapshot.openingEffects);
    const stateAfterFirstRun = clone(store.snapshot.migrationState);

    // Post-cutover semantic activity is expected to change the transaction table.
    // An existing finalized marker must short-circuit legacy planning.
    store.snapshot.transactions.push({
      id: 'post-cutover-semantic-row',
      type: TransactionType.CASH_SALE,
    });

    const second = await runAccountingCutover(store);

    expect(second.status).toBe('ALREADY_APPLIED');
    expect(store.snapshot.openingEffects).toEqual(effectsAfterFirstRun);
    expect(store.snapshot.migrationState).toEqual(stateAfterFirstRun);
  });

  it('writes a global migration marker for an empty database', async () => {
    const store = new MemoryCutoverStore();

    const result = await runAccountingCutover(store);

    expect(result.status).toBe('APPLIED');
    expect(store.snapshot.openingEffects).toEqual([]);
    expect(store.snapshot.migrationState).toMatchObject({
      id: LEGACY_OPENING_BALANCE_MIGRATION_ID,
      version: 1,
      openingEffects: [],
    });
  });

  it('persists a negative opening cash amount without inventing another effect', async () => {
    const store = new MemoryCutoverStore([account(CASH_ID, -200)], [legacyIncome(300)]);

    const result = await runAccountingCutover(store);

    expect(result.status).toBe('APPLIED');
    expect(store.snapshot.openingEffects).toHaveLength(1);
    expect(store.snapshot.openingEffects[0]).toMatchObject({
      kind: OpeningEffectKind.OPENING_CASH,
      accountId: CASH_ID,
      amount: -500,
    });
  });

  it('does not write anything when legacy migration is blocked', async () => {
    const malformedTransaction = {
      id: TX_ID,
      type: TransactionType.INCOME,
      amount: '100',
      destinationAccountId: CASH_ID,
    };
    const store = new MemoryCutoverStore([account(CASH_ID, 100)], [malformedTransaction]);
    const before = clone(store.snapshot);

    const result = await runAccountingCutover(store);

    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.issues.map((issue) => issue.code)).toContain('MALFORMED_TRANSACTION');
    }
    expect(store.snapshot).toEqual(before);
  });

  it('rolls back opening effects when migration-state persistence fails', async () => {
    const store = new MemoryCutoverStore([account(CASH_ID, 500)], [legacyIncome(100)]);
    store.failMigrationStateWrite = true;
    const before = clone(store.snapshot);

    await expect(runAccountingCutover(store)).rejects.toThrow(
      'simulated migration-state write failure',
    );

    expect(store.snapshot).toEqual(before);
  });

  it('detects a half-corrupted finalized cutover instead of silently repairing it', async () => {
    const store = new MemoryCutoverStore([account(CASH_ID, 500)], [legacyIncome(100)]);
    await runAccountingCutover(store);

    store.snapshot.openingEffects[0] = {
      ...store.snapshot.openingEffects[0]!,
      amount: 999,
    };

    await expect(runAccountingCutover(store)).rejects.toThrow(
      'Accounting cutover integrity error',
    );
  });

  it('does not mutate legacy account or transaction records while applying the cutover', async () => {
    const accounts = [account(CASH_ID, 500)];
    const transactions = [legacyIncome(100)];
    const store = new MemoryCutoverStore(accounts, transactions);

    await runAccountingCutover(store);

    expect(store.snapshot.accounts).toEqual(accounts);
    expect(store.snapshot.transactions).toEqual(transactions);
  });
});

import { describe, expect, it } from 'vitest';
import {
  finalizeLegacyOpeningBalanceMigration,
  OpeningEffectKind,
  planLegacyOpeningBalanceMigration,
  projectLegacyCashBalances,
} from './legacyOpeningBalanceMigration';
import { TransactionType } from './models';
import type { Account, Transaction } from './models';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

const TX_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
] as const;

function account(id: string, balance: number, name = 'Tài khoản'): Account {
  return {
    id,
    name,
    balance,
    createdAt: 1,
  };
}

function transaction(
  id: string,
  type: Transaction['type'],
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    date: 1,
    amount,
    type,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function issueCodes(plan: ReturnType<typeof planLegacyOpeningBalanceMigration>) {
  return plan.issues.map((issue) => issue.code);
}

describe('legacy opening-balance migration', () => {
  it('reproduces the exact legacy cached-balance delta and preserves final balances', () => {
    const accounts = [account(CASH_ID, 1_200, 'Tiền mặt'), account(BANK_ID, 700, 'Ngân hàng')];
    const transactions = [
      transaction(TX_IDS[0], TransactionType.INCOME, 500, { destinationAccountId: CASH_ID }),
      transaction(TX_IDS[1], TransactionType.EXPENSE, 100, { sourceAccountId: CASH_ID }),
      transaction(TX_IDS[2], TransactionType.TRANSFER, 200, {
        sourceAccountId: CASH_ID,
        destinationAccountId: BANK_ID,
      }),
      transaction(TX_IDS[3], TransactionType.CAPITAL_CONTRIBUTION, 300, {
        destinationAccountId: BANK_ID,
      }),
      transaction(TX_IDS[4], TransactionType.REFUND, 900),
      transaction(TX_IDS[5], TransactionType.ADJUSTMENT, 800),
    ];

    const plan = planLegacyOpeningBalanceMigration(accounts, transactions);

    expect(plan.status).toBe('READY');
    expect(plan.issues).toEqual([]);
    expect(plan.openingEffects).toEqual([
      { kind: OpeningEffectKind.OPENING_CASH, accountId: CASH_ID, amount: 1_000 },
      { kind: OpeningEffectKind.OPENING_CASH, accountId: BANK_ID, amount: 200 },
    ]);
    expect(plan.legacyCashDeltas).toEqual([
      { accountId: CASH_ID, amount: 200 },
      { accountId: BANK_ID, amount: 500 },
    ]);

    const projected = projectLegacyCashBalances(plan);
    expect(projected.get(CASH_ID)).toBe(1_200);
    expect(projected.get(BANK_ID)).toBe(700);
  });

  it('reproduces the old same-account transfer as net zero', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 1_000)],
      [
        transaction(TX_IDS[0], TransactionType.TRANSFER, 250, {
          sourceAccountId: CASH_ID,
          destinationAccountId: CASH_ID,
        }),
      ],
    );

    expect(plan.status).toBe('READY');
    expect(plan.legacyCashDeltas).toEqual([{ accountId: CASH_ID, amount: 0 }]);
    expect(plan.openingEffects[0]?.amount).toBe(1_000);
  });

  it('supports a negative semantic opening cash balance without inventing equity', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, -200)],
      [transaction(TX_IDS[0], TransactionType.INCOME, 300, { destinationAccountId: CASH_ID })],
    );

    expect(plan.status).toBe('READY');
    expect(plan.openingEffects).toEqual([
      { kind: OpeningEffectKind.OPENING_CASH, accountId: CASH_ID, amount: -500 },
    ]);
  });

  it('accepts a zero-amount legacy row because the old cached engine could persist it', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 10)],
      [transaction(TX_IDS[0], TransactionType.INCOME, 0, { destinationAccountId: CASH_ID })],
    );

    expect(plan.status).toBe('READY');
    expect(plan.openingEffects[0]?.amount).toBe(10);
  });

  it('blocks DRAFT legacy transactions because processTransaction originally forced POSTED', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [
        transaction(TX_IDS[0], TransactionType.INCOME, 100, {
          destinationAccountId: CASH_ID,
          status: 'DRAFT',
        }),
      ],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('NON_POSTED_LEGACY_TRANSACTION');
  });

  it('blocks REVERSED legacy transactions because cached contribution provenance is unknown', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [
        transaction(TX_IDS[0], TransactionType.EXPENSE, 100, {
          sourceAccountId: CASH_ID,
          status: 'REVERSED',
        }),
      ],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('NON_POSTED_LEGACY_TRANSACTION');
  });

  it('blocks missing required source account references', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.EXPENSE, 50)],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('MISSING_SOURCE_ACCOUNT');
  });

  it('blocks missing required destination account references', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.INCOME, 50)],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('MISSING_DESTINATION_ACCOUNT');
  });

  it('blocks references to accounts no longer present in the account snapshot', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [
        transaction(TX_IDS[0], TransactionType.TRANSFER, 50, {
          sourceAccountId: CASH_ID,
          destinationAccountId: OTHER_ACCOUNT_ID,
        }),
      ],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('MISSING_REFERENCED_ACCOUNT');
  });

  it('preserves malformed legacy rows by blocking instead of dropping or guessing them', () => {
    const malformed = {
      id: TX_IDS[0],
      type: 'INCOME',
      amount: 100,
      status: 'BROKEN',
    };

    const plan = planLegacyOpeningBalanceMigration([account(CASH_ID, 100)], [malformed]);

    expect(plan.status).toBe('BLOCKED');
    expect(plan.openingEffects).toEqual([]);
    expect(issueCodes(plan)).toContain('MALFORMED_TRANSACTION');
    expect(plan.issues[0]?.transactionId).toBe(TX_IDS[0]);
  });

  it('blocks malformed accounts instead of silently excluding them', () => {
    const malformed = {
      id: CASH_ID,
      name: '',
      balance: 100,
      createdAt: 1,
    };

    const plan = planLegacyOpeningBalanceMigration([malformed], []);

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('MALFORMED_ACCOUNT');
    expect(plan.issues[0]?.accountId).toBe(CASH_ID);
  });

  it('blocks semantic-only transactions found before the cutover boundary', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.CASH_SALE, 100, { destinationAccountId: CASH_ID })],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('SEMANTIC_TRANSACTION_BEFORE_CUTOVER');
  });

  it('blocks fractional legacy amounts instead of normalizing VND silently', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.INCOME, 10.5, { destinationAccountId: CASH_ID })],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('INVALID_LEGACY_AMOUNT');
  });

  it('blocks fractional stored balances instead of rounding them', () => {
    const plan = planLegacyOpeningBalanceMigration([account(CASH_ID, 100.5)], []);

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('INVALID_STORED_BALANCE');
  });

  it('blocks duplicate account and transaction ids in an imported snapshot', () => {
    const duplicateAccount = account(CASH_ID, 100, 'Trùng');
    const tx = transaction(TX_IDS[0], TransactionType.REFUND, 10);
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100), duplicateAccount],
      [tx, { ...tx }],
    );

    expect(plan.status).toBe('BLOCKED');
    expect(issueCodes(plan)).toContain('DUPLICATE_ACCOUNT_ID');
    expect(issueCodes(plan)).toContain('DUPLICATE_TRANSACTION_ID');
  });

  it('creates the same source signature regardless of input ordering', () => {
    const accounts = [account(CASH_ID, 100), account(BANK_ID, 200)];
    const transactions = [
      transaction(TX_IDS[0], TransactionType.INCOME, 10, { destinationAccountId: CASH_ID }),
      transaction(TX_IDS[1], TransactionType.EXPENSE, 20, { sourceAccountId: BANK_ID }),
    ];

    const first = planLegacyOpeningBalanceMigration(accounts, transactions);
    const second = planLegacyOpeningBalanceMigration(
      [...accounts].reverse(),
      [...transactions].reverse(),
    );

    expect(first.status).toBe('READY');
    expect(second.status).toBe('READY');
    expect(second.sourceSignature).toBe(first.sourceSignature);
  });

  it('is idempotent when finalizing the same source snapshot again', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.REFUND, 50)],
    );

    const firstState = finalizeLegacyOpeningBalanceMigration(plan);
    const secondState = finalizeLegacyOpeningBalanceMigration(plan, firstState);

    expect(secondState).toBe(firstState);
    expect(secondState.openingEffects).toEqual(firstState.openingEffects);
  });

  it('rejects a second finalization when the source snapshot changed', () => {
    const firstPlan = planLegacyOpeningBalanceMigration([account(CASH_ID, 100)], []);
    const state = finalizeLegacyOpeningBalanceMigration(firstPlan);
    const changedPlan = planLegacyOpeningBalanceMigration([account(CASH_ID, 101)], []);

    expect(() => finalizeLegacyOpeningBalanceMigration(changedPlan, state)).toThrow(
      'already finalized for a different source snapshot',
    );
  });

  it('does not allow a blocked plan to be finalized', () => {
    const plan = planLegacyOpeningBalanceMigration(
      [account(CASH_ID, 100)],
      [transaction(TX_IDS[0], TransactionType.INCOME, 10)],
    );

    expect(() => finalizeLegacyOpeningBalanceMigration(plan)).toThrow(
      'Blocked legacy opening-balance migration cannot be finalized',
    );
  });
});

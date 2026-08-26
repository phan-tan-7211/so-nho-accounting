import { describe, expect, it } from 'vitest';
import { projectDerivedCashBalances } from './derivedCashBalances';
import { OpeningEffectKind } from './legacyOpeningBalanceMigration';
import { TransactionType } from './models';
import type { Account, Transaction } from './models';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ID = '33333333-3333-4333-8333-333333333333';
const TX1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TX2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const TX3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function account(id: string, balance = 0): Account {
  return { id, name: id === CASH_ID ? 'Tiền mặt' : 'Ngân hàng', balance, createdAt: 1 };
}

function tx(
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

function opening(accountId: string, amount: number) {
  return { kind: OpeningEffectKind.OPENING_CASH, accountId, amount } as const;
}

describe('derived cash balances across cutover', () => {
  it('combines opening cash, exact legacy replay, and semantic cash effects', () => {
    const accounts = [account(CASH_ID, 1_200), account(BANK_ID, 700)];
    const transactions = [
      tx(TX1, TransactionType.INCOME, 200, { destinationAccountId: CASH_ID }),
      tx(TX2, TransactionType.CASH_SALE, 300, { destinationAccountId: BANK_ID }),
    ];

    const balances = projectDerivedCashBalances({
      accounts,
      transactions,
      openingEffects: [opening(CASH_ID, 1_000), opening(BANK_ID, 700)],
      legacyTransactionIds: [TX1],
    });

    expect(balances.get(CASH_ID)).toBe(1_200);
    expect(balances.get(BANK_ID)).toBe(1_000);
  });

  it('replays a pre-cutover same-account transfer as net zero', () => {
    const accounts = [account(CASH_ID, 500)];
    const transactions = [
      tx(TX1, TransactionType.TRANSFER, 100, {
        sourceAccountId: CASH_ID,
        destinationAccountId: CASH_ID,
      }),
    ];

    const balances = projectDerivedCashBalances({
      accounts,
      transactions,
      openingEffects: [opening(CASH_ID, 500)],
      legacyTransactionIds: [TX1],
    });

    expect(balances.get(CASH_ID)).toBe(500);
  });

  it('treats a post-cutover transfer semantically even though TRANSFER existed in legacy data', () => {
    const accounts = [account(CASH_ID), account(BANK_ID)];
    const transactions = [
      tx(TX1, TransactionType.TRANSFER, 150, {
        sourceAccountId: CASH_ID,
        destinationAccountId: BANK_ID,
      }),
    ];

    const balances = projectDerivedCashBalances({
      accounts,
      transactions,
      openingEffects: [opening(CASH_ID, 500), opening(BANK_ID, 100)],
      legacyTransactionIds: [],
    });

    expect(balances.get(CASH_ID)).toBe(350);
    expect(balances.get(BANK_ID)).toBe(250);
  });

  it('distinguishes legacy and semantic capital contributions by migration membership', () => {
    const accounts = [account(CASH_ID, 700)];
    const transactions = [
      tx(TX1, TransactionType.CAPITAL_CONTRIBUTION, 200, { destinationAccountId: CASH_ID }),
      tx(TX2, TransactionType.CAPITAL_CONTRIBUTION, 300, { destinationAccountId: CASH_ID }),
    ];

    const balances = projectDerivedCashBalances({
      accounts,
      transactions,
      openingEffects: [opening(CASH_ID, 500)],
      legacyTransactionIds: [TX1],
    });

    expect(balances.get(CASH_ID)).toBe(1_000);
  });

  it('starts accounts created after cutover at zero before semantic effects', () => {
    const accounts = [account(CASH_ID), account(BANK_ID)];
    const transactions = [
      tx(TX1, TransactionType.CASH_SALE, 250, { destinationAccountId: BANK_ID }),
    ];

    const balances = projectDerivedCashBalances({
      accounts,
      transactions,
      openingEffects: [opening(CASH_ID, 100)],
      legacyTransactionIds: [],
    });

    expect(balances.get(CASH_ID)).toBe(100);
    expect(balances.get(BANK_ID)).toBe(250);
  });

  it('fails closed when a transaction captured in the migration state disappears', () => {
    expect(() =>
      projectDerivedCashBalances({
        accounts: [account(CASH_ID)],
        transactions: [],
        openingEffects: [opening(CASH_ID, 0)],
        legacyTransactionIds: [TX1],
      }),
    ).toThrow(`Legacy transaction ${TX1} is missing after cutover`);
  });

  it('fails closed when an opening effect references a deleted account', () => {
    expect(() =>
      projectDerivedCashBalances({
        accounts: [account(CASH_ID)],
        transactions: [],
        openingEffects: [opening(MISSING_ID, 100)],
        legacyTransactionIds: [],
      }),
    ).toThrow(`Opening effect references missing account ${MISSING_ID}`);
  });

  it('rejects a post-cutover legacy-only type instead of silently reinterpreting it', () => {
    expect(() =>
      projectDerivedCashBalances({
        accounts: [account(CASH_ID)],
        transactions: [
          tx(TX3, TransactionType.INCOME, 100, { destinationAccountId: CASH_ID }),
        ],
        openingEffects: [opening(CASH_ID, 0)],
        legacyTransactionIds: [],
      }),
    ).toThrow('Legacy transaction type INCOME requires explicit migration');
  });
});

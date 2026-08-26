import { describe, expect, it } from 'vitest';
import {
  deriveSemanticAccountingEntries,
  projectAccountingDimensions,
} from './accountingProjections';
import { TransactionType } from './models';
import type { Transaction } from './models';

const CASH = '11111111-1111-4111-8111-111111111111';
const BANK = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';

const IDS = Array.from({ length: 20 }, (_, index) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
);

function tx(
  index: number,
  type: Transaction['type'],
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: IDS[index]!,
    date: 100 + index,
    amount,
    type,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const PERIOD = { start: 100, end: 200 };

describe('accounting dimension projections', () => {
  it('projects revenue, expense and VAT activity without treating cash settlement twice', () => {
    const transactions = [
      tx(0, TransactionType.CASH_SALE, 110, {
        destinationAccountId: CASH,
        amountBeforeVat: 100,
        vatAmount: 10,
        vatRate: 10,
      }),
      tx(1, TransactionType.CREDIT_SALE, 220, {
        partnerId: CUSTOMER,
        amountBeforeVat: 200,
        vatAmount: 20,
        vatRate: 10,
      }),
      tx(2, TransactionType.CUSTOMER_PAYMENT, 120, {
        destinationAccountId: BANK,
        partnerId: CUSTOMER,
      }),
      tx(3, TransactionType.CASH_PURCHASE, 55, {
        sourceAccountId: CASH,
        amountBeforeVat: 50,
        vatAmount: 5,
        vatRate: 10,
      }),
      tx(4, TransactionType.CREDIT_PURCHASE, 88, {
        partnerId: SUPPLIER,
        amountBeforeVat: 80,
        vatAmount: 8,
        vatRate: 10,
      }),
      tx(5, TransactionType.SUPPLIER_PAYMENT, 30, {
        sourceAccountId: BANK,
        partnerId: SUPPLIER,
      }),
    ];

    const projection = projectAccountingDimensions({
      transactions,
      legacyTransactionIds: [],
      period: PERIOD,
    });

    expect(projection.activityCoverage.status).toBe('COMPLETE');
    expect(projection.positionCoverage.status).toBe('COMPLETE');
    expect(projection.totals).toEqual({
      revenue: 300,
      expense: 130,
      vatInput: 13,
      vatOutput: 30,
      equity: 0,
      tax: 0,
    });
    expect(projection.vatActivity).toEqual({ input: 13, output: 30, netOutputLessInput: 17 });
    expect(projection.partnerPositions).toEqual([
      { partnerId: CUSTOMER, receivable: 100, payable: 0 },
      { partnerId: SUPPLIER, receivable: 0, payable: 58 },
    ]);
  });

  it('projects customer and supplier refunds as negative revenue/expense and VAT movements', () => {
    const projection = projectAccountingDimensions({
      transactions: [
        tx(0, TransactionType.CUSTOMER_REFUND, 110, {
          sourceAccountId: CASH,
          amountBeforeVat: 100,
          vatAmount: 10,
          vatRate: 10,
        }),
        tx(1, TransactionType.SUPPLIER_REFUND, 55, {
          destinationAccountId: BANK,
          amountBeforeVat: 50,
          vatAmount: 5,
          vatRate: 10,
        }),
      ],
      legacyTransactionIds: [],
      period: PERIOD,
    });

    expect(projection.totals.revenue).toBe(-100);
    expect(projection.totals.expense).toBe(-50);
    expect(projection.totals.vatOutput).toBe(-10);
    expect(projection.totals.vatInput).toBe(-5);
  });

  it('projects capital contribution to equity without creating revenue', () => {
    const projection = projectAccountingDimensions({
      transactions: [
        tx(0, TransactionType.CAPITAL_CONTRIBUTION, 500, {
          destinationAccountId: CASH,
        }),
      ],
      legacyTransactionIds: [],
      period: PERIOD,
    });

    expect(projection.totals.equity).toBe(500);
    expect(projection.equityPosition).toBe(500);
    expect(projection.totals.revenue).toBe(0);
  });

  it('nets an exact reversal against the original semantic effects', () => {
    const original = tx(0, TransactionType.CREDIT_SALE, 110, {
      partnerId: CUSTOMER,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      status: 'REVERSED',
    });
    const reversal = tx(1, TransactionType.REVERSAL, 110, {
      reversalOfTransactionId: original.id,
    });

    const projection = projectAccountingDimensions({
      transactions: [original, reversal],
      legacyTransactionIds: [],
      period: PERIOD,
    });

    expect(projection.totals.revenue).toBe(0);
    expect(projection.totals.vatOutput).toBe(0);
    expect(projection.partnerPositions).toEqual([
      { partnerId: CUSTOMER, receivable: 0, payable: 0 },
    ]);
  });

  it('keeps period activity complete when legacy exists only before the period but marks closing positions partial', () => {
    const legacy = tx(0, TransactionType.INCOME, 100, {
      date: 50,
      destinationAccountId: CASH,
    });
    const sale = tx(1, TransactionType.CREDIT_SALE, 200, {
      date: 150,
      partnerId: CUSTOMER,
    });

    const projection = projectAccountingDimensions({
      transactions: [legacy, sale],
      legacyTransactionIds: [legacy.id],
      period: { start: 100, end: 200 },
    });

    expect(projection.activityCoverage).toEqual({ status: 'COMPLETE', legacyTransactionIds: [] });
    expect(projection.positionCoverage.status).toBe('PARTIAL');
    expect(projection.positionCoverage.legacyTransactionIds).toEqual([legacy.id]);
    expect(projection.totals.revenue).toBe(200);
  });

  it('marks activity partial when a legacy transaction falls inside the reporting period', () => {
    const legacy = tx(0, TransactionType.EXPENSE, 80, {
      date: 120,
      sourceAccountId: CASH,
    });

    const projection = projectAccountingDimensions({
      transactions: [legacy],
      legacyTransactionIds: [legacy.id],
      period: PERIOD,
    });

    expect(projection.activityCoverage.status).toBe('PARTIAL');
    expect(projection.activityCoverage.legacyTransactionIds).toEqual([legacy.id]);
    expect(projection.entries).toEqual([]);
  });

  it('does not include DRAFT semantic transactions in accounting entries', () => {
    const draft = tx(0, TransactionType.CASH_SALE, 100, {
      destinationAccountId: CASH,
      status: 'DRAFT',
    });

    expect(deriveSemanticAccountingEntries([draft], [])).toEqual([]);
  });

  it('rejects a post-cutover legacy-only transaction instead of reinterpreting it', () => {
    const legacyTypeAfterCutover = tx(0, TransactionType.INCOME, 100, {
      destinationAccountId: CASH,
    });

    expect(() =>
      deriveSemanticAccountingEntries([legacyTypeAfterCutover], []),
    ).toThrow(/requires explicit migration/);
  });

  it('rejects duplicate legacy membership ids', () => {
    const legacy = tx(0, TransactionType.INCOME, 100, { destinationAccountId: CASH });
    expect(() => deriveSemanticAccountingEntries([legacy], [legacy.id, legacy.id])).toThrow(
      /Duplicate legacy transaction id/,
    );
  });

  it('rejects missing legacy transactions after cutover', () => {
    expect(() => deriveSemanticAccountingEntries([], [IDS[0]!])).toThrow(
      /is missing after cutover/,
    );
  });

  it('rejects invalid reporting period order', () => {
    expect(() =>
      projectAccountingDimensions({
        transactions: [],
        legacyTransactionIds: [],
        period: { start: 200, end: 100 },
      }),
    ).toThrow(/start must not be after end/);
  });

  it('fails closed when cumulative VND activity exceeds the safe integer range', () => {
    const transactions = [
      tx(0, TransactionType.CASH_SALE, Number.MAX_SAFE_INTEGER, {
        destinationAccountId: CASH,
      }),
      tx(1, TransactionType.CASH_SALE, 1, {
        destinationAccountId: CASH,
      }),
    ];

    expect(() =>
      projectAccountingDimensions({ transactions, legacyTransactionIds: [], period: PERIOD }),
    ).toThrow(/Revenue activity exceeds safe VND integer range/);
  });
});

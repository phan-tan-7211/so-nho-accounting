import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import {
  getTt58BookCapabilities,
  projectTt58CoreActivities,
} from './tt58BookProjections';
import { TransactionType } from './models';
import type { AccountingProfile } from './accountingProfile';
import type { Transaction } from './models';

const CASH = '11111111-1111-4111-8111-111111111111';
const BANK = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';
const IDS = Array.from({ length: 12 }, (_, index) =>
  `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, '0')}`,
);

function profile(
  vatMethod: AccountingProfile['vatMethod'],
  incomeTaxMethod: AccountingProfile['incomeTaxMethod'],
): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: true,
    vatMethod,
    incomeTaxMethod,
    createdAt: 1,
    updatedAt: 1,
  };
}

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

function requiredCodes(p: AccountingProfile): string[] {
  return getTt58BookCapabilities(p)
    .filter((book) => book.required)
    .map((book) => book.code);
}

describe('TT58 book projection capabilities', () => {
  it('maps percent-on-revenue VAT + percent-on-revenue income tax to S1 only', () => {
    expect(requiredCodes(profile('PERCENT_ON_REVENUE', 'PERCENT_ON_REVENUE'))).toEqual([
      'S1-DNSN',
    ]);
  });

  it('maps percent-on-revenue VAT + taxable-income method to the S2 book set', () => {
    expect(requiredCodes(profile('PERCENT_ON_REVENUE', 'TAXABLE_INCOME'))).toEqual([
      'S2a-DNSN',
      'S2b-DNSN',
      'S2c-DNSN',
      'S2d-DNSN',
    ]);
  });

  it('maps deduction VAT + percent-on-revenue income tax to S3a/S3b', () => {
    expect(requiredCodes(profile('DEDUCTION', 'PERCENT_ON_REVENUE'))).toEqual([
      'S3a-DNSN',
      'S3b-DNSN',
    ]);
  });

  it('maps deduction VAT + taxable-income method to S2b/S2c/S2d/S3b', () => {
    expect(requiredCodes(profile('DEDUCTION', 'TAXABLE_INCOME'))).toEqual([
      'S2b-DNSN',
      'S2c-DNSN',
      'S2d-DNSN',
      'S3b-DNSN',
    ]);
  });

  it('keeps S4 books supplementary and does not overclaim inventory/fixed asset/other-tax coverage', () => {
    const capabilities = getTt58BookCapabilities(profile('DEDUCTION', 'TAXABLE_INCOME'));
    const s4a = capabilities.find((book) => book.code === 'S4a-DNSN');
    const s4b = capabilities.find((book) => book.code === 'S4b-DNSN');
    const s4c = capabilities.find((book) => book.code === 'S4c-DNSN');
    const s4d = capabilities.find((book) => book.code === 'S4d-DNSN');
    const s2c = capabilities.find((book) => book.code === 'S2c-DNSN');

    expect(s4a).toMatchObject({ supplementary: true, required: false, status: 'PARTIAL' });
    expect(s4d).toMatchObject({ supplementary: true, required: false, status: 'PARTIAL' });
    expect(s4b?.status).toBe('PLANNED');
    expect(s4c?.status).toBe('PLANNED');
    expect(s2c?.status).toBe('PLANNED');
  });
});

describe('TT58 core activity rows', () => {
  it('projects revenue/expense, VAT, money, debt and equity rows from one effects source', () => {
    const transactions = [
      tx(0, TransactionType.CASH_SALE, 110, {
        destinationAccountId: CASH,
        amountBeforeVat: 100,
        vatAmount: 10,
        vatRate: 10,
        invoiceNumber: 'INV-1',
      }),
      tx(1, TransactionType.CREDIT_SALE, 220, {
        partnerId: CUSTOMER,
        amountBeforeVat: 200,
        vatAmount: 20,
        vatRate: 10,
      }),
      tx(2, TransactionType.CUSTOMER_PAYMENT, 50, {
        destinationAccountId: BANK,
        partnerId: CUSTOMER,
      }),
      tx(3, TransactionType.CREDIT_PURCHASE, 88, {
        partnerId: SUPPLIER,
        amountBeforeVat: 80,
        vatAmount: 8,
        vatRate: 10,
      }),
      tx(4, TransactionType.SUPPLIER_PAYMENT, 30, {
        sourceAccountId: CASH,
        partnerId: SUPPLIER,
      }),
      tx(5, TransactionType.CAPITAL_CONTRIBUTION, 500, {
        destinationAccountId: BANK,
      }),
    ];

    const projection = projectAccountingDimensions({
      transactions,
      legacyTransactionIds: [],
      period: { start: 0, end: 999 },
    });
    const activities = projectTt58CoreActivities(projection);

    expect(activities.revenueExpense).toHaveLength(3);
    expect(activities.vat).toHaveLength(3);
    expect(activities.money).toEqual([
      expect.objectContaining({ transactionId: IDS[0], accountId: CASH, amount: 110 }),
      expect.objectContaining({ transactionId: IDS[2], accountId: BANK, amount: 50 }),
      expect.objectContaining({ transactionId: IDS[4], accountId: CASH, amount: -30 }),
      expect.objectContaining({ transactionId: IDS[5], accountId: BANK, amount: 500 }),
    ]);
    expect(activities.debt).toEqual([
      expect.objectContaining({
        transactionId: IDS[1],
        partnerId: CUSTOMER,
        receivableChange: 220,
        payableChange: 0,
      }),
      expect.objectContaining({
        transactionId: IDS[2],
        partnerId: CUSTOMER,
        receivableChange: -50,
        payableChange: 0,
      }),
      expect.objectContaining({
        transactionId: IDS[3],
        partnerId: SUPPLIER,
        receivableChange: 0,
        payableChange: 88,
      }),
      expect.objectContaining({
        transactionId: IDS[4],
        partnerId: SUPPLIER,
        receivableChange: 0,
        payableChange: -30,
      }),
    ]);
    expect(activities.equity).toEqual([
      expect.objectContaining({ transactionId: IDS[5], amount: 500 }),
    ]);
  });

  it('keeps internal transfer out of revenue/expense/debt/equity while producing two money movements', () => {
    const transfer = tx(0, TransactionType.TRANSFER, 100, {
      sourceAccountId: CASH,
      destinationAccountId: BANK,
    });
    const activities = projectTt58CoreActivities(
      projectAccountingDimensions({
        transactions: [transfer],
        legacyTransactionIds: [],
        period: { start: 0, end: 999 },
      }),
    );

    expect(activities.revenueExpense).toEqual([]);
    expect(activities.vat).toEqual([]);
    expect(activities.debt).toEqual([]);
    expect(activities.equity).toEqual([]);
    expect(activities.money).toEqual([
      expect.objectContaining({ accountId: BANK, amount: 100 }),
      expect.objectContaining({ accountId: CASH, amount: -100 }),
    ]);
  });

  it('preserves signed negative rows for exact reversal instead of silently dropping corrections', () => {
    const original = tx(0, TransactionType.CASH_SALE, 110, {
      destinationAccountId: CASH,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      status: 'REVERSED',
    });
    const reversal = tx(1, TransactionType.REVERSAL, 110, {
      reversalOfTransactionId: original.id,
    });

    const activities = projectTt58CoreActivities(
      projectAccountingDimensions({
        transactions: [original, reversal],
        legacyTransactionIds: [],
        period: { start: 0, end: 999 },
      }),
    );

    expect(activities.revenueExpense).toEqual([
      expect.objectContaining({ transactionId: original.id, revenue: 100 }),
      expect.objectContaining({ transactionId: reversal.id, revenue: -100 }),
    ]);
    expect(activities.vat).toEqual([
      expect.objectContaining({ transactionId: original.id, vatOutput: 10 }),
      expect.objectContaining({ transactionId: reversal.id, vatOutput: -10 }),
    ]);
  });
});

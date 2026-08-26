import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import { OpeningEffectKind } from './legacyOpeningBalanceMigration';
import { AccountKind, TransactionType, Tt58ExpenseCategory } from './models';
import type { Account, Transaction } from './models';
import { materializeTt58Books } from './tt58MaterializedBooks';

const CASH = '11111111-1111-4111-8111-111111111111';
const BANK = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';
const IDS = Array.from({ length: 16 }, (_, index) =>
  `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
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

function account(id: string, name: string, kind?: Account['kind']): Account {
  return { id, name, kind, balance: 0, createdAt: 1 };
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

function materialize(
  p: AccountingProfile,
  transactions: readonly Transaction[],
  accounts: readonly Account[] = [],
  period = { start: 100, end: 999 },
) {
  const projection = projectAccountingDimensions({
    transactions,
    legacyTransactionIds: [],
    period,
  });
  return materializeTt58Books({
    profile: p,
    projection,
    accounts,
    transactions,
    openingEffects: accounts.map((item) => ({
      kind: OpeningEffectKind.OPENING_CASH,
      accountId: item.id,
      amount: item.id === CASH ? 1_000 : 0,
    })),
    legacyTransactionIds: [],
    period,
  });
}

describe('TT58 materialized books', () => {
  it('materializes S1 completely from explicit tax revenue bases and rates', () => {
    const sale = tx(0, TransactionType.CASH_SALE, 110, {
      destinationAccountId: CASH,
      documentNumber: 'HD-001',
      taxActivityLabel: 'Phân phối, cung cấp hàng hóa',
      taxRevenueAmount: 110,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 0.5,
    });
    const refund = tx(1, TransactionType.CUSTOMER_REFUND, 22, {
      sourceAccountId: CASH,
      documentNumber: 'DC-001',
      taxActivityLabel: 'Phân phối, cung cấp hàng hóa',
      taxRevenueAmount: 22,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 0.5,
    });

    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'PERCENT_ON_REVENUE'),
      [sale, refund],
    );

    expect(books.s1?.status).toBe('IMPLEMENTED');
    expect(books.s1?.issues).toEqual([]);
    expect(books.s1?.groups).toHaveLength(1);
    expect(books.s1?.groups[0]).toMatchObject({
      totalRevenue: 88,
      vatTaxDue: 1,
      incomeTaxDue: 0,
    });
    expect(books.s1?.totalRevenue).toBe(88);
    expect(books.s1?.totalVatTaxDue).toBe(1);
  });

  it('keeps S1 partial instead of inferring a missing tax base or revenue tax rate', () => {
    const sale = tx(0, TransactionType.CREDIT_SALE, 100, {
      partnerId: CUSTOMER,
      documentNumber: 'HD-002',
      taxActivityLabel: 'Dịch vụ',
    });
    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'PERCENT_ON_REVENUE'),
      [sale],
    );

    expect(books.s1?.status).toBe('PARTIAL');
    expect(books.s1?.issues.map((issue) => issue.code)).toEqual([
      'MISSING_TAX_REVENUE_AMOUNT',
      'MISSING_VAT_REVENUE_RATE',
      'MISSING_INCOME_TAX_REVENUE_RATE',
    ]);
    expect(books.s1?.groups).toEqual([]);
  });

  it('inherits the original tax classification for an exact reversal and nets S1 to zero', () => {
    const sale = tx(0, TransactionType.CASH_SALE, 100, {
      destinationAccountId: CASH,
      documentNumber: 'HD-003',
      taxActivityLabel: 'Dịch vụ',
      taxRevenueAmount: 100,
      vatRevenueRate: 5,
      incomeTaxRevenueRate: 2,
      status: 'REVERSED',
    });
    const reversal = tx(1, TransactionType.REVERSAL, 100, {
      reversalOfTransactionId: sale.id,
      documentNumber: 'DC-003',
    });

    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'PERCENT_ON_REVENUE'),
      [sale, reversal],
    );

    expect(books.s1?.status).toBe('IMPLEMENTED');
    expect(books.s1?.groups[0]?.rows.map((row) => row.taxRevenueAmount)).toEqual([100, -100]);
    expect(books.s1?.groups[0]?.totalRevenue).toBe(0);
    expect(books.s1?.totalVatTaxDue).toBe(0);
    expect(books.s1?.totalIncomeTaxDue).toBe(0);
  });

  it('materializes S2d opening, movements and running balances by explicit money-account kind', () => {
    const accounts = [
      account(CASH, 'Tiền mặt', AccountKind.CASH),
      account(BANK, 'Ngân hàng A', AccountKind.DEMAND_DEPOSIT),
    ];
    const transactions = [
      tx(0, TransactionType.CASH_SALE, 100, {
        destinationAccountId: CASH,
        documentNumber: 'PT-001',
      }),
      tx(1, TransactionType.TRANSFER, 200, {
        sourceAccountId: CASH,
        destinationAccountId: BANK,
        documentNumber: 'UNC-001',
      }),
    ];

    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'TAXABLE_INCOME'),
      transactions,
      accounts,
    );

    expect(books.s2d?.status).toBe('IMPLEMENTED');
    expect(books.s2d?.issues).toEqual([]);
    expect(books.s2d?.sections).toEqual([
      expect.objectContaining({
        accountId: CASH,
        accountKind: AccountKind.CASH,
        openingBalance: 1_000,
        totalIn: 100,
        totalOut: 200,
        closingBalance: 900,
      }),
      expect.objectContaining({
        accountId: BANK,
        accountKind: AccountKind.DEMAND_DEPOSIT,
        openingBalance: 0,
        totalIn: 200,
        totalOut: 0,
        closingBalance: 200,
      }),
    ]);
  });

  it('keeps S2d partial when a relevant money account has not been classified', () => {
    const accounts = [account(CASH, 'Tiền mặt')];
    const transactions = [
      tx(0, TransactionType.CASH_SALE, 100, {
        destinationAccountId: CASH,
        documentNumber: 'PT-002',
      }),
    ];

    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'TAXABLE_INCOME'),
      transactions,
      accounts,
    );

    expect(books.s2d?.status).toBe('PARTIAL');
    expect(books.s2d?.issues).toEqual([
      expect.objectContaining({ code: 'MISSING_ACCOUNT_KIND', accountId: CASH }),
    ]);
  });

  it('maps S2b expenses to the six explicit TT58 expense groups while keeping tax settlement partial', () => {
    const purchase = tx(0, TransactionType.CREDIT_PURCHASE, 80, {
      partnerId: SUPPLIER,
      documentNumber: 'HD-M-001',
      tt58ExpenseCategory: Tt58ExpenseCategory.OUTSIDE_SERVICES,
    });
    const books = materialize(
      profile('PERCENT_ON_REVENUE', 'TAXABLE_INCOME'),
      [purchase],
    );

    expect(books.s2b?.status).toBe('PARTIAL');
    expect(books.s2b?.expenseTotal).toBe(80);
    expect(books.s2b?.expenseTotals[Tt58ExpenseCategory.OUTSIDE_SERVICES]).toBe(80);
    expect(books.s2b?.issues.map((issue) => issue.code)).toContain('TAX_SETTLEMENT_DOMAIN_PENDING');
  });

  it('uses only explicitly deductible input VAT in S3b and never assumes eligibility', () => {
    const deductible = tx(0, TransactionType.CREDIT_PURCHASE, 110, {
      partnerId: SUPPLIER,
      documentNumber: 'HD-V-001',
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      vatDeductible: true,
    });
    const nonDeductible = tx(1, TransactionType.CASH_PURCHASE, 55, {
      sourceAccountId: CASH,
      documentNumber: 'HD-V-002',
      amountBeforeVat: 50,
      vatAmount: 5,
      vatRate: 10,
      vatDeductible: false,
    });
    const unknown = tx(2, TransactionType.CREDIT_PURCHASE, 22, {
      partnerId: SUPPLIER,
      documentNumber: 'HD-V-003',
      amountBeforeVat: 20,
      vatAmount: 2,
      vatRate: 10,
    });
    const sale = tx(3, TransactionType.CASH_SALE, 220, {
      destinationAccountId: CASH,
      documentNumber: 'HD-B-001',
      amountBeforeVat: 200,
      vatAmount: 20,
      vatRate: 10,
    });

    const books = materialize(
      profile('DEDUCTION', 'PERCENT_ON_REVENUE'),
      [deductible, nonDeductible, unknown, sale],
    );

    expect(books.s3b?.deductibleVatInputTotal).toBe(10);
    expect(books.s3b?.vatOutputTotal).toBe(20);
    expect(books.s3b?.periodVatOutputLessDeductibleInput).toBe(10);
    expect(books.s3b?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY',
        transactionId: unknown.id,
      }),
      expect.objectContaining({ code: 'VAT_SETTLEMENT_DOMAIN_PENDING' }),
    ]));
  });
});

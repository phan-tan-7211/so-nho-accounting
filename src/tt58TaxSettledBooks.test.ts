import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import { TaxType, TransactionType, Tt58ExpenseCategory } from './models';
import type { Transaction } from './models';
import { createTaxOpeningPosition } from './taxOpeningPosition';
import { projectTt58TaxSettlements } from './taxSettlement';
import type { Tt58MaterializedBooks } from './tt58MaterializedBooks';
import { finalizeTt58BooksWithTaxSettlement } from './tt58TaxSettledBooks';

const CASH = '11111111-1111-4111-8111-111111111111';
const IDS = Array.from({ length: 10 }, (_, index) =>
  `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, '0')}`,
);
const PERIOD = { start: 100, end: 199 } as const;

function profile(vatMethod: AccountingProfile['vatMethod']): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: true,
    vatMethod,
    incomeTaxMethod: 'TAXABLE_INCOME',
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
    date: 120 + index,
    amount,
    type,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function expenseBook(transactionId: string): Tt58MaterializedBooks['s2b'] {
  return {
    code: 'S2b-DNSN',
    status: 'PARTIAL',
    issues: [
      {
        code: 'TAX_SETTLEMENT_DOMAIN_PENDING',
        message: 'pending tax settlement',
      },
      {
        code: 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING',
        message: 'pending non-deductible VAT allocation',
      },
    ],
    rows: [
      {
        transactionId,
        date: 120,
        documentNumber: 'PUR-1',
        section: 'EXPENSE',
        expenseCategory: Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
        amount: 100,
      },
    ],
    revenueTotal: 0,
    expenseTotals: {
      MATERIALS_GOODS_ENERGY: 100,
      LABOR: 0,
      DEPRECIATION: 0,
      OUTSIDE_SERVICES: 0,
      INTEREST: 0,
      OTHER_DIRECT_BUSINESS: 0,
    },
    expenseTotal: 100,
  };
}

describe('TT58 tax-settled book finalization', () => {
  it('adds explicitly non-deductible input VAT to S2b expense under VAT deduction', () => {
    const purchase = tx(0, TransactionType.CASH_PURCHASE, 110, {
      sourceAccountId: CASH,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      vatDeductible: false,
      tt58ExpenseCategory: Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
      documentNumber: 'PUR-1',
    });
    const assessment = tx(1, TransactionType.TAX_ASSESSMENT, 30, {
      taxType: TaxType.INCOME_TAX,
      taxPeriodStart: PERIOD.start,
      taxPeriodEnd: PERIOD.end,
      documentNumber: 'CIT-ASS-1',
    });
    const payment = tx(2, TransactionType.TAX_PAYMENT, 10, {
      taxType: TaxType.INCOME_TAX,
      sourceAccountId: CASH,
      documentNumber: 'CIT-PAY-1',
    });
    const transactions = [purchase, assessment, payment];
    const projection = projectAccountingDimensions({
      transactions,
      legacyTransactionIds: [],
      period: PERIOD,
    });
    const books: Tt58MaterializedBooks = {
      s2b: expenseBook(purchase.id),
      s2d: { code: 'S2d-DNSN', status: 'IMPLEMENTED', issues: [], sections: [] },
      s3b: {
        code: 'S3b-DNSN',
        status: 'PARTIAL',
        issues: [{ code: 'VAT_SETTLEMENT_DOMAIN_PENDING', message: 'pending VAT settlement' }],
        rows: [],
        deductibleVatInputTotal: 0,
        vatOutputTotal: 0,
        periodVatOutputLessDeductibleInput: 0,
      },
    };
    const settlements = projectTt58TaxSettlements({
      profile: profile('DEDUCTION'),
      projection,
      transactions,
      taxOpeningPositions: [
        createTaxOpeningPosition({ taxType: TaxType.VAT, periodStart: PERIOD.start, amount: 0, now: 1 }),
        createTaxOpeningPosition({ taxType: TaxType.INCOME_TAX, periodStart: PERIOD.start, amount: 5, now: 1 }),
      ],
      materializedBooks: books,
      period: PERIOD,
    });

    const finalized = finalizeTt58BooksWithTaxSettlement({
      profile: profile('DEDUCTION'),
      projection,
      transactions,
      books,
      settlements,
    });

    expect(finalized.s2b).toMatchObject({
      status: 'IMPLEMENTED',
      expenseTotal: 110,
      taxSettlement: {
        openingPayable: 5,
        periodNetTaxChange: 30,
        paid: 10,
        closingPayable: 25,
      },
    });
    expect(finalized.s2b?.expenseTotals.MATERIALS_GOODS_ENERGY).toBe(110);
    expect(finalized.s2b?.rows[0]).toMatchObject({ amount: 110 });
  });

  it('treats all input VAT as expense for S2b when VAT is percentage-on-revenue', () => {
    const purchase = tx(0, TransactionType.CASH_PURCHASE, 110, {
      sourceAccountId: CASH,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      tt58ExpenseCategory: Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
      documentNumber: 'PUR-1',
    });
    const assessment = tx(1, TransactionType.TAX_ASSESSMENT, 0, {
      taxType: TaxType.INCOME_TAX,
      taxPeriodStart: PERIOD.start,
      taxPeriodEnd: PERIOD.end,
    });
    const transactions = [purchase, assessment];
    const projection = projectAccountingDimensions({ transactions, legacyTransactionIds: [], period: PERIOD });
    const books: Tt58MaterializedBooks = {
      s2a: {
        code: 'S2a-DNSN',
        status: 'PARTIAL',
        issues: [{ code: 'VAT_SETTLEMENT_DOMAIN_PENDING', message: 'pending VAT settlement' }],
        groups: [],
        totalRevenue: 0,
        totalVatTaxDue: 0,
      },
      s2b: expenseBook(purchase.id),
      s2d: { code: 'S2d-DNSN', status: 'IMPLEMENTED', issues: [], sections: [] },
    };
    const p = profile('PERCENT_ON_REVENUE');
    const settlements = projectTt58TaxSettlements({
      profile: p,
      projection,
      transactions,
      taxOpeningPositions: [
        createTaxOpeningPosition({ taxType: TaxType.VAT, periodStart: PERIOD.start, amount: 0, now: 1 }),
        createTaxOpeningPosition({ taxType: TaxType.INCOME_TAX, periodStart: PERIOD.start, amount: 0, now: 1 }),
      ],
      materializedBooks: books,
      period: PERIOD,
    });

    const finalized = finalizeTt58BooksWithTaxSettlement({
      profile: p,
      projection,
      transactions,
      books,
      settlements,
    });

    expect(finalized.s2b?.status).toBe('IMPLEMENTED');
    expect(finalized.s2b?.expenseTotal).toBe(110);
    expect(finalized.s2b?.issues.some((issue) => issue.code === 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY')).toBe(false);
  });

  it('promotes S2a from pending settlement to IMPLEMENTED when VAT opening and payments are complete', () => {
    const payment = tx(0, TransactionType.TAX_PAYMENT, 5, {
      taxType: TaxType.VAT,
      sourceAccountId: CASH,
    });
    const assessment = tx(1, TransactionType.TAX_ASSESSMENT, 0, {
      taxType: TaxType.INCOME_TAX,
      taxPeriodStart: PERIOD.start,
      taxPeriodEnd: PERIOD.end,
    });
    const transactions = [payment, assessment];
    const projection = projectAccountingDimensions({ transactions, legacyTransactionIds: [], period: PERIOD });
    const books: Tt58MaterializedBooks = {
      s2a: {
        code: 'S2a-DNSN',
        status: 'PARTIAL',
        issues: [{ code: 'VAT_SETTLEMENT_DOMAIN_PENDING', message: 'pending VAT settlement' }],
        groups: [],
        totalRevenue: 100,
        totalVatTaxDue: 10,
      },
      s2b: {
        code: 'S2b-DNSN',
        status: 'PARTIAL',
        issues: [
          { code: 'TAX_SETTLEMENT_DOMAIN_PENDING', message: 'pending TNDN settlement' },
          { code: 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING', message: 'pending VAT allocation' },
        ],
        rows: [],
        revenueTotal: 0,
        expenseTotals: {
          MATERIALS_GOODS_ENERGY: 0,
          LABOR: 0,
          DEPRECIATION: 0,
          OUTSIDE_SERVICES: 0,
          INTEREST: 0,
          OTHER_DIRECT_BUSINESS: 0,
        },
        expenseTotal: 0,
      },
      s2d: { code: 'S2d-DNSN', status: 'IMPLEMENTED', issues: [], sections: [] },
    };
    const p = profile('PERCENT_ON_REVENUE');
    const settlements = projectTt58TaxSettlements({
      profile: p,
      projection,
      transactions,
      taxOpeningPositions: [
        createTaxOpeningPosition({ taxType: TaxType.VAT, periodStart: PERIOD.start, amount: 2, now: 1 }),
        createTaxOpeningPosition({ taxType: TaxType.INCOME_TAX, periodStart: PERIOD.start, amount: 0, now: 1 }),
      ],
      materializedBooks: books,
      period: PERIOD,
    });
    const finalized = finalizeTt58BooksWithTaxSettlement({
      profile: p,
      projection,
      transactions,
      books,
      settlements,
    });

    expect(finalized.s2a).toMatchObject({
      status: 'IMPLEMENTED',
      taxSettlement: { openingPayable: 2, periodTaxDue: 10, paid: 5, closingPayable: 7 },
    });
  });

  it('keeps S3b partial when input VAT deductibility is still missing even with complete settlement', () => {
    const p: AccountingProfile = {
      ...profile('DEDUCTION'),
      incomeTaxMethod: 'PERCENT_ON_REVENUE',
    };
    const transactions: Transaction[] = [];
    const projection = projectAccountingDimensions({ transactions, legacyTransactionIds: [], period: PERIOD });
    const books: Tt58MaterializedBooks = {
      s3a: {
        code: 'S3a-DNSN',
        status: 'PARTIAL',
        issues: [{ code: 'TAX_SETTLEMENT_DOMAIN_PENDING', message: 'pending TNDN settlement' }],
        groups: [],
        totalRevenue: 0,
        totalIncomeTaxDue: 0,
      },
      s3b: {
        code: 'S3b-DNSN',
        status: 'PARTIAL',
        issues: [
          {
            code: 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY',
            message: 'input VAT eligibility missing',
            transactionId: IDS[0],
          },
          { code: 'VAT_SETTLEMENT_DOMAIN_PENDING', message: 'pending VAT settlement' },
        ],
        rows: [],
        deductibleVatInputTotal: 0,
        vatOutputTotal: 0,
        periodVatOutputLessDeductibleInput: 0,
      },
    };
    const settlements = projectTt58TaxSettlements({
      profile: p,
      projection,
      transactions,
      taxOpeningPositions: [
        createTaxOpeningPosition({ taxType: TaxType.VAT, periodStart: PERIOD.start, amount: 0, now: 1 }),
        createTaxOpeningPosition({ taxType: TaxType.INCOME_TAX, periodStart: PERIOD.start, amount: 0, now: 1 }),
      ],
      materializedBooks: books,
      period: PERIOD,
    });
    const finalized = finalizeTt58BooksWithTaxSettlement({
      profile: p,
      projection,
      transactions,
      books,
      settlements,
    });

    expect(finalized.s3b?.status).toBe('PARTIAL');
    expect(finalized.s3b?.issues.map((issue) => issue.code)).toContain(
      'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY',
    );
  });
});

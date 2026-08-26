import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import { TaxType, TransactionType } from './models';
import type { Transaction } from './models';
import { createTaxOpeningPosition } from './taxOpeningPosition';
import { projectTt58TaxSettlements } from './taxSettlement';
import type { Tt58MaterializedBooks } from './tt58MaterializedBooks';

const CASH = '11111111-1111-4111-8111-111111111111';
const IDS = Array.from({ length: 12 }, (_, index) =>
  `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}`,
);
const PERIOD = { start: 100, end: 199 } as const;

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
    date: 120 + index,
    amount,
    type,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function opening(taxType: 'VAT' | 'INCOME_TAX', amount: number) {
  return createTaxOpeningPosition({ taxType, periodStart: PERIOD.start, amount, now: 1 });
}

function projection(transactions: readonly Transaction[]) {
  return projectAccountingDimensions({
    transactions,
    legacyTransactionIds: [],
    period: PERIOD,
  });
}

describe('TT58 tax settlement projection', () => {
  it('projects S2a VAT opening, period tax due, payment and closing payable', () => {
    const transactions = [
      tx(0, TransactionType.TAX_PAYMENT, 10, {
        taxType: TaxType.VAT,
        sourceAccountId: CASH,
      }),
      tx(1, TransactionType.TAX_ASSESSMENT, 0, {
        taxType: TaxType.INCOME_TAX,
        taxPeriodStart: PERIOD.start,
        taxPeriodEnd: PERIOD.end,
      }),
    ];
    const books: Tt58MaterializedBooks = {
      s2a: {
        code: 'S2a-DNSN',
        status: 'PARTIAL',
        issues: [],
        groups: [],
        totalRevenue: 1_000,
        totalVatTaxDue: 20,
      },
      s2b: {
        code: 'S2b-DNSN',
        status: 'PARTIAL',
        issues: [],
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

    const result = projectTt58TaxSettlements({
      profile: profile('PERCENT_ON_REVENUE', 'TAXABLE_INCOME'),
      projection: projection(transactions),
      transactions,
      taxOpeningPositions: [
        opening(TaxType.VAT, 5),
        opening(TaxType.INCOME_TAX, 0),
      ],
      materializedBooks: books,
      period: PERIOD,
    });

    expect(result.vat).toMatchObject({
      status: 'COMPLETE',
      openingPayable: 5,
      periodNetTaxChange: 20,
      periodTaxDue: 20,
      paid: 10,
      refunded: 0,
      closingPayable: 15,
      closingCredit: 0,
    });
    expect(result.incomeTax).toMatchObject({
      status: 'COMPLETE',
      assessmentConfirmed: true,
      periodNetTaxChange: 0,
      closingPayable: 0,
    });
  });

  it('projects S3b VAT credit, input/output activity and VAT refund using the TT58 signed formula', () => {
    const transactions = [
      tx(0, TransactionType.TAX_REFUND, 10, {
        taxType: TaxType.VAT,
        destinationAccountId: CASH,
      }),
    ];
    const books: Tt58MaterializedBooks = {
      s3a: {
        code: 'S3a-DNSN',
        status: 'PARTIAL',
        issues: [],
        groups: [],
        totalRevenue: 0,
        totalIncomeTaxDue: 0,
      },
      s3b: {
        code: 'S3b-DNSN',
        status: 'PARTIAL',
        issues: [],
        rows: [],
        deductibleVatInputTotal: 50,
        vatOutputTotal: 20,
        periodVatOutputLessDeductibleInput: -30,
      },
    };

    const result = projectTt58TaxSettlements({
      profile: profile('DEDUCTION', 'PERCENT_ON_REVENUE'),
      projection: projection(transactions),
      transactions,
      taxOpeningPositions: [
        opening(TaxType.VAT, -30),
        opening(TaxType.INCOME_TAX, 0),
      ],
      materializedBooks: books,
      period: PERIOD,
    });

    expect(result.vat).toMatchObject({
      status: 'COMPLETE',
      openingCredit: 30,
      periodNetTaxChange: -30,
      paid: 0,
      refunded: 10,
      closingPayable: 0,
      closingCredit: 50,
    });
  });

  it('requires an explicit income-tax assessment for TAXABLE_INCOME, including zero-tax periods', () => {
    const transactions: Transaction[] = [];
    const result = projectTt58TaxSettlements({
      profile: profile('DEDUCTION', 'TAXABLE_INCOME'),
      projection: projection(transactions),
      transactions,
      taxOpeningPositions: [
        opening(TaxType.VAT, 0),
        opening(TaxType.INCOME_TAX, 0),
      ],
      materializedBooks: {
        s2b: {
          code: 'S2b-DNSN',
          status: 'PARTIAL',
          issues: [],
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
        s3b: {
          code: 'S3b-DNSN',
          status: 'PARTIAL',
          issues: [],
          rows: [],
          deductibleVatInputTotal: 0,
          vatOutputTotal: 0,
          periodVatOutputLessDeductibleInput: 0,
        },
      },
      period: PERIOD,
    });

    expect(result.incomeTax?.status).toBe('PARTIAL');
    expect(result.incomeTax?.issues.map((issue) => issue.code)).toContain(
      'MISSING_INCOME_TAX_ASSESSMENT',
    );
  });

  it('nets an exact reversal of tax payment instead of treating it as a tax refund', () => {
    const payment = tx(0, TransactionType.TAX_PAYMENT, 25, {
      taxType: TaxType.VAT,
      sourceAccountId: CASH,
      status: 'REVERSED',
    });
    const reversal = tx(1, TransactionType.REVERSAL, 25, {
      reversalOfTransactionId: payment.id,
    });
    const transactions = [payment, reversal];

    const result = projectTt58TaxSettlements({
      profile: profile('DEDUCTION', 'PERCENT_ON_REVENUE'),
      projection: projection(transactions),
      transactions,
      taxOpeningPositions: [
        opening(TaxType.VAT, 100),
        opening(TaxType.INCOME_TAX, 0),
      ],
      materializedBooks: {
        s3a: {
          code: 'S3a-DNSN',
          status: 'PARTIAL',
          issues: [],
          groups: [],
          totalRevenue: 0,
          totalIncomeTaxDue: 0,
        },
        s3b: {
          code: 'S3b-DNSN',
          status: 'PARTIAL',
          issues: [],
          rows: [],
          deductibleVatInputTotal: 0,
          vatOutputTotal: 0,
          periodVatOutputLessDeductibleInput: 0,
        },
      },
      period: PERIOD,
    });

    expect(result.vat).toMatchObject({
      paid: 0,
      refunded: 0,
      closingPayable: 100,
    });
  });
});

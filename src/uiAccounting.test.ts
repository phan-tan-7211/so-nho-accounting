import { describe, expect, it } from 'vitest';
import type { AccountingProfile } from './accountingProfile';
import { TaxType, TransactionType } from './models';
import {
  createEmptyTransactionDraft,
  createPostedTransactionInput,
  getTransactionFormRequirements,
  monthInputToPeriod,
} from './uiAccounting';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const BANK_ID = '22222222-2222-4222-8222-222222222222';
const PARTNER_ID = '33333333-3333-4333-8333-333333333333';

const deductionProfile: AccountingProfile = {
  id: 'primary',
  regime: 'TT58_2026_MICRO',
  entityType: 'MICRO_ENTERPRISE',
  dataStartDate: '2026-07-01',
  taxProfileConfigured: true,
  vatMethod: 'DEDUCTION',
  incomeTaxMethod: 'TAXABLE_INCOME',
  createdAt: 1,
  updatedAt: 1,
};

describe('TT58 UI accounting helpers', () => {
  it('uses local calendar boundaries for a selected monthly reporting period', () => {
    const period = monthInputToPeriod('2026-08');
    const start = new Date(period.start);
    const end = new Date(period.end);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 7, 1, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 7, 31]);
    expect(end.getTime() + 1).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
  });

  it('exposes exact relationship requirements per semantic type', () => {
    expect(getTransactionFormRequirements(TransactionType.CREDIT_SALE)).toMatchObject({
      destinationAccount: false,
      partner: true,
      vatInvoice: true,
      revenueTaxMetadata: true,
    });
    expect(getTransactionFormRequirements(TransactionType.TAX_PAYMENT)).toMatchObject({
      sourceAccount: true,
      taxType: true,
      assessmentPeriod: false,
    });
    expect(getTransactionFormRequirements(TransactionType.TAX_ASSESSMENT)).toMatchObject({
      sourceAccount: false,
      destinationAccount: false,
      taxType: false,
      assessmentPeriod: true,
    });
  });

  it('builds a cash sale with invoice and explicit TT58 percentage metadata without inferring values', () => {
    const draft = createEmptyTransactionDraft(new Date(2026, 7, 10, 10).getTime());
    Object.assign(draft, {
      type: TransactionType.CASH_SALE,
      amount: '1.100.000',
      destinationAccountId: CASH_ID,
      amountBeforeVat: '1000000',
      vatAmount: '100000',
      vatRate: '10',
      documentNumber: 'PT-01',
      taxActivityLabel: 'Dịch vụ',
      taxRevenueAmount: '950000',
      vatRevenueRate: '5',
      incomeTaxRevenueRate: '2',
    });

    expect(createPostedTransactionInput(draft, deductionProfile)).toMatchObject({
      type: TransactionType.CASH_SALE,
      amount: 1_100_000,
      destinationAccountId: CASH_ID,
      amountBeforeVat: 1_000_000,
      vatAmount: 100_000,
      vatRate: 10,
      taxRevenueAmount: 950_000,
      vatRevenueRate: 5,
      incomeTaxRevenueRate: 2,
    });
  });

  it('requires partner for credit activity', () => {
    const draft = createEmptyTransactionDraft();
    Object.assign(draft, { type: TransactionType.CREDIT_SALE, amount: '1000' });
    expect(() => createPostedTransactionInput(draft, deductionProfile)).toThrow('Partner ID');

    draft.partnerId = PARTNER_ID;
    expect(createPostedTransactionInput(draft, deductionProfile).partnerId).toBe(PARTNER_ID);
  });

  it('requires explicit deductibility when deduction-profile purchase carries input VAT', () => {
    const draft = createEmptyTransactionDraft();
    Object.assign(draft, {
      type: TransactionType.CASH_PURCHASE,
      amount: '1100',
      sourceAccountId: CASH_ID,
      amountBeforeVat: '1000',
      vatAmount: '100',
      vatRate: '10',
      tt58ExpenseCategory: 'OUTSIDE_SERVICES',
    });
    expect(() => createPostedTransactionInput(draft, deductionProfile)).toThrow('khấu trừ');
    draft.vatDeductible = 'false';
    expect(createPostedTransactionInput(draft, deductionProfile).vatDeductible).toBe(false);
  });

  it('pins VAT refund to VAT and the selected destination account', () => {
    const draft = createEmptyTransactionDraft();
    Object.assign(draft, {
      type: TransactionType.TAX_REFUND,
      amount: '250000',
      destinationAccountId: BANK_ID,
      taxType: TaxType.INCOME_TAX,
    });
    expect(createPostedTransactionInput(draft, deductionProfile)).toMatchObject({
      type: TransactionType.TAX_REFUND,
      amount: 250_000,
      destinationAccountId: BANK_ID,
      taxType: TaxType.VAT,
    });
  });

  it('builds a zero income-tax assessment for the exact selected month', () => {
    const draft = createEmptyTransactionDraft();
    Object.assign(draft, {
      type: TransactionType.TAX_ASSESSMENT,
      amount: '0',
      taxPeriodMonth: '2026-08',
    });
    const input = createPostedTransactionInput(draft, deductionProfile);
    const period = monthInputToPeriod('2026-08');
    expect(input).toMatchObject({
      type: TransactionType.TAX_ASSESSMENT,
      amount: 0,
      taxType: TaxType.INCOME_TAX,
      taxPeriodStart: period.start,
      taxPeriodEnd: period.end,
    });
  });
});

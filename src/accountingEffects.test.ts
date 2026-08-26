import { describe, expect, it } from 'vitest';
import {
  AccountingEffectKind,
  calculateVatAmount,
  deriveAccountingEffects,
  deriveAccountingEffectsForTransactions,
  projectCashBalances,
} from './accountingEffects';
import { TransactionType } from './models';
import type { Transaction } from './models';

const CASH = '00000000-0000-4000-8000-000000000001';
const BANK = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const SUPPLIER = '00000000-0000-4000-8000-000000000004';

let sequence = 10;

function makeTransaction(
  overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>,
): Transaction {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    date: 1_788_000_000_000,
    status: 'POSTED',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
    ...overrides,
  };
}

describe('calculateVatAmount', () => {
  it('centralizes VND VAT rounding', () => {
    expect(calculateVatAmount(33_333, 8)).toBe(2_667);
  });
});

describe('deriveAccountingEffects', () => {
  it('cash sale increases cash by gross, revenue by net and VAT output separately', () => {
    const tx = makeTransaction({
      type: TransactionType.CASH_SALE,
      amount: 110_000,
      amountBeforeVat: 100_000,
      vatAmount: 10_000,
      vatRate: 10,
      destinationAccountId: CASH,
    });

    expect(deriveAccountingEffects(tx)).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 110_000, accountId: CASH },
      { kind: AccountingEffectKind.REVENUE, amount: 100_000 },
      { kind: AccountingEffectKind.VAT_OUTPUT, amount: 10_000 },
    ]);
  });

  it('credit sale creates receivable without changing cash', () => {
    const tx = makeTransaction({
      type: TransactionType.CREDIT_SALE,
      amount: 110_000,
      amountBeforeVat: 100_000,
      vatAmount: 10_000,
      partnerId: CUSTOMER,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toContainEqual({
      kind: AccountingEffectKind.RECEIVABLE,
      amount: 110_000,
      partnerId: CUSTOMER,
    });
    expect(effects).toContainEqual({ kind: AccountingEffectKind.REVENUE, amount: 100_000 });
    expect(effects).toContainEqual({ kind: AccountingEffectKind.VAT_OUTPUT, amount: 10_000 });
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.CASH)).toBe(false);
  });

  it('customer payment reduces receivable without recording revenue or VAT again', () => {
    const tx = makeTransaction({
      type: TransactionType.CUSTOMER_PAYMENT,
      amount: 60_000,
      destinationAccountId: BANK,
      partnerId: CUSTOMER,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 60_000, accountId: BANK },
      { kind: AccountingEffectKind.RECEIVABLE, amount: -60_000, partnerId: CUSTOMER },
    ]);
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.REVENUE)).toBe(false);
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.VAT_OUTPUT)).toBe(false);
  });

  it('cash purchase separates expense and VAT input from cash paid', () => {
    const tx = makeTransaction({
      type: TransactionType.CASH_PURCHASE,
      amount: 108_000,
      amountBeforeVat: 100_000,
      vatAmount: 8_000,
      vatRate: 8,
      sourceAccountId: CASH,
    });

    expect(deriveAccountingEffects(tx)).toEqual([
      { kind: AccountingEffectKind.CASH, amount: -108_000, accountId: CASH },
      { kind: AccountingEffectKind.EXPENSE, amount: 100_000 },
      { kind: AccountingEffectKind.VAT_INPUT, amount: 8_000 },
    ]);
  });

  it('credit purchase creates payable without decreasing cash', () => {
    const tx = makeTransaction({
      type: TransactionType.CREDIT_PURCHASE,
      amount: 108_000,
      amountBeforeVat: 100_000,
      vatAmount: 8_000,
      partnerId: SUPPLIER,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toContainEqual({
      kind: AccountingEffectKind.PAYABLE,
      amount: 108_000,
      partnerId: SUPPLIER,
    });
    expect(effects).toContainEqual({ kind: AccountingEffectKind.EXPENSE, amount: 100_000 });
    expect(effects).toContainEqual({ kind: AccountingEffectKind.VAT_INPUT, amount: 8_000 });
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.CASH)).toBe(false);
  });

  it('supplier payment reduces cash and payable without recording expense again', () => {
    const tx = makeTransaction({
      type: TransactionType.SUPPLIER_PAYMENT,
      amount: 70_000,
      sourceAccountId: BANK,
      partnerId: SUPPLIER,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: -70_000, accountId: BANK },
      { kind: AccountingEffectKind.PAYABLE, amount: -70_000, partnerId: SUPPLIER },
    ]);
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.EXPENSE)).toBe(false);
  });

  it('internal transfer preserves total cash and creates no revenue or expense', () => {
    const tx = makeTransaction({
      type: TransactionType.TRANSFER,
      amount: 250_000,
      sourceAccountId: CASH,
      destinationAccountId: BANK,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: -250_000, accountId: CASH },
      { kind: AccountingEffectKind.CASH, amount: 250_000, accountId: BANK },
    ]);
    expect(effects.reduce((sum, effect) => sum + effect.amount, 0)).toBe(0);
  });

  it('capital contribution increases cash and equity but not revenue', () => {
    const tx = makeTransaction({
      type: TransactionType.CAPITAL_CONTRIBUTION,
      amount: 1_000_000,
      destinationAccountId: BANK,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 1_000_000, accountId: BANK },
      { kind: AccountingEffectKind.EQUITY, amount: 1_000_000 },
    ]);
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.REVENUE)).toBe(false);
  });

  it('customer refund is cash out and reduces revenue/VAT output', () => {
    const tx = makeTransaction({
      type: TransactionType.CUSTOMER_REFUND,
      amount: 110_000,
      amountBeforeVat: 100_000,
      vatAmount: 10_000,
      sourceAccountId: BANK,
    });

    expect(deriveAccountingEffects(tx)).toEqual([
      { kind: AccountingEffectKind.CASH, amount: -110_000, accountId: BANK },
      { kind: AccountingEffectKind.REVENUE, amount: -100_000 },
      { kind: AccountingEffectKind.VAT_OUTPUT, amount: -10_000 },
    ]);
  });

  it('supplier refund is cash in and does not become revenue', () => {
    const tx = makeTransaction({
      type: TransactionType.SUPPLIER_REFUND,
      amount: 108_000,
      amountBeforeVat: 100_000,
      vatAmount: 8_000,
      destinationAccountId: BANK,
    });

    const effects = deriveAccountingEffects(tx);
    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 108_000, accountId: BANK },
      { kind: AccountingEffectKind.EXPENSE, amount: -100_000 },
      { kind: AccountingEffectKind.VAT_INPUT, amount: -8_000 },
    ]);
    expect(effects.some((effect) => effect.kind === AccountingEffectKind.REVENUE)).toBe(false);
  });

  it('reversal produces the exact negative effects of the original transaction', () => {
    const original = makeTransaction({
      type: TransactionType.CASH_SALE,
      amount: 110_000,
      amountBeforeVat: 100_000,
      vatAmount: 10_000,
      destinationAccountId: CASH,
      status: 'REVERSED',
    });
    const reversal = makeTransaction({
      type: TransactionType.REVERSAL,
      amount: original.amount,
      reversalOfTransactionId: original.id,
    });

    const originalEffects = deriveAccountingEffects(original);
    const reversalEffects = deriveAccountingEffects(reversal, { originalTransaction: original });

    expect(reversalEffects).toEqual(
      originalEffects.map((effect) => ({ ...effect, amount: -effect.amount })),
    );
    const combined = deriveAccountingEffectsForTransactions([original, reversal]);
    expect(combined.reduce((sum, effect) => sum + effect.amount, 0)).toBe(0);
  });

  it('draft transaction has no accounting effects', () => {
    const tx = makeTransaction({
      type: TransactionType.CASH_SALE,
      amount: 100_000,
      destinationAccountId: CASH,
      status: 'DRAFT',
    });

    expect(deriveAccountingEffects(tx)).toEqual([]);
  });

  it('rejects same-account transfer', () => {
    const tx = makeTransaction({
      type: TransactionType.TRANSFER,
      amount: 50_000,
      sourceAccountId: CASH,
      destinationAccountId: CASH,
    });

    expect(() => deriveAccountingEffects(tx)).toThrow(
      'Transfer source and destination accounts must be different',
    );
  });

  it('rejects legacy ambiguous transaction types instead of guessing migration semantics', () => {
    const tx = makeTransaction({
      type: TransactionType.REFUND,
      amount: 50_000,
      destinationAccountId: CASH,
    });

    expect(() => deriveAccountingEffects(tx)).toThrow('requires explicit migration');
  });

  it('rejects non-integer VND amounts', () => {
    const tx = makeTransaction({
      type: TransactionType.CAPITAL_CONTRIBUTION,
      amount: 10_000.5,
      destinationAccountId: CASH,
    });

    expect(() => deriveAccountingEffects(tx)).toThrow('positive VND integer');
  });

  it('rejects inconsistent VAT decomposition', () => {
    const tx = makeTransaction({
      type: TransactionType.CASH_SALE,
      amount: 110_000,
      amountBeforeVat: 100_000,
      vatAmount: 8_000,
      destinationAccountId: CASH,
    });

    expect(() => deriveAccountingEffects(tx)).toThrow(
      'amount must equal amountBeforeVat + vatAmount',
    );
  });
});

describe('projectCashBalances', () => {
  it('derives account cash balances from transaction effects instead of cached account.balance', () => {
    const transactions = [
      makeTransaction({
        type: TransactionType.CAPITAL_CONTRIBUTION,
        amount: 1_000_000,
        destinationAccountId: CASH,
      }),
      makeTransaction({
        type: TransactionType.TRANSFER,
        amount: 400_000,
        sourceAccountId: CASH,
        destinationAccountId: BANK,
      }),
      makeTransaction({
        type: TransactionType.CASH_PURCHASE,
        amount: 100_000,
        sourceAccountId: BANK,
      }),
    ];

    const balances = projectCashBalances(transactions);
    expect(balances.get(CASH)).toBe(600_000);
    expect(balances.get(BANK)).toBe(300_000);
  });
});

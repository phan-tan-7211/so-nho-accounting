import { describe, expect, it } from 'vitest';
import { AccountingEffectKind, deriveAccountingEffects } from './accountingEffects';
import { TaxType, TransactionType } from './models';
import type { Transaction } from './models';

const CASH = '11111111-1111-4111-8111-111111111111';
const IDS = [
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
];

function tx(
  index: number,
  type: Transaction['type'],
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: IDS[index]!,
    date: 150,
    amount,
    type,
    status: 'POSTED',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('tax accounting effects', () => {
  it('posts tax payment as cash out plus a decrease in the selected tax obligation', () => {
    const effects = deriveAccountingEffects(
      tx(0, TransactionType.TAX_PAYMENT, 50, {
        taxType: TaxType.VAT,
        sourceAccountId: CASH,
      }),
    );

    expect(effects).toEqual([
      { kind: AccountingEffectKind.CASH, amount: -50, accountId: CASH },
      { kind: AccountingEffectKind.TAX, amount: -50, taxType: TaxType.VAT },
    ]);
  });

  it('posts VAT refund as cash in and consumes VAT credit while rejecting income-tax refunds in V1', () => {
    expect(
      deriveAccountingEffects(
        tx(0, TransactionType.TAX_REFUND, 20, {
          taxType: TaxType.VAT,
          destinationAccountId: CASH,
        }),
      ),
    ).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 20, accountId: CASH },
      { kind: AccountingEffectKind.TAX, amount: 20, taxType: TaxType.VAT },
    ]);

    expect(() =>
      deriveAccountingEffects(
        tx(1, TransactionType.TAX_REFUND, 20, {
          taxType: TaxType.INCOME_TAX,
          destinationAccountId: CASH,
        }),
      ),
    ).toThrow('TAX_REFUND currently supports VAT only in V1');
  });

  it('allows explicit zero TNDN assessment for the exact reporting period', () => {
    expect(
      deriveAccountingEffects(
        tx(0, TransactionType.TAX_ASSESSMENT, 0, {
          taxType: TaxType.INCOME_TAX,
          taxPeriodStart: 100,
          taxPeriodEnd: 199,
        }),
      ),
    ).toEqual([
      { kind: AccountingEffectKind.TAX, amount: 0, taxType: TaxType.INCOME_TAX },
    ]);
  });

  it('rejects tax assessment when its posting date is outside the declared assessment period', () => {
    expect(() =>
      deriveAccountingEffects(
        tx(0, TransactionType.TAX_ASSESSMENT, 10, {
          date: 250,
          taxType: TaxType.INCOME_TAX,
          taxPeriodStart: 100,
          taxPeriodEnd: 199,
        }),
      ),
    ).toThrow('TAX_ASSESSMENT date must fall inside its assessment period');
  });

  it('reverses tax payment as the exact negative effects without reclassifying it as a refund', () => {
    const original = tx(0, TransactionType.TAX_PAYMENT, 50, {
      taxType: TaxType.VAT,
      sourceAccountId: CASH,
      status: 'REVERSED',
    });
    const reversal = tx(1, TransactionType.REVERSAL, 50, {
      reversalOfTransactionId: original.id,
    });

    expect(deriveAccountingEffects(reversal, { originalTransaction: original })).toEqual([
      { kind: AccountingEffectKind.CASH, amount: 50, accountId: CASH },
      { kind: AccountingEffectKind.TAX, amount: 50, taxType: TaxType.VAT },
    ]);
  });
});

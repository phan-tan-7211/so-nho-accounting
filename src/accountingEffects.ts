import { TransactionType } from './models';
import type { Transaction } from './models';

export const AccountingEffectKind = {
  CASH: 'CASH',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
  VAT_INPUT: 'VAT_INPUT',
  VAT_OUTPUT: 'VAT_OUTPUT',
  RECEIVABLE: 'RECEIVABLE',
  PAYABLE: 'PAYABLE',
  EQUITY: 'EQUITY',
  TAX: 'TAX',
} as const;

export type AccountingEffectKind =
  typeof AccountingEffectKind[keyof typeof AccountingEffectKind];

export interface AccountingEffect {
  kind: AccountingEffectKind;
  amount: number;
  accountId?: string;
  partnerId?: string;
}

export interface DeriveAccountingEffectsContext {
  originalTransaction?: Transaction;
}

interface VatBreakdown {
  gross: number;
  net: number;
  vat: number;
}

const LEGACY_AMBIGUOUS_TYPES = new Set<Transaction['type']>([
  TransactionType.INCOME,
  TransactionType.EXPENSE,
  TransactionType.REFUND,
  TransactionType.ADJUSTMENT,
]);

function assertVndInteger(value: number, field: string, allowZero = false): void {
  const valid = Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw new Error(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} VND integer`);
  }
}

function requireAccountId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function requirePartnerId(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function resolveVatBreakdown(tx: Transaction): VatBreakdown {
  assertVndInteger(tx.amount, 'amount');

  const hasNet = tx.amountBeforeVat !== undefined;
  const hasVat = tx.vatAmount !== undefined;

  if (!hasNet && !hasVat) {
    return { gross: tx.amount, net: tx.amount, vat: 0 };
  }

  const vat = tx.vatAmount ?? 0;
  const net = tx.amountBeforeVat ?? tx.amount - vat;

  assertVndInteger(net, 'amountBeforeVat', true);
  assertVndInteger(vat, 'vatAmount', true);

  if (net + vat !== tx.amount) {
    throw new Error('amount must equal amountBeforeVat + vatAmount');
  }

  if (tx.vatRate !== undefined) {
    if (!Number.isFinite(tx.vatRate) || tx.vatRate < 0) {
      throw new Error('vatRate must be a non-negative number');
    }

    const expectedVat = calculateVatAmount(net, tx.vatRate);
    if (expectedVat !== vat) {
      throw new Error('vatAmount does not match amountBeforeVat and vatRate');
    }
  }

  return { gross: tx.amount, net, vat };
}

function appendVatEffect(
  effects: AccountingEffect[],
  kind: typeof AccountingEffectKind.VAT_INPUT | typeof AccountingEffectKind.VAT_OUTPUT,
  amount: number,
): void {
  if (amount !== 0) effects.push({ kind, amount });
}

function assertNoVatSettlementFields(tx: Transaction): void {
  if (
    tx.amountBeforeVat !== undefined ||
    tx.vatAmount !== undefined ||
    tx.vatRate !== undefined
  ) {
    throw new Error(`${tx.type} must not carry VAT fields`);
  }
}

export function calculateVatAmount(baseAmount: number, vatRatePercent: number): number {
  assertVndInteger(baseAmount, 'baseAmount', true);
  if (!Number.isFinite(vatRatePercent) || vatRatePercent < 0) {
    throw new Error('vatRatePercent must be a non-negative number');
  }

  return Math.round((baseAmount * vatRatePercent) / 100);
}

export function negateAccountingEffects(
  effects: readonly AccountingEffect[],
): AccountingEffect[] {
  return effects.map((effect) => ({ ...effect, amount: -effect.amount }));
}

export function deriveAccountingEffects(
  tx: Transaction,
  context: DeriveAccountingEffectsContext = {},
): AccountingEffect[] {
  if (tx.status === 'DRAFT') return [];

  if (LEGACY_AMBIGUOUS_TYPES.has(tx.type)) {
    throw new Error(
      `Legacy transaction type ${tx.type} requires explicit migration before accounting effects can be derived`,
    );
  }

  switch (tx.type) {
    case TransactionType.CASH_SALE: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const destinationAccountId = requireAccountId(
        tx.destinationAccountId,
        'destinationAccountId',
      );
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.CASH, amount: gross, accountId: destinationAccountId },
        { kind: AccountingEffectKind.REVENUE, amount: net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_OUTPUT, vat);
      return effects;
    }

    case TransactionType.CREDIT_SALE: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const partnerId = requirePartnerId(tx.partnerId, 'partnerId');
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.RECEIVABLE, amount: gross, partnerId },
        { kind: AccountingEffectKind.REVENUE, amount: net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_OUTPUT, vat);
      return effects;
    }

    case TransactionType.CUSTOMER_PAYMENT: {
      assertVndInteger(tx.amount, 'amount');
      assertNoVatSettlementFields(tx);
      const destinationAccountId = requireAccountId(
        tx.destinationAccountId,
        'destinationAccountId',
      );
      const partnerId = requirePartnerId(tx.partnerId, 'partnerId');
      return [
        { kind: AccountingEffectKind.CASH, amount: tx.amount, accountId: destinationAccountId },
        { kind: AccountingEffectKind.RECEIVABLE, amount: -tx.amount, partnerId },
      ];
    }

    case TransactionType.CASH_PURCHASE: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const sourceAccountId = requireAccountId(tx.sourceAccountId, 'sourceAccountId');
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.CASH, amount: -gross, accountId: sourceAccountId },
        { kind: AccountingEffectKind.EXPENSE, amount: net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_INPUT, vat);
      return effects;
    }

    case TransactionType.CREDIT_PURCHASE: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const partnerId = requirePartnerId(tx.partnerId, 'partnerId');
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.PAYABLE, amount: gross, partnerId },
        { kind: AccountingEffectKind.EXPENSE, amount: net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_INPUT, vat);
      return effects;
    }

    case TransactionType.SUPPLIER_PAYMENT: {
      assertVndInteger(tx.amount, 'amount');
      assertNoVatSettlementFields(tx);
      const sourceAccountId = requireAccountId(tx.sourceAccountId, 'sourceAccountId');
      const partnerId = requirePartnerId(tx.partnerId, 'partnerId');
      return [
        { kind: AccountingEffectKind.CASH, amount: -tx.amount, accountId: sourceAccountId },
        { kind: AccountingEffectKind.PAYABLE, amount: -tx.amount, partnerId },
      ];
    }

    case TransactionType.TRANSFER: {
      assertVndInteger(tx.amount, 'amount');
      assertNoVatSettlementFields(tx);
      const sourceAccountId = requireAccountId(tx.sourceAccountId, 'sourceAccountId');
      const destinationAccountId = requireAccountId(
        tx.destinationAccountId,
        'destinationAccountId',
      );
      if (sourceAccountId === destinationAccountId) {
        throw new Error('Transfer source and destination accounts must be different');
      }
      return [
        { kind: AccountingEffectKind.CASH, amount: -tx.amount, accountId: sourceAccountId },
        { kind: AccountingEffectKind.CASH, amount: tx.amount, accountId: destinationAccountId },
      ];
    }

    case TransactionType.CAPITAL_CONTRIBUTION: {
      assertVndInteger(tx.amount, 'amount');
      assertNoVatSettlementFields(tx);
      const destinationAccountId = requireAccountId(
        tx.destinationAccountId,
        'destinationAccountId',
      );
      return [
        { kind: AccountingEffectKind.CASH, amount: tx.amount, accountId: destinationAccountId },
        { kind: AccountingEffectKind.EQUITY, amount: tx.amount },
      ];
    }

    case TransactionType.CUSTOMER_REFUND: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const sourceAccountId = requireAccountId(tx.sourceAccountId, 'sourceAccountId');
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.CASH, amount: -gross, accountId: sourceAccountId },
        { kind: AccountingEffectKind.REVENUE, amount: -net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_OUTPUT, -vat);
      return effects;
    }

    case TransactionType.SUPPLIER_REFUND: {
      const { gross, net, vat } = resolveVatBreakdown(tx);
      const destinationAccountId = requireAccountId(
        tx.destinationAccountId,
        'destinationAccountId',
      );
      const effects: AccountingEffect[] = [
        { kind: AccountingEffectKind.CASH, amount: gross, accountId: destinationAccountId },
        { kind: AccountingEffectKind.EXPENSE, amount: -net },
      ];
      appendVatEffect(effects, AccountingEffectKind.VAT_INPUT, -vat);
      return effects;
    }

    case TransactionType.REVERSAL: {
      assertVndInteger(tx.amount, 'amount');
      assertNoVatSettlementFields(tx);
      if (!tx.reversalOfTransactionId) {
        throw new Error('reversalOfTransactionId is required');
      }

      const original = context.originalTransaction;
      if (!original || original.id !== tx.reversalOfTransactionId) {
        throw new Error('Original transaction must be supplied for REVERSAL');
      }
      if (original.status === 'DRAFT') {
        throw new Error('Cannot reverse a DRAFT transaction');
      }
      if (original.type === TransactionType.REVERSAL) {
        throw new Error('Reversal of a REVERSAL is not supported in V1');
      }
      if (tx.amount !== original.amount) {
        throw new Error('REVERSAL amount must match the original transaction amount');
      }

      return negateAccountingEffects(deriveAccountingEffects(original));
    }
  }

  throw new Error(`Unsupported transaction type: ${tx.type}`);
}

export function deriveAccountingEffectsForTransactions(
  transactions: readonly Transaction[],
): AccountingEffect[] {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));

  return transactions.flatMap((tx) =>
    deriveAccountingEffects(tx, {
      originalTransaction: tx.reversalOfTransactionId
        ? byId.get(tx.reversalOfTransactionId)
        : undefined,
    }),
  );
}

export function projectCashBalances(
  transactions: readonly Transaction[],
): ReadonlyMap<string, number> {
  const balances = new Map<string, number>();

  for (const effect of deriveAccountingEffectsForTransactions(transactions)) {
    if (effect.kind !== AccountingEffectKind.CASH || !effect.accountId) continue;
    balances.set(effect.accountId, (balances.get(effect.accountId) ?? 0) + effect.amount);
  }

  return balances;
}

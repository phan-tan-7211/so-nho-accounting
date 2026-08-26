import {
  AccountingEffectKind,
  deriveAccountingEffects,
} from './accountingEffects';
import type { AccountingEffect } from './accountingEffects';
import type { Transaction } from './models';

export interface ProjectionPeriod {
  start: number;
  end: number;
}

export interface ProjectionCoverage {
  status: 'COMPLETE' | 'PARTIAL';
  legacyTransactionIds: readonly string[];
  reason?: string;
}

export interface AccountingJournalEntry {
  transactionId: string;
  date: number;
  type: Transaction['type'];
  status: Transaction['status'];
  invoiceNumber?: string;
  description?: string;
  effects: readonly AccountingEffect[];
}

export interface PartnerAccountingPosition {
  partnerId: string;
  receivable: number;
  payable: number;
}

export interface AccountingProjectionTotals {
  revenue: number;
  expense: number;
  vatInput: number;
  vatOutput: number;
  equity: number;
  tax: number;
}

export interface AccountingDimensionProjection {
  period: ProjectionPeriod;
  activityCoverage: ProjectionCoverage;
  positionCoverage: ProjectionCoverage;
  entries: readonly AccountingJournalEntry[];
  totals: AccountingProjectionTotals;
  vatActivity: {
    input: number;
    output: number;
    netOutputLessInput: number;
  };
  partnerPositions: readonly PartnerAccountingPosition[];
  equityPosition: number;
}

export interface AccountingDimensionProjectionInput {
  transactions: readonly Transaction[];
  legacyTransactionIds: readonly string[];
  period: ProjectionPeriod;
}

function assertPeriod(period: ProjectionPeriod): void {
  if (!Number.isFinite(period.start) || !Number.isFinite(period.end)) {
    throw new Error('Projection period boundaries must be finite numbers');
  }
  if (period.start > period.end) {
    throw new Error('Projection period start must not be after end');
  }
}

function assertUniqueTransactionIds(transactions: readonly Transaction[]): void {
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (seen.has(tx.id)) throw new Error(`Duplicate transaction id ${tx.id}`);
    seen.add(tx.id);
  }
}

function addSafe(current: number, amount: number, label: string): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`${label} exceeds safe VND integer range`);
  }
  return next;
}

function addToMap(map: Map<string, number>, key: string, amount: number, label: string): void {
  map.set(key, addSafe(map.get(key) ?? 0, amount, label));
}

function coverage(
  legacyIds: readonly string[],
  reason: string,
): ProjectionCoverage {
  if (legacyIds.length === 0) return { status: 'COMPLETE', legacyTransactionIds: [] };
  return {
    status: 'PARTIAL',
    legacyTransactionIds: [...legacyIds].sort(),
    reason,
  };
}

/**
 * Builds deterministic semantic accounting entries after the legacy cutover.
 * Legacy rows are never reinterpreted as revenue/expense/VAT/debt/equity because
 * the old cached-balance engine did not preserve enough non-cash information to
 * reconstruct those dimensions safely.
 */
export function deriveSemanticAccountingEntries(
  transactions: readonly Transaction[],
  legacyTransactionIds: readonly string[],
): readonly AccountingJournalEntry[] {
  assertUniqueTransactionIds(transactions);

  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  const legacyIds = new Set<string>();
  for (const id of legacyTransactionIds) {
    if (legacyIds.has(id)) throw new Error(`Duplicate legacy transaction id ${id}`);
    if (!byId.has(id)) throw new Error(`Legacy transaction ${id} is missing after cutover`);
    legacyIds.add(id);
  }

  const semanticTransactions = transactions.filter((tx) => !legacyIds.has(tx.id));
  const semanticById = new Map(semanticTransactions.map((tx) => [tx.id, tx]));

  return semanticTransactions
    .map((tx): AccountingJournalEntry => ({
      transactionId: tx.id,
      date: tx.date,
      type: tx.type,
      status: tx.status,
      invoiceNumber: tx.invoiceNumber,
      description: tx.description,
      effects: deriveAccountingEffects(tx, {
        originalTransaction: tx.reversalOfTransactionId
          ? semanticById.get(tx.reversalOfTransactionId)
          : undefined,
      }),
    }))
    .filter((entry) => entry.effects.length > 0)
    .sort((a, b) => a.date - b.date || a.transactionId.localeCompare(b.transactionId));
}

export function projectAccountingDimensions(
  input: AccountingDimensionProjectionInput,
): AccountingDimensionProjection {
  const { transactions, legacyTransactionIds, period } = input;
  assertPeriod(period);

  const entries = deriveSemanticAccountingEntries(transactions, legacyTransactionIds);
  const legacySet = new Set(legacyTransactionIds);
  const legacyTransactions = transactions
    .filter((tx) => legacySet.has(tx.id))
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));

  const legacyInPeriod = legacyTransactions
    .filter((tx) => tx.date >= period.start && tx.date <= period.end)
    .map((tx) => tx.id);
  const legacyThroughPeriodEnd = legacyTransactions
    .filter((tx) => tx.date <= period.end)
    .map((tx) => tx.id);

  const periodEntries = entries.filter(
    (entry) => entry.date >= period.start && entry.date <= period.end,
  );
  const positionEntries = entries.filter((entry) => entry.date <= period.end);

  const totals: AccountingProjectionTotals = {
    revenue: 0,
    expense: 0,
    vatInput: 0,
    vatOutput: 0,
    equity: 0,
    tax: 0,
  };

  for (const entry of periodEntries) {
    for (const effect of entry.effects) {
      switch (effect.kind) {
        case AccountingEffectKind.REVENUE:
          totals.revenue = addSafe(totals.revenue, effect.amount, 'Revenue activity');
          break;
        case AccountingEffectKind.EXPENSE:
          totals.expense = addSafe(totals.expense, effect.amount, 'Expense activity');
          break;
        case AccountingEffectKind.VAT_INPUT:
          totals.vatInput = addSafe(totals.vatInput, effect.amount, 'VAT input activity');
          break;
        case AccountingEffectKind.VAT_OUTPUT:
          totals.vatOutput = addSafe(totals.vatOutput, effect.amount, 'VAT output activity');
          break;
        case AccountingEffectKind.EQUITY:
          totals.equity = addSafe(totals.equity, effect.amount, 'Equity activity');
          break;
        case AccountingEffectKind.TAX:
          totals.tax = addSafe(totals.tax, effect.amount, 'Tax activity');
          break;
      }
    }
  }

  const receivables = new Map<string, number>();
  const payables = new Map<string, number>();
  let equityPosition = 0;

  for (const entry of positionEntries) {
    for (const effect of entry.effects) {
      if (effect.kind === AccountingEffectKind.RECEIVABLE) {
        if (!effect.partnerId) throw new Error('Receivable effect is missing partnerId');
        addToMap(receivables, effect.partnerId, effect.amount, 'Receivable position');
      } else if (effect.kind === AccountingEffectKind.PAYABLE) {
        if (!effect.partnerId) throw new Error('Payable effect is missing partnerId');
        addToMap(payables, effect.partnerId, effect.amount, 'Payable position');
      } else if (effect.kind === AccountingEffectKind.EQUITY) {
        equityPosition = addSafe(equityPosition, effect.amount, 'Equity position');
      }
    }
  }

  const partnerIds = new Set([...receivables.keys(), ...payables.keys()]);
  const partnerPositions = [...partnerIds]
    .sort()
    .map((partnerId) => ({
      partnerId,
      receivable: receivables.get(partnerId) ?? 0,
      payable: payables.get(partnerId) ?? 0,
    }));

  const netOutputLessInput = addSafe(
    totals.vatOutput,
    -totals.vatInput,
    'Net VAT activity',
  );

  return {
    period: { ...period },
    activityCoverage: coverage(
      legacyInPeriod,
      'Legacy transactions inside the reporting period cannot be reconstructed safely for non-cash accounting dimensions',
    ),
    positionCoverage: coverage(
      legacyThroughPeriodEnd,
      'Legacy transactions at or before period end prevent a complete reconstructed non-cash closing position',
    ),
    entries: periodEntries,
    totals,
    vatActivity: {
      input: totals.vatInput,
      output: totals.vatOutput,
      netOutputLessInput,
    },
    partnerPositions,
    equityPosition,
  };
}

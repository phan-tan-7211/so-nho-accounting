import {
  AccountingEffectKind,
  deriveAccountingEffectsForTransactions,
} from './accountingEffects';
import {
  OpeningEffectKind,
  planLegacyOpeningBalanceMigration,
} from './legacyOpeningBalanceMigration';
import type { OpeningCashEffect } from './legacyOpeningBalanceMigration';
import type { Account, Transaction } from './models';

function assertUniqueIds<T extends { id: string }>(items: readonly T[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Duplicate ${label} id ${item.id}`);
    seen.add(item.id);
  }
}

function addBalance(
  balances: Map<string, number>,
  accountId: string,
  amount: number,
): void {
  const next = (balances.get(accountId) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`Derived cash balance exceeds safe VND integer range for account ${accountId}`);
  }
  balances.set(accountId, next);
}

export interface DerivedCashBalanceInput {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  openingEffects: readonly OpeningCashEffect[];
  legacyTransactionIds: readonly string[];
}

/**
 * Projects cash after the accounting cutover without reading cached account.balance
 * as a balance source.
 *
 * - openingEffects establish the semantic opening position;
 * - only transaction ids captured in the finalized migration state are replayed with
 *   the exact legacy cached-engine behavior;
 * - every other transaction is interpreted by the semantic accounting-effects core.
 */
export function projectDerivedCashBalances(
  input: DerivedCashBalanceInput,
): ReadonlyMap<string, number> {
  const { accounts, transactions, openingEffects, legacyTransactionIds } = input;
  assertUniqueIds(accounts, 'account');
  assertUniqueIds(transactions, 'transaction');

  const accountIds = new Set(accounts.map((account) => account.id));
  const transactionsById = new Map(transactions.map((tx) => [tx.id, tx]));
  const legacyIds = new Set<string>();

  for (const transactionId of legacyTransactionIds) {
    if (legacyIds.has(transactionId)) {
      throw new Error(`Duplicate legacy transaction id ${transactionId}`);
    }
    if (!transactionsById.has(transactionId)) {
      throw new Error(`Legacy transaction ${transactionId} is missing after cutover`);
    }
    legacyIds.add(transactionId);
  }

  const balances = new Map<string, number>();
  const openingAccounts = new Set<string>();

  for (const effect of openingEffects) {
    if (effect.kind !== OpeningEffectKind.OPENING_CASH) {
      throw new Error(`Unsupported opening effect kind ${effect.kind}`);
    }
    if (!accountIds.has(effect.accountId)) {
      throw new Error(`Opening effect references missing account ${effect.accountId}`);
    }
    if (openingAccounts.has(effect.accountId)) {
      throw new Error(`Duplicate opening cash effect for account ${effect.accountId}`);
    }
    if (!Number.isSafeInteger(effect.amount)) {
      throw new Error(`Opening cash amount must be a safe VND integer for account ${effect.accountId}`);
    }
    openingAccounts.add(effect.accountId);
    balances.set(effect.accountId, effect.amount);
  }

  // New accounts created after cutover legitimately have no opening effect and start at 0.
  for (const account of accounts) {
    if (!balances.has(account.id)) balances.set(account.id, 0);
  }

  const legacyTransactions = legacyTransactionIds.map((id) => transactionsById.get(id)!);
  const legacyPlan = planLegacyOpeningBalanceMigration(accounts, legacyTransactions);
  if (legacyPlan.status === 'BLOCKED') {
    const codes = legacyPlan.issues.map((issue) => issue.code).join(', ');
    throw new Error(`Legacy runtime replay integrity error: ${codes}`);
  }

  for (const delta of legacyPlan.legacyCashDeltas) {
    addBalance(balances, delta.accountId, delta.amount);
  }

  const semanticTransactions = transactions.filter((tx) => !legacyIds.has(tx.id));
  const semanticEffects = deriveAccountingEffectsForTransactions(semanticTransactions);

  for (const effect of semanticEffects) {
    if (effect.kind !== AccountingEffectKind.CASH || !effect.accountId) continue;
    if (!accountIds.has(effect.accountId)) {
      throw new Error(`Semantic cash effect references missing account ${effect.accountId}`);
    }
    addBalance(balances, effect.accountId, effect.amount);
  }

  return balances;
}

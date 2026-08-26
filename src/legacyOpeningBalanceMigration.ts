import {
  AccountSchema,
  TransactionSchema,
  TransactionType,
} from './models';
import type { Account, Transaction } from './models';

export const LEGACY_OPENING_BALANCE_MIGRATION_VERSION = 1 as const;

export const OpeningEffectKind = {
  OPENING_CASH: 'OPENING_CASH',
} as const;

export interface OpeningCashEffect {
  kind: typeof OpeningEffectKind.OPENING_CASH;
  accountId: string;
  amount: number;
}

export interface LegacyAccountCashDelta {
  accountId: string;
  amount: number;
}

export type LegacyMigrationIssueCode =
  | 'MALFORMED_ACCOUNT'
  | 'MALFORMED_TRANSACTION'
  | 'DUPLICATE_ACCOUNT_ID'
  | 'DUPLICATE_TRANSACTION_ID'
  | 'INVALID_STORED_BALANCE'
  | 'INVALID_LEGACY_AMOUNT'
  | 'NON_POSTED_LEGACY_TRANSACTION'
  | 'SEMANTIC_TRANSACTION_BEFORE_CUTOVER'
  | 'MISSING_SOURCE_ACCOUNT'
  | 'MISSING_DESTINATION_ACCOUNT'
  | 'MISSING_REFERENCED_ACCOUNT'
  | 'BALANCE_OVERFLOW';

export interface LegacyMigrationIssue {
  severity: 'BLOCKING';
  code: LegacyMigrationIssueCode;
  message: string;
  accountId?: string;
  transactionId?: string;
}

export interface LegacyOpeningBalanceMigrationPlan {
  version: typeof LEGACY_OPENING_BALANCE_MIGRATION_VERSION;
  status: 'READY' | 'BLOCKED';
  sourceSignature: string | null;
  openingEffects: readonly OpeningCashEffect[];
  legacyCashDeltas: readonly LegacyAccountCashDelta[];
  issues: readonly LegacyMigrationIssue[];
}

export interface LegacyOpeningBalanceMigrationState {
  version: typeof LEGACY_OPENING_BALANCE_MIGRATION_VERSION;
  sourceSignature: string;
  openingEffects: readonly OpeningCashEffect[];
}

const LEGACY_PRE_CUTOVER_TYPES = new Set<Transaction['type']>([
  TransactionType.INCOME,
  TransactionType.EXPENSE,
  TransactionType.TRANSFER,
  TransactionType.CAPITAL_CONTRIBUTION,
  TransactionType.REFUND,
  TransactionType.ADJUSTMENT,
]);

function blockingIssue(
  code: LegacyMigrationIssueCode,
  message: string,
  context: Pick<LegacyMigrationIssue, 'accountId' | 'transactionId'> = {},
): LegacyMigrationIssue {
  return { severity: 'BLOCKING', code, message, ...context };
}

function candidateId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = Reflect.get(value, 'id');
  return typeof id === 'string' ? id : undefined;
}

function addDelta(
  deltas: Map<string, number>,
  accountId: string,
  amount: number,
  issues: LegacyMigrationIssue[],
  transactionId: string,
): void {
  const next = (deltas.get(accountId) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) {
    issues.push(
      blockingIssue(
        'BALANCE_OVERFLOW',
        `Legacy cash delta exceeds the safe integer range for account ${accountId}`,
        { accountId, transactionId },
      ),
    );
    return;
  }
  deltas.set(accountId, next);
}

function requireReferencedAccount(
  accountId: string | undefined,
  field: 'sourceAccountId' | 'destinationAccountId',
  transactionId: string,
  knownAccountIds: ReadonlySet<string>,
  issues: LegacyMigrationIssue[],
): accountId is string {
  if (!accountId) {
    issues.push(
      blockingIssue(
        field === 'sourceAccountId' ? 'MISSING_SOURCE_ACCOUNT' : 'MISSING_DESTINATION_ACCOUNT',
        `${field} is required to reproduce the legacy engine delta`,
        { transactionId },
      ),
    );
    return false;
  }

  if (!knownAccountIds.has(accountId)) {
    issues.push(
      blockingIssue(
        'MISSING_REFERENCED_ACCOUNT',
        `Referenced account ${accountId} is missing from the current account snapshot`,
        { accountId, transactionId },
      ),
    );
    return false;
  }

  return true;
}

function reproduceLegacyTransactionCashDelta(
  tx: Transaction,
  knownAccountIds: ReadonlySet<string>,
  deltas: Map<string, number>,
  issues: LegacyMigrationIssue[],
): void {
  if (!LEGACY_PRE_CUTOVER_TYPES.has(tx.type)) {
    issues.push(
      blockingIssue(
        'SEMANTIC_TRANSACTION_BEFORE_CUTOVER',
        `Transaction ${tx.type} did not exist in the original cached-balance engine and cannot be assumed to have affected account.balance`,
        { transactionId: tx.id },
      ),
    );
    return;
  }

  // The original processTransaction() always persisted status POSTED. A DRAFT or
  // REVERSED legacy row therefore has unknown provenance (manual write or later
  // status mutation), so its cached-balance contribution cannot be reconstructed.
  if (tx.status !== 'POSTED') {
    issues.push(
      blockingIssue(
        'NON_POSTED_LEGACY_TRANSACTION',
        `Legacy transaction status ${tx.status} cannot be mapped deterministically to the old cached-balance mutation`,
        { transactionId: tx.id },
      ),
    );
    return;
  }

  if (!Number.isSafeInteger(tx.amount) || tx.amount < 0) {
    issues.push(
      blockingIssue(
        'INVALID_LEGACY_AMOUNT',
        'Legacy transaction amount must be a non-negative safe VND integer before migration',
        { transactionId: tx.id },
      ),
    );
    return;
  }

  switch (tx.type) {
    case TransactionType.INCOME: {
      if (
        requireReferencedAccount(
          tx.destinationAccountId,
          'destinationAccountId',
          tx.id,
          knownAccountIds,
          issues,
        )
      ) {
        addDelta(deltas, tx.destinationAccountId, tx.amount, issues, tx.id);
      }
      return;
    }

    case TransactionType.EXPENSE: {
      if (
        requireReferencedAccount(
          tx.sourceAccountId,
          'sourceAccountId',
          tx.id,
          knownAccountIds,
          issues,
        )
      ) {
        addDelta(deltas, tx.sourceAccountId, -tx.amount, issues, tx.id);
      }
      return;
    }

    case TransactionType.TRANSFER: {
      const hasSource = requireReferencedAccount(
        tx.sourceAccountId,
        'sourceAccountId',
        tx.id,
        knownAccountIds,
        issues,
      );
      const hasDestination = requireReferencedAccount(
        tx.destinationAccountId,
        'destinationAccountId',
        tx.id,
        knownAccountIds,
        issues,
      );

      if (
        hasSource &&
        hasDestination &&
        tx.sourceAccountId !== undefined &&
        tx.destinationAccountId !== undefined
      ) {
        // The legacy engine allowed same-account transfer and applied -X then +X.
        // Reproducing both operations preserves its exact net-zero behavior.
        addDelta(deltas, tx.sourceAccountId, -tx.amount, issues, tx.id);
        addDelta(deltas, tx.destinationAccountId, tx.amount, issues, tx.id);
      }
      return;
    }

    case TransactionType.CAPITAL_CONTRIBUTION: {
      if (
        requireReferencedAccount(
          tx.destinationAccountId,
          'destinationAccountId',
          tx.id,
          knownAccountIds,
          issues,
        )
      ) {
        addDelta(deltas, tx.destinationAccountId, tx.amount, issues, tx.id);
      }
      return;
    }

    case TransactionType.REFUND:
    case TransactionType.ADJUSTMENT:
      // The old engine persisted these rows but never mutated account.balance.
      return;
  }
}

function createSourceSignature(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): string {
  const accountPayload = [...accounts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((account) => ({ id: account.id, balance: account.balance }));

  const transactionPayload = [...transactions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: tx.status,
      amount: tx.amount,
      sourceAccountId: tx.sourceAccountId ?? null,
      destinationAccountId: tx.destinationAccountId ?? null,
    }));

  // Exact canonical payload is used instead of a lossy checksum so idempotency
  // never depends on hash collision behavior.
  return JSON.stringify({ accounts: accountPayload, transactions: transactionPayload });
}

function duplicateIds<T extends { id: string }>(items: readonly T[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

export function planLegacyOpeningBalanceMigration(
  rawAccounts: readonly unknown[],
  rawTransactions: readonly unknown[],
): LegacyOpeningBalanceMigrationPlan {
  const issues: LegacyMigrationIssue[] = [];
  const accounts: Account[] = [];
  const transactions: Transaction[] = [];

  for (const rawAccount of rawAccounts) {
    const parsed = AccountSchema.safeParse(rawAccount);
    if (!parsed.success) {
      issues.push(
        blockingIssue(
          'MALFORMED_ACCOUNT',
          'Malformed legacy account is preserved but blocks automatic opening-balance migration',
          { accountId: candidateId(rawAccount) },
        ),
      );
      continue;
    }
    accounts.push(parsed.data);
  }

  for (const rawTransaction of rawTransactions) {
    const parsed = TransactionSchema.safeParse(rawTransaction);
    if (!parsed.success) {
      issues.push(
        blockingIssue(
          'MALFORMED_TRANSACTION',
          'Malformed legacy transaction is preserved but blocks automatic opening-balance migration',
          { transactionId: candidateId(rawTransaction) },
        ),
      );
      continue;
    }
    transactions.push(parsed.data);
  }

  for (const id of duplicateIds(accounts)) {
    issues.push(
      blockingIssue('DUPLICATE_ACCOUNT_ID', `Duplicate account id ${id} blocks deterministic migration`, {
        accountId: id,
      }),
    );
  }

  for (const id of duplicateIds(transactions)) {
    issues.push(
      blockingIssue(
        'DUPLICATE_TRANSACTION_ID',
        `Duplicate transaction id ${id} blocks deterministic migration`,
        { transactionId: id },
      ),
    );
  }

  for (const account of accounts) {
    if (!Number.isSafeInteger(account.balance)) {
      issues.push(
        blockingIssue(
          'INVALID_STORED_BALANCE',
          'Legacy stored account.balance must be a safe VND integer before migration',
          { accountId: account.id },
        ),
      );
    }
  }

  const knownAccountIds = new Set(accounts.map((account) => account.id));
  const deltas = new Map<string, number>();

  for (const tx of transactions) {
    reproduceLegacyTransactionCashDelta(tx, knownAccountIds, deltas, issues);
  }

  if (issues.length > 0) {
    return {
      version: LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
      status: 'BLOCKED',
      sourceSignature: null,
      openingEffects: [],
      legacyCashDeltas: [],
      issues,
    };
  }

  const legacyCashDeltas = accounts
    .map((account) => ({
      accountId: account.id,
      amount: deltas.get(account.id) ?? 0,
    }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));

  const openingEffects: OpeningCashEffect[] = [];

  for (const account of accounts) {
    const legacyDelta = deltas.get(account.id) ?? 0;
    const openingAmount = account.balance - legacyDelta;
    if (!Number.isSafeInteger(openingAmount)) {
      issues.push(
        blockingIssue(
          'BALANCE_OVERFLOW',
          `Opening balance exceeds the safe integer range for account ${account.id}`,
          { accountId: account.id },
        ),
      );
      continue;
    }

    openingEffects.push({
      kind: OpeningEffectKind.OPENING_CASH,
      accountId: account.id,
      amount: openingAmount,
    });
  }

  if (issues.length > 0) {
    return {
      version: LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
      status: 'BLOCKED',
      sourceSignature: null,
      openingEffects: [],
      legacyCashDeltas: [],
      issues,
    };
  }

  openingEffects.sort((a, b) => a.accountId.localeCompare(b.accountId));

  return {
    version: LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
    status: 'READY',
    sourceSignature: createSourceSignature(accounts, transactions),
    openingEffects,
    legacyCashDeltas,
    issues: [],
  };
}

export function finalizeLegacyOpeningBalanceMigration(
  plan: LegacyOpeningBalanceMigrationPlan,
  existingState?: LegacyOpeningBalanceMigrationState,
): LegacyOpeningBalanceMigrationState {
  if (plan.status !== 'READY' || plan.sourceSignature === null) {
    throw new Error('Blocked legacy opening-balance migration cannot be finalized');
  }

  if (existingState) {
    if (
      existingState.version === plan.version &&
      existingState.sourceSignature === plan.sourceSignature
    ) {
      return existingState;
    }
    throw new Error('Legacy opening-balance migration was already finalized for a different source snapshot');
  }

  return {
    version: plan.version,
    sourceSignature: plan.sourceSignature,
    openingEffects: plan.openingEffects.map((effect) => ({ ...effect })),
  };
}

export function projectLegacyCashBalances(
  plan: LegacyOpeningBalanceMigrationPlan,
): ReadonlyMap<string, number> {
  if (plan.status !== 'READY') {
    throw new Error('Cannot project cash balances from a blocked migration plan');
  }

  const balances = new Map<string, number>();
  for (const effect of plan.openingEffects) {
    balances.set(effect.accountId, effect.amount);
  }
  for (const delta of plan.legacyCashDeltas) {
    balances.set(delta.accountId, (balances.get(delta.accountId) ?? 0) + delta.amount);
  }
  return balances;
}

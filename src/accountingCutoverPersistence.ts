import {
  finalizeLegacyOpeningBalanceMigration,
  LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
  planLegacyOpeningBalanceMigration,
} from './legacyOpeningBalanceMigration';
import type {
  LegacyMigrationIssue,
  LegacyOpeningBalanceMigrationState,
  OpeningCashEffect,
} from './legacyOpeningBalanceMigration';

export const LEGACY_OPENING_BALANCE_MIGRATION_ID = 'legacy-opening-balance-v1' as const;

export interface OpeningEffectRecord extends OpeningCashEffect {
  id: string;
  migrationId: typeof LEGACY_OPENING_BALANCE_MIGRATION_ID;
  migrationVersion: typeof LEGACY_OPENING_BALANCE_MIGRATION_VERSION;
}

export interface LegacyOpeningBalanceMigrationRecord extends LegacyOpeningBalanceMigrationState {
  id: typeof LEGACY_OPENING_BALANCE_MIGRATION_ID;
}

export interface AccountingCutoverTransaction {
  readAccounts(): Promise<readonly unknown[]>;
  readTransactions(): Promise<readonly unknown[]>;
  getMigrationState(
    id: typeof LEGACY_OPENING_BALANCE_MIGRATION_ID,
  ): Promise<LegacyOpeningBalanceMigrationRecord | undefined>;
  listOpeningEffects(
    migrationId: typeof LEGACY_OPENING_BALANCE_MIGRATION_ID,
  ): Promise<readonly OpeningEffectRecord[]>;
  putOpeningEffects(records: readonly OpeningEffectRecord[]): Promise<void>;
  putMigrationState(record: LegacyOpeningBalanceMigrationRecord): Promise<void>;
}

export interface AccountingCutoverStore {
  transaction<T>(operation: (tx: AccountingCutoverTransaction) => Promise<T>): Promise<T>;
}

export type AccountingCutoverResult =
  | {
      status: 'APPLIED';
      state: LegacyOpeningBalanceMigrationRecord;
      openingEffects: readonly OpeningEffectRecord[];
    }
  | {
      status: 'ALREADY_APPLIED';
      state: LegacyOpeningBalanceMigrationRecord;
      openingEffects: readonly OpeningEffectRecord[];
    }
  | {
      status: 'BLOCKED';
      issues: readonly LegacyMigrationIssue[];
    };

function openingEffectRecordId(accountId: string): string {
  return `${LEGACY_OPENING_BALANCE_MIGRATION_ID}:${accountId}`;
}

function toOpeningEffectRecords(
  effects: readonly OpeningCashEffect[],
): OpeningEffectRecord[] {
  return effects
    .map((effect) => ({
      id: openingEffectRecordId(effect.accountId),
      migrationId: LEGACY_OPENING_BALANCE_MIGRATION_ID,
      migrationVersion: LEGACY_OPENING_BALANCE_MIGRATION_VERSION,
      ...effect,
    }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
}

function toMigrationRecord(
  state: LegacyOpeningBalanceMigrationState,
): LegacyOpeningBalanceMigrationRecord {
  return {
    id: LEGACY_OPENING_BALANCE_MIGRATION_ID,
    version: state.version,
    sourceSignature: state.sourceSignature,
    openingEffects: state.openingEffects.map((effect) => ({ ...effect })),
  };
}

function assertPersistedCutoverIntegrity(
  state: LegacyOpeningBalanceMigrationRecord,
  persistedEffects: readonly OpeningEffectRecord[],
): OpeningEffectRecord[] {
  if (state.version !== LEGACY_OPENING_BALANCE_MIGRATION_VERSION) {
    throw new Error(`Unsupported accounting cutover migration version ${state.version}`);
  }

  const expected = toOpeningEffectRecords(state.openingEffects);
  const actual = [...persistedEffects].sort((a, b) => a.accountId.localeCompare(b.accountId));

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'Accounting cutover integrity error: persisted opening effects do not match migration state',
    );
  }

  return actual.map((record) => ({ ...record }));
}

/**
 * Persists the legacy opening-balance cutover as one atomic unit.
 *
 * The storage adapter is intentionally transaction-oriented so the eventual Dexie
 * implementation must commit opening effects and the migration marker together.
 * A finalized marker is authoritative: later semantic transactions are expected to
 * change the transaction snapshot, so an already-applied cutover is verified from
 * its persisted state/effects rather than being planned again.
 */
export async function runAccountingCutover(
  store: AccountingCutoverStore,
): Promise<AccountingCutoverResult> {
  return store.transaction(async (tx) => {
    const existingState = await tx.getMigrationState(LEGACY_OPENING_BALANCE_MIGRATION_ID);

    if (existingState) {
      const persistedEffects = await tx.listOpeningEffects(
        LEGACY_OPENING_BALANCE_MIGRATION_ID,
      );
      const verifiedEffects = assertPersistedCutoverIntegrity(existingState, persistedEffects);

      return {
        status: 'ALREADY_APPLIED',
        state: existingState,
        openingEffects: verifiedEffects,
      };
    }

    const [accounts, transactions] = await Promise.all([
      tx.readAccounts(),
      tx.readTransactions(),
    ]);
    const plan = planLegacyOpeningBalanceMigration(accounts, transactions);

    if (plan.status === 'BLOCKED') {
      return {
        status: 'BLOCKED',
        issues: plan.issues,
      };
    }

    const finalized = finalizeLegacyOpeningBalanceMigration(plan);
    const state = toMigrationRecord(finalized);
    const openingEffects = toOpeningEffectRecords(finalized.openingEffects);

    // These writes must live in the same adapter transaction. If either fails,
    // the adapter must roll back both so there is never a half-applied cutover.
    await tx.putOpeningEffects(openingEffects);
    await tx.putMigrationState(state);

    return {
      status: 'APPLIED',
      state,
      openingEffects,
    };
  });
}

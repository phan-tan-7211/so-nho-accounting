import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
  runAccountingCutover,
} from './accountingCutoverPersistence';
import { AccountingProfileSchema } from './accountingProfile';
import type { ProjectionPeriod } from './accountingProjections';
import {
  buildTt58ProjectionFromSnapshot,
} from './accountingProjectionService';
import { db, type AccountingDB } from './db';
import { DexieAccountingCutoverStore } from './dexieAccountingCutoverStore';
import type { TaxOpeningPosition } from './taxOpeningPosition';
import {
  buildTt58ReportBundle,
  canonicalReportJson,
  parseTt58ReportBundle,
} from './tt58ReportExport';
import type { Tt58ReportBundle } from './tt58ReportExport';

export type PeriodLockStatus = 'LOCKED' | 'UNLOCKED';
export type PeriodLockAction = 'LOCK' | 'UNLOCK';

export interface PeriodLockRecord {
  id: string;
  periodStart: number;
  periodEnd: number;
  status: PeriodLockStatus;
  revision: number;
  lockedAt: number;
  unlockedAt?: number;
  reportSnapshotJson: string;
}

export interface PeriodLockEvent {
  id: string;
  periodLockId: string;
  action: PeriodLockAction;
  revision: number;
  timestamp: number;
}

export interface LockPeriodResult {
  state: PeriodLockRecord;
  report: Tt58ReportBundle;
  alreadyLocked: boolean;
}

function assertPeriod(period: ProjectionPeriod): void {
  if (
    !Number.isSafeInteger(period.start) ||
    !Number.isSafeInteger(period.end) ||
    period.start < 0 ||
    period.end < period.start
  ) {
    throw new Error('Invalid period lock range');
  }
}

export function periodLockId(period: ProjectionPeriod): string {
  assertPeriod(period);
  return `tt58-period:${period.start}:${period.end}`;
}

export function lockCoversTimestamp(lock: PeriodLockRecord, timestamp: number): boolean {
  return lock.status === 'LOCKED' && timestamp >= lock.periodStart && timestamp <= lock.periodEnd;
}

export function findPeriodLockCoveringTimestamp(
  locks: readonly PeriodLockRecord[],
  timestamp: number,
): PeriodLockRecord | undefined {
  return locks.find((lock) => lockCoversTimestamp(lock, timestamp));
}

export class PeriodLockService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  async getPeriodLock(period: ProjectionPeriod): Promise<PeriodLockRecord | undefined> {
    return this.database.periodLocks.get(periodLockId(period));
  }

  async getLockedReport(period: ProjectionPeriod): Promise<Tt58ReportBundle | null> {
    const state = await this.getPeriodLock(period);
    if (!state || state.status !== 'LOCKED') return null;
    return parseTt58ReportBundle(state.reportSnapshotJson);
  }

  async isTimestampLocked(timestamp: number): Promise<PeriodLockRecord | undefined> {
    const locks = await this.database.periodLocks.where('status').equals('LOCKED').toArray();
    return findPeriodLockCoveringTimestamp(locks, timestamp);
  }

  async lockPeriod(period: ProjectionPeriod): Promise<LockPeriodResult> {
    assertPeriod(period);
    const id = periodLockId(period);
    const existing = await this.database.periodLocks.get(id);
    if (existing?.status === 'LOCKED') {
      return {
        state: existing,
        report: parseTt58ReportBundle(existing.reportSnapshotJson),
        alreadyLocked: true,
      };
    }

    const cutover = await runAccountingCutover(new DexieAccountingCutoverStore(this.database));
    if (cutover.status === 'BLOCKED') {
      throw new Error(`Accounting cutover is blocked: ${cutover.issues.map((issue) => issue.code).join(', ')}`);
    }

    return this.database.transaction(
      'rw',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.accountingProfiles,
        this.database.openingEffects,
        this.database.migrationStates,
        this.database.taxOpeningPositions,
        this.database.periodLocks,
        this.database.periodLockEvents,
      ],
      async () => {
        const current = await this.database.periodLocks.get(id);
        if (current?.status === 'LOCKED') {
          return {
            state: current,
            report: parseTt58ReportBundle(current.reportSnapshotJson),
            alreadyLocked: true,
          };
        }

        const migrationState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!migrationState || migrationState.sourceSignature !== cutover.state.sourceSignature) {
          throw new Error('Accounting cutover state changed during period lock');
        }

        const rawProfile = await this.database.accountingProfiles.get('primary');
        if (!rawProfile) throw new Error('TT58 accounting profile is not configured');
        const parsedProfile = AccountingProfileSchema.safeParse(rawProfile);
        if (!parsedProfile.success) throw new Error('Stored TT58 accounting profile is invalid');

        const [accounts, transactions, openingEffects, taxOpeningPositions] = await Promise.all([
          this.database.accounts.toArray(),
          this.database.transactions.toArray(),
          this.database.openingEffects
            .where('migrationId')
            .equals(LEGACY_OPENING_BALANCE_MIGRATION_ID)
            .toArray(),
          this.database.taxOpeningPositions.toArray(),
        ]);

        const projection = buildTt58ProjectionFromSnapshot({
          profile: parsedProfile.data,
          accounts,
          transactions,
          openingEffects,
          legacyTransactionIds: migrationState.legacyTransactionIds,
          taxOpeningPositions,
          period,
        });
        const report = buildTt58ReportBundle({
          profile: projection.profile,
          capabilities: projection.capabilities,
          materializedBooks: projection.materializedBooks,
          period,
        });
        const now = Date.now();
        const revision = (current?.revision ?? 0) + 1;
        const state: PeriodLockRecord = {
          id,
          periodStart: period.start,
          periodEnd: period.end,
          status: 'LOCKED',
          revision,
          lockedAt: now,
          reportSnapshotJson: canonicalReportJson(report),
        };
        await this.database.periodLocks.put(state);
        await this.database.periodLockEvents.add({
          id: crypto.randomUUID(),
          periodLockId: id,
          action: 'LOCK',
          revision,
          timestamp: now,
        });
        return { state, report, alreadyLocked: false };
      },
    );
  }

  async unlockPeriod(period: ProjectionPeriod): Promise<PeriodLockRecord> {
    assertPeriod(period);
    const id = periodLockId(period);
    return this.database.transaction(
      'rw',
      [this.database.periodLocks, this.database.periodLockEvents],
      async () => {
        const state = await this.database.periodLocks.get(id);
        if (!state) throw new Error('Period has never been locked');
        if (state.status !== 'LOCKED') return state;
        const now = Date.now();
        const unlocked: PeriodLockRecord = {
          ...state,
          status: 'UNLOCKED',
          unlockedAt: now,
        };
        await this.database.periodLocks.put(unlocked);
        await this.database.periodLockEvents.add({
          id: crypto.randomUUID(),
          periodLockId: id,
          action: 'UNLOCK',
          revision: state.revision,
          timestamp: now,
        });
        return unlocked;
      },
    );
  }

  async putTaxOpeningPositions(records: readonly TaxOpeningPosition[]): Promise<void> {
    await this.database.transaction(
      'rw',
      [this.database.taxOpeningPositions, this.database.periodLocks],
      async () => {
        const locked = await this.database.periodLocks.where('status').equals('LOCKED').toArray();
        for (const record of records) {
          const conflict = findPeriodLockCoveringTimestamp(locked, record.periodStart);
          if (conflict) {
            throw new Error(
              `Cannot change tax opening position because period ${conflict.periodStart}-${conflict.periodEnd} is locked`,
            );
          }
        }
        await this.database.taxOpeningPositions.bulkPut([...records]);
      },
    );
  }
}

export const periodLockService = new PeriodLockService(db);

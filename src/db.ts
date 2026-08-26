import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { Account, AuditLog, Transaction } from './models';
import type { AccountingProfile } from './accountingProfile';
import type {
  LegacyOpeningBalanceMigrationRecord,
  OpeningEffectRecord,
} from './accountingCutoverPersistence';
import type { TaxOpeningPosition } from './taxOpeningPosition';
import type { PeriodLockEvent, PeriodLockRecord } from './periodLock';

export class AccountingDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  auditLogs!: Table<AuditLog, string>;
  accountingProfiles!: Table<AccountingProfile, string>;
  openingEffects!: Table<OpeningEffectRecord, string>;
  migrationStates!: Table<LegacyOpeningBalanceMigrationRecord, string>;
  taxOpeningPositions!: Table<TaxOpeningPosition, string>;
  periodLocks!: Table<PeriodLockRecord, string>;
  periodLockEvents!: Table<PeriodLockEvent, string>;

  constructor(name = 'AccountingDB') {
    super(name);

    this.version(1).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
    });

    // Additive migration only: existing V1 tables and records are preserved.
    // No accounting regime is guessed for legacy databases; profile remains absent
    // until the user explicitly configures it.
    this.version(2).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
    });

    // V3 is schema-only and additive. It creates durable storage for the cutover
    // result but deliberately does not mutate legacy balances during Dexie's
    // on-upgrade callback. The explicit, validated cutover service performs those
    // writes atomically after the database opens.
    this.version(3).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
    });

    // V4 is also additive. Tax opening positions are explicit period-start facts;
    // they are never inferred from legacy balances or previous tax activity.
    this.version(4).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
    });

    // V5 adds audit-safe reporting boundaries. A lock stores an immutable report
    // snapshot for the revision while events preserve explicit LOCK/UNLOCK history.
    this.version(5).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
      periodLocks: 'id, status, periodStart, periodEnd, revision',
      periodLockEvents: 'id, periodLockId, action, revision, timestamp',
    });
  }
}

export const db = new AccountingDB();

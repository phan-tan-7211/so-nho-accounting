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
import type { InventoryItem, InventoryMovement, InventoryOpening } from './inventory';
import type { Partner } from './partners';
import type {
  FixedAsset,
  OtherTaxEntry,
  SupplementaryDebtEntry,
  SupplementaryEquityEntry,
} from './tt58Supplementary';

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
  inventoryItems!: Table<InventoryItem, string>;
  inventoryOpenings!: Table<InventoryOpening, string>;
  inventoryMovements!: Table<InventoryMovement, string>;
  partners!: Table<Partner, string>;
  supplementaryDebtEntries!: Table<SupplementaryDebtEntry, string>;
  fixedAssets!: Table<FixedAsset, string>;
  otherTaxEntries!: Table<OtherTaxEntry, string>;
  supplementaryEquityEntries!: Table<SupplementaryEquityEntry, string>;

  constructor(name = 'AccountingDB') {
    super(name);

    this.version(1).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
    });

    this.version(2).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
    });

    this.version(3).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
    });

    this.version(4).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
    });

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

    this.version(6).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
      periodLocks: 'id, status, periodStart, periodEnd, revision',
      periodLockEvents: 'id, periodLockId, action, revision, timestamp',
      inventoryItems: 'id, &code, name',
      inventoryOpenings: 'id, &itemId, effectiveDate',
      inventoryMovements: 'id, itemId, date, direction, transactionId, reversalOfMovementId, status',
    });

    this.version(7).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
      periodLocks: 'id, status, periodStart, periodEnd, revision',
      periodLockEvents: 'id, periodLockId, action, revision, timestamp',
      inventoryItems: 'id, &code, name',
      inventoryOpenings: 'id, &itemId, effectiveDate',
      inventoryMovements: 'id, itemId, date, direction, transactionId, reversalOfMovementId, status',
      partners: 'id, &code, name, kind, active',
    });

    // V8 adds explicit data sources for the optional TT58 Article 9 detailed books.
    // Existing V7 data remains untouched and the new stores start empty.
    this.version(8).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate',
      openingEffects: 'id, migrationId, migrationVersion, accountId, kind',
      migrationStates: 'id, version',
      taxOpeningPositions: 'id, taxType, periodStart',
      periodLocks: 'id, status, periodStart, periodEnd, revision',
      periodLockEvents: 'id, periodLockId, action, revision, timestamp',
      inventoryItems: 'id, &code, name',
      inventoryOpenings: 'id, &itemId, effectiveDate',
      inventoryMovements: 'id, itemId, date, direction, transactionId, reversalOfMovementId, status',
      partners: 'id, &code, name, kind, active',
      supplementaryDebtEntries: 'id, subjectCode, subjectKind, date, reversalOfEntryId',
      fixedAssets: 'id, &code, category, increaseDate, decreaseDate',
      otherTaxEntries: 'id, taxCode, date',
      supplementaryEquityEntries: 'id, accountCode, category, date, reversalOfEntryId',
    });
  }
}

export const db = new AccountingDB();

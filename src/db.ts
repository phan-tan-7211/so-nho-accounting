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

    // V7 is additive and replaces free-form partner UUID entry with a durable
    // customer/supplier master. Existing transactions remain untouched; their
    // partnerId values are validated at runtime/report diagnostics instead of
    // being silently rewritten during schema upgrade.
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
  }
}

export const db = new AccountingDB();

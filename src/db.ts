import Dexie, { Table } from 'dexie';
import { Account, Transaction, AuditLog } from './models';
import { AccountingProfile } from './accountingProfile';

export class AccountingDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  auditLogs!: Table<AuditLog, string>;
  accountingProfiles!: Table<AccountingProfile, string>;
  
  constructor() {
    super('AccountingDB');

    this.version(1).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp'
    });

    // Additive migration only: existing V1 tables and records are preserved.
    // No accounting regime is guessed for legacy databases; profile remains absent
    // until the user explicitly configures it.
    this.version(2).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp',
      accountingProfiles: 'id, regime, entityType, dataStartDate'
    });
  }
}

export const db = new AccountingDB();

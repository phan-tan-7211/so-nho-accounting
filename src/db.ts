import Dexie, { Table } from 'dexie';
import { Account, Transaction, AuditLog } from './models';

export class AccountingDB extends Dexie {
  accounts!: Table<Account, string>;
  transactions!: Table<Transaction, string>;
  auditLogs!: Table<AuditLog, string>;
  
  constructor() {
    super('AccountingDB');
    this.version(1).stores({
      accounts: 'id, name',
      transactions: 'id, date, type, sourceAccountId, destinationAccountId, status',
      auditLogs: 'id, transactionId, timestamp'
    });
  }
}

export const db = new AccountingDB();

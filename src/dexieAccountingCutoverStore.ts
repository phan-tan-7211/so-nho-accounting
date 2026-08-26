import type {
  AccountingCutoverStore,
  AccountingCutoverTransaction,
  LegacyOpeningBalanceMigrationRecord,
  OpeningEffectRecord,
} from './accountingCutoverPersistence';
import type { AccountingDB } from './db';

export class DexieAccountingCutoverStore implements AccountingCutoverStore {
  private readonly db: AccountingDB;

  constructor(db: AccountingDB) {
    this.db = db;
  }

  async transaction<T>(
    operation: (tx: AccountingCutoverTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      'rw',
      this.db.accounts,
      this.db.transactions,
      this.db.openingEffects,
      this.db.migrationStates,
      async () => {
        const tx: AccountingCutoverTransaction = {
          readAccounts: async () => this.db.accounts.toArray(),
          readTransactions: async () => this.db.transactions.toArray(),
          getMigrationState: async (id) => this.db.migrationStates.get(id),
          listOpeningEffects: async (migrationId) =>
            this.db.openingEffects.where('migrationId').equals(migrationId).toArray(),
          putOpeningEffects: async (records) => {
            if (records.length === 0) return;
            await this.db.openingEffects.bulkPut(
              records.map((record): OpeningEffectRecord => ({ ...record })),
            );
          },
          putMigrationState: async (record) => {
            await this.db.migrationStates.put({
              ...record,
              openingEffects: record.openingEffects.map((effect) => ({ ...effect })),
            } satisfies LegacyOpeningBalanceMigrationRecord);
          },
        };

        return operation(tx);
      },
    );
  }
}

import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
  runAccountingCutover,
} from './accountingCutoverPersistence';
import { AccountingProfileSchema } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import type { ProjectionPeriod } from './accountingProjections';
import { db, type AccountingDB } from './db';
import { DexieAccountingCutoverStore } from './dexieAccountingCutoverStore';
import {
  getTt58BookCapabilities,
  projectTt58CoreActivities,
} from './tt58BookProjections';
import { applyMaterializedBookReadiness } from './tt58CapabilityReadiness';
import { materializeTt58Books } from './tt58MaterializedBooks';
import { projectTt58TaxSettlements } from './taxSettlement';
import { finalizeTt58BooksWithTaxSettlement } from './tt58TaxSettledBooks';

export class AccountingProjectionService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  private async ensureCutover() {
    const result = await runAccountingCutover(
      new DexieAccountingCutoverStore(this.database),
    );
    if (result.status === 'BLOCKED') {
      throw new Error(
        `Accounting cutover is blocked: ${result.issues.map((issue) => issue.code).join(', ')}`,
      );
    }
    return result.state;
  }

  async project(period: ProjectionPeriod) {
    const state = await this.ensureCutover();

    return this.database.transaction(
      'r',
      this.database.transactions,
      this.database.migrationStates,
      async () => {
        const persistedState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!persistedState || persistedState.sourceSignature !== state.sourceSignature) {
          throw new Error('Accounting cutover state changed during accounting projection');
        }

        const transactions = await this.database.transactions.toArray();
        return projectAccountingDimensions({
          transactions,
          legacyTransactionIds: persistedState.legacyTransactionIds,
          period,
        });
      },
    );
  }

  async buildTt58Projection(period: ProjectionPeriod) {
    const state = await this.ensureCutover();

    return this.database.transaction(
      'r',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.accountingProfiles,
        this.database.openingEffects,
        this.database.migrationStates,
        this.database.taxOpeningPositions,
      ],
      async () => {
        const persistedState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!persistedState || persistedState.sourceSignature !== state.sourceSignature) {
          throw new Error('Accounting cutover state changed during TT58 projection');
        }

        const rawProfile = await this.database.accountingProfiles.get('primary');
        if (!rawProfile) throw new Error('TT58 accounting profile is not configured');
        const parsedProfile = AccountingProfileSchema.safeParse(rawProfile);
        if (!parsedProfile.success) throw new Error('Stored TT58 accounting profile is invalid');
        const profile = parsedProfile.data;

        const [accounts, transactions, openingEffects, taxOpeningPositions] = await Promise.all([
          this.database.accounts.toArray(),
          this.database.transactions.toArray(),
          this.database.openingEffects
            .where('migrationId')
            .equals(LEGACY_OPENING_BALANCE_MIGRATION_ID)
            .toArray(),
          this.database.taxOpeningPositions.toArray(),
        ]);

        const projection = projectAccountingDimensions({
          transactions,
          legacyTransactionIds: persistedState.legacyTransactionIds,
          period,
        });
        const baseBooks = materializeTt58Books({
          profile,
          projection,
          accounts,
          transactions,
          openingEffects,
          legacyTransactionIds: persistedState.legacyTransactionIds,
          period,
        });
        const taxSettlements = projectTt58TaxSettlements({
          profile,
          projection,
          transactions,
          taxOpeningPositions,
          materializedBooks: baseBooks,
          period,
        });
        const materializedBooks = finalizeTt58BooksWithTaxSettlement({
          profile,
          projection,
          transactions,
          books: baseBooks,
          settlements: taxSettlements,
        });
        const capabilities = applyMaterializedBookReadiness(
          getTt58BookCapabilities(profile),
          materializedBooks,
        );

        return {
          profile,
          capabilities,
          projection,
          activities: projectTt58CoreActivities(projection),
          taxSettlements,
          materializedBooks,
        };
      },
    );
  }
}

export const accountingProjectionService = new AccountingProjectionService(db);

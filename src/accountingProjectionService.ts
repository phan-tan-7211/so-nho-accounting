import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
  runAccountingCutover,
} from './accountingCutoverPersistence';
import { AccountingProfileSchema, getRequiredTt58Books } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import { projectAccountingDimensions } from './accountingProjections';
import type { ProjectionPeriod } from './accountingProjections';
import { db, type AccountingDB } from './db';
import { DexieAccountingCutoverStore } from './dexieAccountingCutoverStore';
import { projectInventoryS2c } from './inventory';
import type {
  InventoryItem,
  InventoryMovement,
  InventoryOpening,
  InventoryPriorValuationSnapshot,
} from './inventory';
import { findPriorInventoryValuation } from './inventoryValuationSnapshot';
import {
  getTt58BookCapabilities,
  projectTt58CoreActivities,
} from './tt58BookProjections';
import { applyMaterializedBookReadiness } from './tt58CapabilityReadiness';
import { materializeTt58Books } from './tt58MaterializedBooks';
import type { OpeningEffectRecord } from './accountingCutoverPersistence';
import type { Account, Transaction } from './models';
import type { Partner } from './partners';
import type { TaxOpeningPosition } from './taxOpeningPosition';
import { projectTt58TaxSettlements } from './taxSettlement';
import { finalizeTt58BooksWithTaxSettlement } from './tt58TaxSettledBooks';
import {
  projectTt58SupplementaryBooks,
} from './tt58Supplementary';
import type {
  FixedAsset,
  OtherTaxEntry,
  SupplementaryDebtEntry,
  SupplementaryEquityEntry,
} from './tt58Supplementary';

export interface Tt58ProjectionSnapshotInput {
  profile: AccountingProfile;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  openingEffects: readonly OpeningEffectRecord[];
  legacyTransactionIds: readonly string[];
  taxOpeningPositions: readonly TaxOpeningPosition[];
  inventoryItems: readonly InventoryItem[];
  inventoryOpenings: readonly InventoryOpening[];
  inventoryMovements: readonly InventoryMovement[];
  priorInventoryValuation?: InventoryPriorValuationSnapshot;
  partners?: readonly Partner[];
  supplementaryDebtEntries?: readonly SupplementaryDebtEntry[];
  fixedAssets?: readonly FixedAsset[];
  otherTaxEntries?: readonly OtherTaxEntry[];
  supplementaryEquityEntries?: readonly SupplementaryEquityEntry[];
  period: ProjectionPeriod;
}

export function buildTt58ProjectionFromSnapshot(input: Tt58ProjectionSnapshotInput) {
  const projection = projectAccountingDimensions({
    transactions: input.transactions,
    legacyTransactionIds: input.legacyTransactionIds,
    period: input.period,
  });
  const baseBooks = materializeTt58Books({
    profile: input.profile,
    projection,
    accounts: input.accounts,
    transactions: input.transactions,
    openingEffects: input.openingEffects,
    legacyTransactionIds: input.legacyTransactionIds,
    period: input.period,
  });
  const taxSettlements = projectTt58TaxSettlements({
    profile: input.profile,
    projection,
    transactions: input.transactions,
    taxOpeningPositions: input.taxOpeningPositions,
    materializedBooks: baseBooks,
    period: input.period,
  });
  const materializedBooks = finalizeTt58BooksWithTaxSettlement({
    profile: input.profile,
    projection,
    transactions: input.transactions,
    books: baseBooks,
    settlements: taxSettlements,
  });
  if (getRequiredTt58Books(input.profile).includes('S2c-DNSN')) {
    materializedBooks.s2c = projectInventoryS2c({
      items: input.inventoryItems,
      openings: input.inventoryOpenings,
      movements: input.inventoryMovements,
      priorValuation: input.priorInventoryValuation,
      period: input.period,
    });
  }

  const supplementary = projectTt58SupplementaryBooks({
    transactions: input.transactions,
    legacyTransactionIds: input.legacyTransactionIds,
    partners: input.partners ?? [],
    debtEntries: input.supplementaryDebtEntries ?? [],
    fixedAssets: input.fixedAssets ?? [],
    otherTaxEntries: input.otherTaxEntries ?? [],
    equityEntries: input.supplementaryEquityEntries ?? [],
    period: input.period,
  });
  materializedBooks.s4a = supplementary.s4a;
  materializedBooks.s4b = supplementary.s4b;
  materializedBooks.s4c = supplementary.s4c;
  materializedBooks.s4d = supplementary.s4d;

  const capabilities = applyMaterializedBookReadiness(
    getTt58BookCapabilities(input.profile),
    materializedBooks,
  );

  return {
    profile: input.profile,
    capabilities,
    projection,
    activities: projectTt58CoreActivities(projection),
    taxSettlements,
    supplementary,
    materializedBooks,
  };
}

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
        this.database.inventoryItems,
        this.database.inventoryOpenings,
        this.database.inventoryMovements,
        this.database.partners,
        this.database.supplementaryDebtEntries,
        this.database.fixedAssets,
        this.database.otherTaxEntries,
        this.database.supplementaryEquityEntries,
        this.database.periodLocks,
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

        const [
          accounts,
          transactions,
          openingEffects,
          taxOpeningPositions,
          inventoryItems,
          inventoryOpenings,
          inventoryMovements,
          partners,
          supplementaryDebtEntries,
          fixedAssets,
          otherTaxEntries,
          supplementaryEquityEntries,
          periodLocks,
        ] = await Promise.all([
          this.database.accounts.toArray(),
          this.database.transactions.toArray(),
          this.database.openingEffects
            .where('migrationId')
            .equals(LEGACY_OPENING_BALANCE_MIGRATION_ID)
            .toArray(),
          this.database.taxOpeningPositions.toArray(),
          this.database.inventoryItems.toArray(),
          this.database.inventoryOpenings.toArray(),
          this.database.inventoryMovements.toArray(),
          this.database.partners.toArray(),
          this.database.supplementaryDebtEntries.toArray(),
          this.database.fixedAssets.toArray(),
          this.database.otherTaxEntries.toArray(),
          this.database.supplementaryEquityEntries.toArray(),
          this.database.periodLocks.where('status').equals('LOCKED').toArray(),
        ]);

        return buildTt58ProjectionFromSnapshot({
          profile: parsedProfile.data,
          accounts,
          transactions,
          openingEffects,
          legacyTransactionIds: persistedState.legacyTransactionIds,
          taxOpeningPositions,
          inventoryItems,
          inventoryOpenings,
          inventoryMovements,
          priorInventoryValuation: findPriorInventoryValuation(periodLocks, period),
          partners,
          supplementaryDebtEntries,
          fixedAssets,
          otherTaxEntries,
          supplementaryEquityEntries,
          period,
        });
      },
    );
  }
}

export const accountingProjectionService = new AccountingProjectionService(db);

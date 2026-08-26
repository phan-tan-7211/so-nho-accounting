import {
  LEGACY_OPENING_BALANCE_MIGRATION_ID,
  runAccountingCutover,
} from './accountingCutoverPersistence';
import { AccountingEffectKind, deriveAccountingEffects } from './accountingEffects';
import { db, type AccountingDB } from './db';
import { DexieAccountingCutoverStore } from './dexieAccountingCutoverStore';
import { projectDerivedCashBalances } from './derivedCashBalances';
import { TransactionType } from './models';
import type { AuditLog, Transaction } from './models';
import { partnerSupportsTransaction } from './partners';
import { findPeriodLockCoveringTimestamp } from './periodLock';

export type NewPostedTransactionInput = Omit<
  Transaction,
  'id' | 'createdAt' | 'updatedAt' | 'reversalOfTransactionId'
>;

function migrationBlockedError(codes: readonly string[]): Error {
  return new Error(`Accounting cutover is blocked: ${codes.join(', ')}`);
}

export class AccountingEngineService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  private async ensureCutover() {
    const result = await runAccountingCutover(
      new DexieAccountingCutoverStore(this.database),
    );
    if (result.status === 'BLOCKED') {
      throw migrationBlockedError(result.issues.map((issue) => issue.code));
    }
    return result.state;
  }

  private async assertCashEffectAccountsExist(
    effects: ReturnType<typeof deriveAccountingEffects>,
  ): Promise<void> {
    const accountIds = [
      ...new Set(
        effects
          .filter(
            (effect) =>
              effect.kind === AccountingEffectKind.CASH && effect.accountId !== undefined,
          )
          .map((effect) => effect.accountId!),
      ),
    ];

    for (const accountId of accountIds) {
      if (!(await this.database.accounts.get(accountId))) {
        throw new Error(`Account ${accountId} not found`);
      }
    }
  }

  private async assertPartnerUsable(transaction: Transaction): Promise<void> {
    if (!transaction.partnerId) return;
    const partner = await this.database.partners.get(transaction.partnerId);
    if (!partner) throw new Error(`Partner ${transaction.partnerId} not found`);
    if (!partner.active) throw new Error(`Partner ${partner.code} is inactive`);
    if (!partnerSupportsTransaction(partner, transaction.type)) {
      throw new Error(`Partner ${partner.code} is incompatible with transaction ${transaction.type}`);
    }
  }

  private async assertTimestampUnlocked(timestamp: number, action: string): Promise<void> {
    const locks = await this.database.periodLocks.where('status').equals('LOCKED').toArray();
    const conflict = findPeriodLockCoveringTimestamp(locks, timestamp);
    if (conflict) {
      throw new Error(
        `${action} is blocked because period ${conflict.periodStart}-${conflict.periodEnd} is locked`,
      );
    }
  }

  async getBalances(): Promise<ReadonlyMap<string, number>> {
    const state = await this.ensureCutover();

    return this.database.transaction(
      'r',
      this.database.accounts,
      this.database.transactions,
      this.database.openingEffects,
      this.database.migrationStates,
      async () => {
        const persistedState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!persistedState || persistedState.sourceSignature !== state.sourceSignature) {
          throw new Error('Accounting cutover state changed during balance projection');
        }

        const [accounts, transactions, openingEffects] = await Promise.all([
          this.database.accounts.toArray(),
          this.database.transactions.toArray(),
          this.database.openingEffects
            .where('migrationId')
            .equals(LEGACY_OPENING_BALANCE_MIGRATION_ID)
            .toArray(),
        ]);

        return projectDerivedCashBalances({
          accounts,
          transactions,
          openingEffects,
          legacyTransactionIds: persistedState.legacyTransactionIds,
        });
      },
    );
  }

  async getBalance(accountId: string): Promise<number> {
    const account = await this.database.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    const balances = await this.getBalances();
    return balances.get(accountId) ?? 0;
  }

  async processTransaction(tx: NewPostedTransactionInput): Promise<Transaction> {
    await this.ensureCutover();

    if (tx.status !== 'POSTED') {
      throw new Error('processTransaction only accepts POSTED transactions');
    }
    if (tx.type === TransactionType.REVERSAL) {
      throw new Error('Use reverseTransaction() to create a REVERSAL');
    }

    const now = Date.now();
    const newTx: Transaction = {
      ...tx,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: 'POSTED',
    };
    const effects = deriveAccountingEffects(newTx);

    return this.database.transaction(
      'rw',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.auditLogs,
        this.database.migrationStates,
        this.database.periodLocks,
        this.database.partners,
      ],
      async () => {
        const migrationState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!migrationState) {
          throw new Error('Accounting cutover state is missing');
        }

        await this.assertTimestampUnlocked(newTx.date, 'Posting transaction');
        await this.assertCashEffectAccountsExist(effects);
        await this.assertPartnerUsable(newTx);
        await this.database.transactions.add(newTx);

        const log: AuditLog = {
          id: crypto.randomUUID(),
          transactionId: newTx.id,
          action: 'CREATE',
          timestamp: now,
          details: `Created semantic transaction ${newTx.type} of amount ${newTx.amount}`,
        };
        await this.database.auditLogs.add(log);

        return newTx;
      },
    );
  }

  async reverseTransaction(transactionId: string): Promise<Transaction> {
    const state = await this.ensureCutover();
    if (state.legacyTransactionIds.includes(transactionId)) {
      throw new Error('Migrated legacy transactions cannot use semantic REVERSAL');
    }

    return this.database.transaction(
      'rw',
      [
        this.database.accounts,
        this.database.transactions,
        this.database.auditLogs,
        this.database.migrationStates,
        this.database.periodLocks,
      ],
      async () => {
        const migrationState = await this.database.migrationStates.get(
          LEGACY_OPENING_BALANCE_MIGRATION_ID,
        );
        if (!migrationState) throw new Error('Accounting cutover state is missing');
        if (migrationState.legacyTransactionIds.includes(transactionId)) {
          throw new Error('Migrated legacy transactions cannot use semantic REVERSAL');
        }

        const original = await this.database.transactions.get(transactionId);
        if (!original) throw new Error(`Transaction ${transactionId} not found`);
        if (original.status !== 'POSTED') {
          throw new Error(`Only POSTED transactions can be reversed; found ${original.status}`);
        }
        if (original.type === TransactionType.REVERSAL) {
          throw new Error('Reversal of a REVERSAL is not supported in V1');
        }

        await this.assertTimestampUnlocked(original.date, 'Reversing transaction');

        const allTransactions = await this.database.transactions.toArray();
        const existingReversal = allTransactions.find(
          (candidate) =>
            candidate.type === TransactionType.REVERSAL &&
            candidate.reversalOfTransactionId === original.id &&
            candidate.status !== 'DRAFT',
        );
        if (existingReversal) {
          throw new Error(`Transaction ${transactionId} has already been reversed`);
        }

        const now = Date.now();
        await this.assertTimestampUnlocked(now, 'Creating reversal');
        const reversal: Transaction = {
          id: crypto.randomUUID(),
          date: now,
          amount: original.amount,
          type: TransactionType.REVERSAL,
          reversalOfTransactionId: original.id,
          description: `Reversal of ${original.id}`,
          status: 'POSTED',
          createdAt: now,
          updatedAt: now,
        };
        const reversalEffects = deriveAccountingEffects(reversal, {
          originalTransaction: original,
        });
        await this.assertCashEffectAccountsExist(reversalEffects);

        await this.database.transactions.add(reversal);
        await this.database.transactions.update(original.id, {
          status: 'REVERSED',
          updatedAt: now,
        });

        const log: AuditLog = {
          id: crypto.randomUUID(),
          transactionId: original.id,
          action: 'REVERSE',
          timestamp: now,
          details: `Reversed by transaction ${reversal.id}`,
        };
        await this.database.auditLogs.add(log);

        return reversal;
      },
    );
  }
}

const defaultEngine = new AccountingEngineService(db);

export class AccountingEngine {
  static async getBalance(accountId: string): Promise<number> {
    return defaultEngine.getBalance(accountId);
  }

  static async getBalances(): Promise<ReadonlyMap<string, number>> {
    return defaultEngine.getBalances();
  }

  static async processTransaction(tx: NewPostedTransactionInput): Promise<Transaction> {
    return defaultEngine.processTransaction(tx);
  }

  static async reverseTransaction(transactionId: string): Promise<Transaction> {
    return defaultEngine.reverseTransaction(transactionId);
  }
}

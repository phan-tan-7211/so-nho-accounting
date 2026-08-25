import { db } from './db';
import { Transaction, TransactionType, Account, AuditLog } from './models';

export class AccountingEngine {
  
  static async getBalance(accountId: string): Promise<number> {
    const account = await db.accounts.get(accountId);
    return account ? account.balance : 0;
  }

  static async processTransaction(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    return await db.transaction('rw', db.accounts, db.transactions, db.auditLogs, async () => {
      const id = crypto.randomUUID();
      const now = Date.now();
      
      const newTx: Transaction = {
        ...tx,
        id,
        createdAt: now,
        updatedAt: now,
        status: 'POSTED'
      };

      await db.transactions.add(newTx);
      
      // Update balances based on invariants
      if (newTx.type === TransactionType.INCOME) {
        if (!newTx.destinationAccountId) throw new Error("Income must have destination");
        await this.updateBalance(newTx.destinationAccountId, newTx.amount);
        if (newTx.vatAmount) {
            // we update balance by total amount including VAT, or amount is already total.
            // Requirement: VAT đầu ra không cộng vào doanh thu (revenue), but cash/bank increases by total (amount + VAT).
            // Actually, `amount` here could mean total. Let's assume `amount` is the total value impacting the account.
            // If `amount` is total, we just update destination by `amount`.
        }
      } else if (newTx.type === TransactionType.EXPENSE) {
        if (!newTx.sourceAccountId) throw new Error("Expense must have source");
        await this.updateBalance(newTx.sourceAccountId, -newTx.amount);
      } else if (newTx.type === TransactionType.TRANSFER) {
        if (!newTx.sourceAccountId || !newTx.destinationAccountId) throw new Error("Transfer must have source and destination");
        await this.updateBalance(newTx.sourceAccountId, -newTx.amount);
        await this.updateBalance(newTx.destinationAccountId, newTx.amount);
      } else if (newTx.type === TransactionType.CAPITAL_CONTRIBUTION) {
        if (!newTx.destinationAccountId) throw new Error("Capital must have destination");
        await this.updateBalance(newTx.destinationAccountId, newTx.amount);
      }

      const log: AuditLog = {
        id: crypto.randomUUID(),
        transactionId: id,
        action: 'CREATE',
        timestamp: now,
        details: `Created transaction ${newTx.type} of amount ${newTx.amount}`
      };
      await db.auditLogs.add(log);

      return newTx;
    });
  }

  private static async updateBalance(accountId: string, amount: number) {
    const account = await db.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);
    await db.accounts.update(accountId, { balance: account.balance + amount });
  }

}

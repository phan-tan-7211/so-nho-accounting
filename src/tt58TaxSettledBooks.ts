import { AccountingEffectKind } from './accountingEffects';
import type { AccountingProfile } from './accountingProfile';
import type {
  AccountingDimensionProjection,
  AccountingJournalEntry,
} from './accountingProjections';
import type { InventoryS2cBook } from './inventory';
import type { Transaction } from './models';
import type { TaxSettlementSummary, Tt58TaxSettlementBundle } from './taxSettlement';
import type {
  Tt58MaterializationIssue,
  Tt58MaterializationStatus,
  Tt58MaterializedBooks,
  Tt58RevenueTaxBook,
  Tt58S2bBook,
  Tt58S2bRow,
  Tt58S2dBook,
  Tt58S3bBook,
} from './tt58MaterializedBooks';

export interface Tt58SettledRevenueTaxBook extends Omit<Tt58RevenueTaxBook, 'status'> {
  status: Tt58MaterializationStatus;
  taxSettlement: TaxSettlementSummary;
}

export interface Tt58SettledS2bBook extends Omit<Tt58S2bBook, 'status'> {
  status: Tt58MaterializationStatus;
  taxSettlement: TaxSettlementSummary;
}

export interface Tt58SettledS3bBook extends Omit<Tt58S3bBook, 'status'> {
  status: Tt58MaterializationStatus;
  taxSettlement: TaxSettlementSummary;
}

export interface Tt58FinalMaterializedBooks {
  s1?: Tt58RevenueTaxBook;
  s2a?: Tt58SettledRevenueTaxBook;
  s2b?: Tt58SettledS2bBook;
  s2c?: InventoryS2cBook;
  s2d?: Tt58S2dBook;
  s3a?: Tt58SettledRevenueTaxBook;
  s3b?: Tt58SettledS3bBook;
}

export interface FinalizeTt58BooksInput {
  profile: AccountingProfile;
  projection: AccountingDimensionProjection;
  transactions: readonly Transaction[];
  books: Tt58MaterializedBooks;
  settlements: Tt58TaxSettlementBundle;
}

function addSafe(current: number, amount: number, label: string): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe VND integer range`);
  return next;
}

function sumEffect(entry: AccountingJournalEntry, kind: AccountingEffectKind): number {
  let total = 0;
  for (const effect of entry.effects) {
    if (effect.kind === kind) total = addSafe(total, effect.amount, `${kind} TT58 finalization`);
  }
  return total;
}

function transactionSource(
  transactionId: string,
  transactionsById: ReadonlyMap<string, Transaction>,
): Transaction {
  const tx = transactionsById.get(transactionId);
  if (!tx) throw new Error(`Transaction ${transactionId} is missing during TT58 finalization`);
  if (!tx.reversalOfTransactionId) return tx;
  return transactionsById.get(tx.reversalOfTransactionId) ?? tx;
}

function withoutPendingIssue(
  issues: readonly Tt58MaterializationIssue[],
  code: 'VAT_SETTLEMENT_DOMAIN_PENDING' | 'TAX_SETTLEMENT_DOMAIN_PENDING' | 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING',
): Tt58MaterializationIssue[] {
  return issues.filter((issue) => issue.code !== code).map((issue) => ({ ...issue }));
}

function appendSettlementIssues(
  issues: Tt58MaterializationIssue[],
  settlement: TaxSettlementSummary,
): void {
  const code = settlement.taxType === 'VAT'
    ? 'VAT_SETTLEMENT_DOMAIN_PENDING'
    : 'TAX_SETTLEMENT_DOMAIN_PENDING';
  for (const settlementIssue of settlement.issues) {
    if (issues.some((issue) => issue.message === settlementIssue.message)) continue;
    issues.push({
      code,
      message: settlementIssue.message,
      transactionId: settlementIssue.transactionId,
    });
  }
}

function settleRevenueTaxBook(
  book: Tt58RevenueTaxBook,
  settlement: TaxSettlementSummary,
  pendingCode: 'VAT_SETTLEMENT_DOMAIN_PENDING' | 'TAX_SETTLEMENT_DOMAIN_PENDING',
): Tt58SettledRevenueTaxBook {
  const issues = withoutPendingIssue(book.issues, pendingCode);
  appendSettlementIssues(issues, settlement);
  return {
    ...book,
    status: issues.length === 0 && settlement.status === 'COMPLETE' ? 'IMPLEMENTED' : 'PARTIAL',
    issues,
    taxSettlement: settlement,
  };
}

function finalizeS2b(input: FinalizeTt58BooksInput, settlement: TaxSettlementSummary): Tt58SettledS2bBook {
  const book = input.books.s2b;
  if (!book) throw new Error('S2b base materialization is missing');

  let issues = withoutPendingIssue(book.issues, 'TAX_SETTLEMENT_DOMAIN_PENDING');
  issues = withoutPendingIssue(issues, 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING');
  const byId = new Map(input.transactions.map((tx) => [tx.id, tx]));
  const entriesById = new Map(input.projection.entries.map((entry) => [entry.transactionId, entry]));
  const expenseTotals = { ...book.expenseTotals };
  let expenseTotal = book.expenseTotal;
  const rows: Tt58S2bRow[] = [];

  for (const row of book.rows) {
    if (row.section !== 'EXPENSE') {
      rows.push({ ...row });
      continue;
    }

    const entry = entriesById.get(row.transactionId);
    if (!entry) throw new Error(`S2b entry ${row.transactionId} is missing during finalization`);
    const source = transactionSource(row.transactionId, byId);
    const vatInput = sumEffect(entry, AccountingEffectKind.VAT_INPUT);
    let nonDeductibleVat = 0;

    if (vatInput !== 0) {
      if (input.profile.vatMethod === 'PERCENT_ON_REVENUE') {
        nonDeductibleVat = vatInput;
      } else if (source.vatDeductible === undefined) {
        if (!issues.some(
          (issue) =>
            issue.code === 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY' &&
            issue.transactionId === row.transactionId,
        )) {
          issues.push({
            code: 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY',
            message: 'S2b under VAT deduction requires explicit input-VAT deductibility before non-deductible VAT can be allocated to expense',
            transactionId: row.transactionId,
          });
        }
      } else if (!source.vatDeductible) {
        nonDeductibleVat = vatInput;
      }
    }

    const adjustedAmount = addSafe(row.amount, nonDeductibleVat, 'S2b adjusted expense row');
    if (nonDeductibleVat !== 0) {
      expenseTotal = addSafe(expenseTotal, nonDeductibleVat, 'S2b adjusted expense total');
      if (row.expenseCategory) {
        expenseTotals[row.expenseCategory] = addSafe(
          expenseTotals[row.expenseCategory] ?? 0,
          nonDeductibleVat,
          'S2b adjusted expense category',
        );
      }
    }

    rows.push({ ...row, amount: adjustedAmount });
  }

  appendSettlementIssues(issues, settlement);
  return {
    ...book,
    status: issues.length === 0 && settlement.status === 'COMPLETE' ? 'IMPLEMENTED' : 'PARTIAL',
    issues,
    rows,
    expenseTotals,
    expenseTotal,
    taxSettlement: settlement,
  };
}

function finalizeS3b(
  book: Tt58S3bBook,
  settlement: TaxSettlementSummary,
): Tt58SettledS3bBook {
  const issues = withoutPendingIssue(book.issues, 'VAT_SETTLEMENT_DOMAIN_PENDING');
  appendSettlementIssues(issues, settlement);
  return {
    ...book,
    status: issues.length === 0 && settlement.status === 'COMPLETE' ? 'IMPLEMENTED' : 'PARTIAL',
    issues,
    taxSettlement: settlement,
  };
}

export function finalizeTt58BooksWithTaxSettlement(
  input: FinalizeTt58BooksInput,
): Tt58FinalMaterializedBooks {
  const result: Tt58FinalMaterializedBooks = {
    s1: input.books.s1,
    s2d: input.books.s2d,
  };

  if (input.books.s2a) {
    if (!input.settlements.vat) throw new Error('VAT settlement is missing for S2a');
    result.s2a = settleRevenueTaxBook(
      input.books.s2a,
      input.settlements.vat,
      'VAT_SETTLEMENT_DOMAIN_PENDING',
    );
  }

  if (input.books.s3a) {
    if (!input.settlements.incomeTax) throw new Error('Income-tax settlement is missing for S3a');
    result.s3a = settleRevenueTaxBook(
      input.books.s3a,
      input.settlements.incomeTax,
      'TAX_SETTLEMENT_DOMAIN_PENDING',
    );
  }

  if (input.books.s2b) {
    if (!input.settlements.incomeTax) throw new Error('Income-tax settlement is missing for S2b');
    result.s2b = finalizeS2b(input, input.settlements.incomeTax);
  }

  if (input.books.s3b) {
    if (!input.settlements.vat) throw new Error('VAT settlement is missing for S3b');
    result.s3b = finalizeS3b(input.books.s3b, input.settlements.vat);
  }

  return result;
}

import { AccountingEffectKind } from './accountingEffects';
import type { AccountingProfile } from './accountingProfile';
import type {
  AccountingDimensionProjection,
  AccountingJournalEntry,
  ProjectionPeriod,
} from './accountingProjections';
import { projectDerivedCashBalances } from './derivedCashBalances';
import type { OpeningCashEffect } from './legacyOpeningBalanceMigration';
import { AccountKind, Tt58ExpenseCategory } from './models';
import type { Account, Transaction } from './models';

export type Tt58MaterializationStatus = 'IMPLEMENTED' | 'PARTIAL';

export interface Tt58MaterializationIssue {
  code:
    | 'LEGACY_ACTIVITY_UNAVAILABLE'
    | 'MISSING_DOCUMENT_NUMBER'
    | 'MISSING_TAX_ACTIVITY_LABEL'
    | 'MISSING_TAX_REVENUE_AMOUNT'
    | 'MISSING_VAT_REVENUE_RATE'
    | 'MISSING_INCOME_TAX_REVENUE_RATE'
    | 'MISSING_EXPENSE_CATEGORY'
    | 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY'
    | 'MISSING_ACCOUNT_KIND'
    | 'TAX_SETTLEMENT_DOMAIN_PENDING'
    | 'VAT_SETTLEMENT_DOMAIN_PENDING'
    | 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING';
  message: string;
  transactionId?: string;
  accountId?: string;
}

export interface Tt58RevenueTaxRow {
  transactionId: string;
  date: number;
  documentNumber?: string;
  description?: string;
  activityLabel: string;
  taxRevenueAmount: number;
  vatRevenueRate?: number;
  incomeTaxRevenueRate?: number;
}

export interface Tt58RevenueTaxGroup {
  activityLabel: string;
  vatRevenueRate?: number;
  incomeTaxRevenueRate?: number;
  rows: readonly Tt58RevenueTaxRow[];
  totalRevenue: number;
  vatTaxDue?: number;
  incomeTaxDue?: number;
}

export interface Tt58RevenueTaxBook {
  code: 'S1-DNSN' | 'S2a-DNSN' | 'S3a-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly Tt58MaterializationIssue[];
  groups: readonly Tt58RevenueTaxGroup[];
  totalRevenue: number;
  totalVatTaxDue?: number;
  totalIncomeTaxDue?: number;
}

export interface Tt58S2bRow {
  transactionId: string;
  date: number;
  documentNumber?: string;
  description?: string;
  section: 'REVENUE' | 'EXPENSE';
  expenseCategory?: Transaction['tt58ExpenseCategory'];
  amount: number;
}

export interface Tt58S2bBook {
  code: 'S2b-DNSN';
  status: 'PARTIAL';
  issues: readonly Tt58MaterializationIssue[];
  rows: readonly Tt58S2bRow[];
  revenueTotal: number;
  expenseTotals: Readonly<Record<Transaction['tt58ExpenseCategory'] & string, number>>;
  expenseTotal: number;
}

export interface Tt58S3bRow {
  transactionId: string;
  date: number;
  documentNumber?: string;
  description?: string;
  deductibleVatInput: number;
  vatOutput: number;
}

export interface Tt58S3bBook {
  code: 'S3b-DNSN';
  status: 'PARTIAL';
  issues: readonly Tt58MaterializationIssue[];
  rows: readonly Tt58S3bRow[];
  deductibleVatInputTotal: number;
  vatOutputTotal: number;
  periodVatOutputLessDeductibleInput: number;
}

export interface Tt58S2dMovementRow {
  transactionId: string;
  date: number;
  documentNumber?: string;
  description?: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
}

export interface Tt58S2dAccountSection {
  accountId: string;
  accountName: string;
  accountKind: Account['kind'];
  openingBalance: number;
  rows: readonly Tt58S2dMovementRow[];
  totalIn: number;
  totalOut: number;
  closingBalance: number;
}

export interface Tt58S2dBook {
  code: 'S2d-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly Tt58MaterializationIssue[];
  sections: readonly Tt58S2dAccountSection[];
}

export interface Tt58MaterializedBooks {
  s1?: Tt58RevenueTaxBook;
  s2a?: Tt58RevenueTaxBook;
  s2b?: Tt58S2bBook;
  s2d?: Tt58S2dBook;
  s3a?: Tt58RevenueTaxBook;
  s3b?: Tt58S3bBook;
}

export interface MaterializeTt58BooksInput {
  profile: AccountingProfile;
  projection: AccountingDimensionProjection;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  openingEffects: readonly OpeningCashEffect[];
  legacyTransactionIds: readonly string[];
  period: ProjectionPeriod;
}

function addSafe(current: number, amount: number, label: string): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe VND integer range`);
  return next;
}

function percentAmount(base: number, rate: number, label: string): number {
  if (!Number.isSafeInteger(base)) throw new Error(`${label} base must be a safe VND integer`);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error(`${label} rate must be between 0 and 100`);
  }
  const result = Math.round((base * rate) / 100);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe VND integer range`);
  return result;
}

function sumEffect(entry: AccountingJournalEntry, kind: AccountingEffectKind): number {
  let total = 0;
  for (const effect of entry.effects) {
    if (effect.kind === kind) total = addSafe(total, effect.amount, `${kind} entry`);
  }
  return total;
}

function transactionMetadataSource(
  entry: AccountingJournalEntry,
  transactionsById: ReadonlyMap<string, Transaction>,
): Transaction {
  const tx = transactionsById.get(entry.transactionId);
  if (!tx) throw new Error(`Transaction ${entry.transactionId} is missing during TT58 materialization`);
  if (!tx.reversalOfTransactionId) return tx;
  return transactionsById.get(tx.reversalOfTransactionId) ?? tx;
}

function documentNumber(entry: AccountingJournalEntry): string | undefined {
  return entry.documentNumber ?? entry.invoiceNumber;
}

function legacyIssue(projection: AccountingDimensionProjection): Tt58MaterializationIssue[] {
  if (projection.activityCoverage.status === 'COMPLETE') return [];
  return [{
    code: 'LEGACY_ACTIVITY_UNAVAILABLE',
    message: projection.activityCoverage.reason ?? 'Legacy activity cannot be reconstructed for this TT58 book',
  }];
}

function projectRevenueTaxBook(
  code: Tt58RevenueTaxBook['code'],
  projection: AccountingDimensionProjection,
  transactions: readonly Transaction[],
): Tt58RevenueTaxBook {
  const transactionsById = new Map(transactions.map((tx) => [tx.id, tx]));
  const issues: Tt58MaterializationIssue[] = legacyIssue(projection);
  const rows: Tt58RevenueTaxRow[] = [];
  const needsVatRate = code === 'S1-DNSN' || code === 'S2a-DNSN';
  const needsIncomeRate = code === 'S1-DNSN' || code === 'S3a-DNSN';

  for (const entry of projection.entries) {
    const accountingRevenue = sumEffect(entry, AccountingEffectKind.REVENUE);
    if (accountingRevenue === 0) continue;

    const source = transactionMetadataSource(entry, transactionsById);
    const doc = documentNumber(entry);
    if (!doc) {
      issues.push({
        code: 'MISSING_DOCUMENT_NUMBER',
        message: 'TT58 revenue-book row requires an invoice or accounting document number',
        transactionId: entry.transactionId,
      });
    }
    if (!source.taxActivityLabel) {
      issues.push({
        code: 'MISSING_TAX_ACTIVITY_LABEL',
        message: 'Revenue tax activity/group must be selected explicitly',
        transactionId: entry.transactionId,
      });
    }
    if (source.taxRevenueAmount === undefined || !Number.isSafeInteger(source.taxRevenueAmount)) {
      issues.push({
        code: 'MISSING_TAX_REVENUE_AMOUNT',
        message: 'Percentage-on-revenue books require an explicit safe-integer tax revenue base',
        transactionId: entry.transactionId,
      });
    }
    if (needsVatRate && source.vatRevenueRate === undefined) {
      issues.push({
        code: 'MISSING_VAT_REVENUE_RATE',
        message: 'VAT percentage-on-revenue rate must be selected explicitly',
        transactionId: entry.transactionId,
      });
    }
    if (needsIncomeRate && source.incomeTaxRevenueRate === undefined) {
      issues.push({
        code: 'MISSING_INCOME_TAX_REVENUE_RATE',
        message: 'Income-tax percentage-on-revenue rate must be selected explicitly',
        transactionId: entry.transactionId,
      });
    }

    if (
      !source.taxActivityLabel ||
      source.taxRevenueAmount === undefined ||
      !Number.isSafeInteger(source.taxRevenueAmount) ||
      (needsVatRate && source.vatRevenueRate === undefined) ||
      (needsIncomeRate && source.incomeTaxRevenueRate === undefined)
    ) continue;

    const sign = accountingRevenue < 0 ? -1 : 1;
    rows.push({
      transactionId: entry.transactionId,
      date: entry.date,
      documentNumber: doc,
      description: entry.description,
      activityLabel: source.taxActivityLabel,
      taxRevenueAmount: sign * source.taxRevenueAmount,
      vatRevenueRate: needsVatRate ? source.vatRevenueRate : undefined,
      incomeTaxRevenueRate: needsIncomeRate ? source.incomeTaxRevenueRate : undefined,
    });
  }

  const groupsByKey = new Map<string, Tt58RevenueTaxRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.activityLabel,
      row.vatRevenueRate ?? null,
      row.incomeTaxRevenueRate ?? null,
    ]);
    const groupRows = groupsByKey.get(key) ?? [];
    groupRows.push(row);
    groupsByKey.set(key, groupRows);
  }

  let totalRevenue = 0;
  let totalVatTaxDue = 0;
  let totalIncomeTaxDue = 0;
  const groups: Tt58RevenueTaxGroup[] = [...groupsByKey.values()]
    .map((groupRows) => {
      const first = groupRows[0]!;
      let groupRevenue = 0;
      for (const row of groupRows) {
        groupRevenue = addSafe(groupRevenue, row.taxRevenueAmount, `${code} group revenue`);
      }
      totalRevenue = addSafe(totalRevenue, groupRevenue, `${code} total revenue`);

      const vatTaxDue = first.vatRevenueRate === undefined
        ? undefined
        : percentAmount(groupRevenue, first.vatRevenueRate, `${code} VAT`);
      const incomeTaxDue = first.incomeTaxRevenueRate === undefined
        ? undefined
        : percentAmount(groupRevenue, first.incomeTaxRevenueRate, `${code} income tax`);
      if (vatTaxDue !== undefined) totalVatTaxDue = addSafe(totalVatTaxDue, vatTaxDue, `${code} VAT total`);
      if (incomeTaxDue !== undefined) {
        totalIncomeTaxDue = addSafe(totalIncomeTaxDue, incomeTaxDue, `${code} income-tax total`);
      }

      return {
        activityLabel: first.activityLabel,
        vatRevenueRate: first.vatRevenueRate,
        incomeTaxRevenueRate: first.incomeTaxRevenueRate,
        rows: [...groupRows].sort((a, b) => a.date - b.date || a.transactionId.localeCompare(b.transactionId)),
        totalRevenue: groupRevenue,
        vatTaxDue,
        incomeTaxDue,
      };
    })
    .sort((a, b) =>
      a.activityLabel.localeCompare(b.activityLabel) ||
      (a.vatRevenueRate ?? -1) - (b.vatRevenueRate ?? -1) ||
      (a.incomeTaxRevenueRate ?? -1) - (b.incomeTaxRevenueRate ?? -1));

  if (code === 'S2a-DNSN') {
    issues.push({
      code: 'VAT_SETTLEMENT_DOMAIN_PENDING',
      message: 'S2a still needs opening VAT payable, VAT payments and closing VAT payable',
    });
  } else if (code === 'S3a-DNSN') {
    issues.push({
      code: 'TAX_SETTLEMENT_DOMAIN_PENDING',
      message: 'S3a still needs opening income-tax payable, tax payments and closing income-tax payable',
    });
  }

  return {
    code,
    status: code === 'S1-DNSN' && issues.length === 0 ? 'IMPLEMENTED' : 'PARTIAL',
    issues,
    groups,
    totalRevenue,
    totalVatTaxDue: needsVatRate ? totalVatTaxDue : undefined,
    totalIncomeTaxDue: needsIncomeRate ? totalIncomeTaxDue : undefined,
  };
}

function emptyExpenseTotals(): Record<Transaction['tt58ExpenseCategory'] & string, number> {
  return {
    [Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY]: 0,
    [Tt58ExpenseCategory.LABOR]: 0,
    [Tt58ExpenseCategory.DEPRECIATION]: 0,
    [Tt58ExpenseCategory.OUTSIDE_SERVICES]: 0,
    [Tt58ExpenseCategory.INTEREST]: 0,
    [Tt58ExpenseCategory.OTHER_DIRECT_BUSINESS]: 0,
  };
}

function projectS2bBook(
  projection: AccountingDimensionProjection,
  transactions: readonly Transaction[],
): Tt58S2bBook {
  const transactionsById = new Map(transactions.map((tx) => [tx.id, tx]));
  const issues: Tt58MaterializationIssue[] = legacyIssue(projection);
  const rows: Tt58S2bRow[] = [];
  const expenseTotals = emptyExpenseTotals();
  let revenueTotal = 0;
  let expenseTotal = 0;

  for (const entry of projection.entries) {
    const revenue = sumEffect(entry, AccountingEffectKind.REVENUE);
    const expense = sumEffect(entry, AccountingEffectKind.EXPENSE);
    if (revenue === 0 && expense === 0) continue;
    const source = transactionMetadataSource(entry, transactionsById);
    const doc = documentNumber(entry);
    if (!doc) {
      issues.push({
        code: 'MISSING_DOCUMENT_NUMBER',
        message: 'S2b row requires an invoice or accounting document number',
        transactionId: entry.transactionId,
      });
    }

    if (revenue !== 0) {
      revenueTotal = addSafe(revenueTotal, revenue, 'S2b revenue total');
      rows.push({
        transactionId: entry.transactionId,
        date: entry.date,
        documentNumber: doc,
        description: entry.description,
        section: 'REVENUE',
        amount: revenue,
      });
    }

    if (expense !== 0) {
      if (!source.tt58ExpenseCategory) {
        issues.push({
          code: 'MISSING_EXPENSE_CATEGORY',
          message: 'S2b expense must be assigned to one of the six TT58 expense groups',
          transactionId: entry.transactionId,
        });
      } else {
        expenseTotals[source.tt58ExpenseCategory] = addSafe(
          expenseTotals[source.tt58ExpenseCategory],
          expense,
          'S2b expense category total',
        );
      }
      expenseTotal = addSafe(expenseTotal, expense, 'S2b expense total');
      rows.push({
        transactionId: entry.transactionId,
        date: entry.date,
        documentNumber: doc,
        description: entry.description,
        section: 'EXPENSE',
        expenseCategory: source.tt58ExpenseCategory,
        amount: expense,
      });
    }
  }

  issues.push({
    code: 'TAX_SETTLEMENT_DOMAIN_PENDING',
    message: 'S2b still needs opening/assessed/paid/closing TNDN obligation data',
  });
  issues.push({
    code: 'NON_DEDUCTIBLE_VAT_EXPENSE_PENDING',
    message: 'Profile-aware allocation of non-deductible input VAT into expense is not implemented yet',
  });

  return {
    code: 'S2b-DNSN',
    status: 'PARTIAL',
    issues,
    rows,
    revenueTotal,
    expenseTotals,
    expenseTotal,
  };
}

function projectS3bBook(
  projection: AccountingDimensionProjection,
  transactions: readonly Transaction[],
): Tt58S3bBook {
  const transactionsById = new Map(transactions.map((tx) => [tx.id, tx]));
  const issues: Tt58MaterializationIssue[] = legacyIssue(projection);
  const rows: Tt58S3bRow[] = [];
  let deductibleVatInputTotal = 0;
  let vatOutputTotal = 0;

  for (const entry of projection.entries) {
    const vatInput = sumEffect(entry, AccountingEffectKind.VAT_INPUT);
    const vatOutput = sumEffect(entry, AccountingEffectKind.VAT_OUTPUT);
    if (vatInput === 0 && vatOutput === 0) continue;
    const source = transactionMetadataSource(entry, transactionsById);
    const doc = documentNumber(entry);
    if (!doc) {
      issues.push({
        code: 'MISSING_DOCUMENT_NUMBER',
        message: 'S3b VAT row requires an invoice or accounting document number',
        transactionId: entry.transactionId,
      });
    }

    let deductibleVatInput = 0;
    if (vatInput !== 0) {
      if (source.vatDeductible === undefined) {
        issues.push({
          code: 'MISSING_VAT_DEDUCTIBLE_ELIGIBILITY',
          message: 'Input VAT deductibility must be confirmed explicitly for S3b',
          transactionId: entry.transactionId,
        });
      } else if (source.vatDeductible) {
        deductibleVatInput = vatInput;
      }
    }

    deductibleVatInputTotal = addSafe(
      deductibleVatInputTotal,
      deductibleVatInput,
      'S3b deductible VAT input total',
    );
    vatOutputTotal = addSafe(vatOutputTotal, vatOutput, 'S3b VAT output total');
    rows.push({
      transactionId: entry.transactionId,
      date: entry.date,
      documentNumber: doc,
      description: entry.description,
      deductibleVatInput,
      vatOutput,
    });
  }

  issues.push({
    code: 'VAT_SETTLEMENT_DOMAIN_PENDING',
    message: 'S3b still needs opening VAT credit/payable, VAT payments, VAT refunds and closing position',
  });

  return {
    code: 'S3b-DNSN',
    status: 'PARTIAL',
    issues,
    rows,
    deductibleVatInputTotal,
    vatOutputTotal,
    periodVatOutputLessDeductibleInput: addSafe(
      vatOutputTotal,
      -deductibleVatInputTotal,
      'S3b period VAT net',
    ),
  };
}

function projectS2dBook(input: MaterializeTt58BooksInput): Tt58S2dBook {
  const { accounts, transactions, openingEffects, legacyTransactionIds, period, projection } = input;
  const issues: Tt58MaterializationIssue[] = [];
  if (projection.activityCoverage.status === 'PARTIAL') {
    issues.push({
      code: 'LEGACY_ACTIVITY_UNAVAILABLE',
      message: 'S2d row-level materialization currently covers semantic transactions only inside the period',
    });
  }

  const beforeTransactions = transactions.filter((tx) => tx.date < period.start);
  const beforeIds = new Set(beforeTransactions.map((tx) => tx.id));
  const legacyBefore = legacyTransactionIds.filter((id) => beforeIds.has(id));
  const openingBalances = projectDerivedCashBalances({
    accounts,
    transactions: beforeTransactions,
    openingEffects,
    legacyTransactionIds: legacyBefore,
  });

  const movementsByAccount = new Map<string, AccountingJournalEntry[]>();
  for (const entry of projection.entries) {
    for (const effect of entry.effects) {
      if (effect.kind !== AccountingEffectKind.CASH || !effect.accountId || effect.amount === 0) continue;
      const list = movementsByAccount.get(effect.accountId) ?? [];
      if (!list.includes(entry)) list.push(entry);
      movementsByAccount.set(effect.accountId, list);
    }
  }

  const relevantAccountIds = new Set<string>();
  for (const account of accounts) {
    if ((openingBalances.get(account.id) ?? 0) !== 0) relevantAccountIds.add(account.id);
  }
  for (const accountId of movementsByAccount.keys()) relevantAccountIds.add(accountId);

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const sections: Tt58S2dAccountSection[] = [];

  for (const accountId of [...relevantAccountIds].sort()) {
    const account = accountById.get(accountId);
    if (!account) throw new Error(`S2d references missing account ${accountId}`);
    if (!account.kind) {
      issues.push({
        code: 'MISSING_ACCOUNT_KIND',
        message: 'S2d requires account kind CASH or DEMAND_DEPOSIT',
        accountId,
      });
      continue;
    }

    let balance = openingBalances.get(accountId) ?? 0;
    let totalIn = 0;
    let totalOut = 0;
    const rows: Tt58S2dMovementRow[] = [];
    const entries = (movementsByAccount.get(accountId) ?? [])
      .slice()
      .sort((a, b) => a.date - b.date || a.transactionId.localeCompare(b.transactionId));

    for (const entry of entries) {
      let movement = 0;
      for (const effect of entry.effects) {
        if (effect.kind === AccountingEffectKind.CASH && effect.accountId === accountId) {
          movement = addSafe(movement, effect.amount, 'S2d movement');
        }
      }
      if (movement === 0) continue;
      const doc = documentNumber(entry);
      if (!doc) {
        issues.push({
          code: 'MISSING_DOCUMENT_NUMBER',
          message: 'S2d money movement requires an accounting document number',
          transactionId: entry.transactionId,
          accountId,
        });
      }
      const moneyIn = movement > 0 ? movement : 0;
      const moneyOut = movement < 0 ? -movement : 0;
      totalIn = addSafe(totalIn, moneyIn, 'S2d total in');
      totalOut = addSafe(totalOut, moneyOut, 'S2d total out');
      balance = addSafe(balance, movement, 'S2d running balance');
      rows.push({
        transactionId: entry.transactionId,
        date: entry.date,
        documentNumber: doc,
        description: entry.description,
        moneyIn,
        moneyOut,
        balance,
      });
    }

    sections.push({
      accountId,
      accountName: account.name,
      accountKind: account.kind,
      openingBalance: openingBalances.get(accountId) ?? 0,
      rows,
      totalIn,
      totalOut,
      closingBalance: balance,
    });
  }

  return {
    code: 'S2d-DNSN',
    status: issues.length === 0 ? 'IMPLEMENTED' : 'PARTIAL',
    issues,
    sections,
  };
}

export function materializeTt58Books(input: MaterializeTt58BooksInput): Tt58MaterializedBooks {
  const { profile, projection, transactions } = input;
  if (!profile.taxProfileConfigured) return {};

  const books: Tt58MaterializedBooks = {};

  if (profile.vatMethod === 'PERCENT_ON_REVENUE' && profile.incomeTaxMethod === 'PERCENT_ON_REVENUE') {
    books.s1 = projectRevenueTaxBook('S1-DNSN', projection, transactions);
  }

  if (profile.vatMethod === 'PERCENT_ON_REVENUE' && profile.incomeTaxMethod === 'TAXABLE_INCOME') {
    books.s2a = projectRevenueTaxBook('S2a-DNSN', projection, transactions);
    books.s2b = projectS2bBook(projection, transactions);
    books.s2d = projectS2dBook(input);
  }

  if (profile.vatMethod === 'DEDUCTION' && profile.incomeTaxMethod === 'PERCENT_ON_REVENUE') {
    books.s3a = projectRevenueTaxBook('S3a-DNSN', projection, transactions);
    books.s3b = projectS3bBook(projection, transactions);
  }

  if (profile.vatMethod === 'DEDUCTION' && profile.incomeTaxMethod === 'TAXABLE_INCOME') {
    books.s2b = projectS2bBook(projection, transactions);
    books.s2d = projectS2dBook(input);
    books.s3b = projectS3bBook(projection, transactions);
  }

  return books;
}

export const TT58_S2B_EXPENSE_CATEGORY_ORDER: readonly Transaction['tt58ExpenseCategory'][] = [
  Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
  Tt58ExpenseCategory.LABOR,
  Tt58ExpenseCategory.DEPRECIATION,
  Tt58ExpenseCategory.OUTSIDE_SERVICES,
  Tt58ExpenseCategory.INTEREST,
  Tt58ExpenseCategory.OTHER_DIRECT_BUSINESS,
];

export const TT58_MONEY_ACCOUNT_KINDS = [
  AccountKind.CASH,
  AccountKind.DEMAND_DEPOSIT,
] as const;

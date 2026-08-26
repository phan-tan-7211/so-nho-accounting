import { z } from 'zod';
import { AccountingEffectKind } from './accountingEffects';
import { deriveSemanticAccountingEntries } from './accountingProjections';
import type { ProjectionPeriod } from './accountingProjections';
import type { AccountingDB } from './db';
import { db } from './db';
import { TransactionType } from './models';
import type { Transaction } from './models';
import type { Partner } from './partners';
import type { Tt58MaterializationStatus } from './tt58MaterializedBooks';

const SafeInt = z.number().int().refine(Number.isSafeInteger, 'VND amount exceeds safe integer range');
const NonNegativeSafeInt = SafeInt.refine((value) => value >= 0, 'Value must not be negative');
const Timestamp = z.number().int().nonnegative();

export const DebtSubjectKind = {
  LOAN: 'LOAN',
  ADVANCE: 'ADVANCE',
  EMPLOYEE: 'EMPLOYEE',
  DEPOSIT: 'DEPOSIT',
  OTHER_TAX: 'OTHER_TAX',
  OTHER: 'OTHER',
} as const;
export type DebtSubjectKind = typeof DebtSubjectKind[keyof typeof DebtSubjectKind];

export const SupplementaryDebtEntrySchema = z.object({
  id: z.string().uuid(),
  subjectCode: z.string().trim().min(1),
  subjectName: z.string().trim().min(1),
  subjectKind: z.nativeEnum(DebtSubjectKind),
  date: Timestamp,
  documentNumber: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  receivableIncreaseVnd: SafeInt.default(0),
  receivableCollectedVnd: SafeInt.default(0),
  payableIncreaseVnd: SafeInt.default(0),
  payablePaidVnd: SafeInt.default(0),
  reversalOfEntryId: z.string().uuid().optional(),
  createdAt: Timestamp,
}).refine((entry) =>
  entry.receivableIncreaseVnd !== 0 || entry.receivableCollectedVnd !== 0 ||
  entry.payableIncreaseVnd !== 0 || entry.payablePaidVnd !== 0,
{ message: 'At least one debt movement amount must be non-zero' });
export type SupplementaryDebtEntry = z.infer<typeof SupplementaryDebtEntrySchema>;

export const FixedAssetSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1),
  category: z.string().trim().min(1),
  name: z.string().trim().min(1),
  increaseDocumentNumber: z.string().trim().min(1),
  increaseDate: Timestamp,
  putIntoUseMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  originalCostVnd: NonNegativeSafeInt,
  annualDepreciationRatePct: z.number().finite().min(0).max(100),
  depreciationVndForYear: NonNegativeSafeInt,
  accumulatedDepreciationVnd: NonNegativeSafeInt,
  decreaseDocumentNumber: z.string().trim().min(1).optional(),
  decreaseDate: Timestamp.optional(),
  decreaseReason: z.string().trim().min(1).optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).superRefine((asset, context) => {
  const decreaseFields = [asset.decreaseDocumentNumber, asset.decreaseDate, asset.decreaseReason];
  const populated = decreaseFields.filter((value) => value !== undefined).length;
  if (populated !== 0 && populated !== 3) {
    context.addIssue({ code: 'custom', message: 'Asset decrease document, date and reason must be recorded together' });
  }
  if (asset.decreaseDate !== undefined && asset.decreaseDate < asset.increaseDate) {
    context.addIssue({ code: 'custom', message: 'Asset decrease date cannot precede increase date' });
  }
  if (asset.accumulatedDepreciationVnd > asset.originalCostVnd) {
    context.addIssue({ code: 'custom', message: 'Accumulated depreciation cannot exceed original cost' });
  }
});
export type FixedAsset = z.infer<typeof FixedAssetSchema>;

export const OtherTaxEntrySchema = z.object({
  id: z.string().uuid(),
  date: Timestamp,
  taxCode: z.string().trim().min(1),
  taxName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  taxableQuantityMilli: SafeInt.default(0),
  absoluteTaxRateVnd: SafeInt.default(0),
  taxableUnitPriceVnd: SafeInt.default(0),
  taxRatePct: z.number().finite().min(-100).max(100).default(0),
  proportionalTaxVnd: SafeInt.default(0),
  absoluteTaxVnd: SafeInt.default(0),
  exportImportExcisePayableVnd: SafeInt.default(0),
  environmentalProtectionTaxVnd: SafeInt.default(0),
  resourceTaxVnd: SafeInt.default(0),
  landUseTaxVnd: SafeInt.default(0),
  otherTaxVnd: SafeInt.default(0),
  createdAt: Timestamp,
});
export type OtherTaxEntry = z.infer<typeof OtherTaxEntrySchema>;

export const EquityCategory = {
  OWNER_CONTRIBUTION: 'OWNER_CONTRIBUTION',
  RETAINED_EARNINGS: 'RETAINED_EARNINGS',
  EQUITY_FUND: 'EQUITY_FUND',
  OTHER: 'OTHER',
} as const;
export type EquityCategory = typeof EquityCategory[keyof typeof EquityCategory];

export const SupplementaryEquityEntrySchema = z.object({
  id: z.string().uuid(),
  accountCode: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  category: z.nativeEnum(EquityCategory),
  date: Timestamp,
  documentNumber: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1),
  openingBalanceVnd: SafeInt.default(0),
  increaseVnd: SafeInt.default(0),
  decreaseVnd: SafeInt.default(0),
  reversalOfEntryId: z.string().uuid().optional(),
  createdAt: Timestamp,
}).refine((entry) => entry.openingBalanceVnd !== 0 || entry.increaseVnd !== 0 || entry.decreaseVnd !== 0,
  { message: 'At least one equity amount must be non-zero' });
export type SupplementaryEquityEntry = z.infer<typeof SupplementaryEquityEntrySchema>;

export interface SupplementaryIssue {
  code: string;
  message: string;
  recordId?: string;
  transactionId?: string;
}

export interface S4aRow {
  id: string;
  date: number;
  documentNumber?: string;
  description?: string;
  receivableIncreaseVnd: number;
  receivableCollectedVnd: number;
  receivableBalanceVnd: number;
  payableIncreaseVnd: number;
  payablePaidVnd: number;
  payableBalanceVnd: number;
}
export interface S4aSection {
  subjectCode: string;
  subjectName: string;
  subjectKind: string;
  openingReceivableVnd: number;
  openingPayableVnd: number;
  rows: readonly S4aRow[];
  totalReceivableIncreaseVnd: number;
  totalReceivableCollectedVnd: number;
  closingReceivableVnd: number;
  totalPayableIncreaseVnd: number;
  totalPayablePaidVnd: number;
  closingPayableVnd: number;
}
export interface Tt58S4aBook {
  code: 'S4a-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly SupplementaryIssue[];
  sections: readonly S4aSection[];
}

export interface Tt58S4bBook {
  code: 'S4b-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly SupplementaryIssue[];
  rows: readonly FixedAsset[];
}

export interface Tt58S4cBook {
  code: 'S4c-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly SupplementaryIssue[];
  rows: readonly OtherTaxEntry[];
}

export interface S4dRow {
  id: string;
  date: number;
  documentNumber?: string;
  description: string;
  increaseVnd: number;
  decreaseVnd: number;
  balanceVnd: number;
}
export interface S4dSection {
  accountCode: string;
  accountName: string;
  category: string;
  openingBalanceVnd: number;
  rows: readonly S4dRow[];
  totalIncreaseVnd: number;
  totalDecreaseVnd: number;
  closingBalanceVnd: number;
}
export interface Tt58S4dBook {
  code: 'S4d-DNSN';
  status: Tt58MaterializationStatus;
  issues: readonly SupplementaryIssue[];
  sections: readonly S4dSection[];
}

export interface Tt58SupplementaryBooks {
  s4a: Tt58S4aBook;
  s4b: Tt58S4bBook;
  s4c: Tt58S4cBook;
  s4d: Tt58S4dBook;
}

export interface ProjectSupplementaryInput {
  transactions: readonly Transaction[];
  legacyTransactionIds: readonly string[];
  partners: readonly Partner[];
  debtEntries: readonly SupplementaryDebtEntry[];
  fixedAssets: readonly FixedAsset[];
  otherTaxEntries: readonly OtherTaxEntry[];
  equityEntries: readonly SupplementaryEquityEntry[];
  period: ProjectionPeriod;
}

function addSafe(current: number, value: number, label: string): number {
  const next = current + value;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe VND integer range`);
  return next;
}

function sumEffect(entry: ReturnType<typeof deriveSemanticAccountingEntries>[number], kind: AccountingEffectKind): number {
  let total = 0;
  for (const effect of entry.effects) if (effect.kind === kind) total = addSafe(total, effect.amount, `${kind} amount`);
  return total;
}

interface DebtSourceRow extends Omit<S4aRow, 'receivableBalanceVnd' | 'payableBalanceVnd'> {
  subjectKey: string;
  subjectCode: string;
  subjectName: string;
  subjectKind: string;
}

function semanticDebtRows(input: ProjectSupplementaryInput, issues: SupplementaryIssue[]): DebtSourceRow[] {
  const partners = new Map(input.partners.map((partner) => [partner.id, partner]));
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]));
  const entries = deriveSemanticAccountingEntries(input.transactions, input.legacyTransactionIds);
  const rows: DebtSourceRow[] = [];

  for (const entry of entries) {
    if (entry.date > input.period.end) continue;
    const tx = transactions.get(entry.transactionId);
    if (!tx) continue;
    const source = tx.reversalOfTransactionId ? transactions.get(tx.reversalOfTransactionId) ?? tx : tx;
    if (![TransactionType.CREDIT_SALE, TransactionType.CUSTOMER_PAYMENT, TransactionType.CREDIT_PURCHASE, TransactionType.SUPPLIER_PAYMENT].includes(source.type)) continue;

    const receivableEffect = sumEffect(entry, AccountingEffectKind.RECEIVABLE);
    const payableEffect = sumEffect(entry, AccountingEffectKind.PAYABLE);
    const partnerId = entry.effects.find((effect) => effect.partnerId)?.partnerId ?? source.partnerId;
    if (!partnerId) {
      issues.push({ code: 'S4A_MISSING_PARTNER', message: 'Công nợ thương mại thiếu đối tượng khách hàng/nhà cung cấp.', transactionId: entry.transactionId });
      continue;
    }
    const partner = partners.get(partnerId);
    if (!partner) issues.push({ code: 'S4A_UNKNOWN_PARTNER', message: `Không tìm thấy đối tượng công nợ ${partnerId}.`, transactionId: entry.transactionId });

    rows.push({
      id: `tx:${entry.transactionId}`,
      subjectKey: `partner:${partnerId}`,
      subjectCode: partner?.code ?? partnerId,
      subjectName: partner?.name ?? partnerId,
      subjectKind: 'TRADE',
      date: entry.date,
      documentNumber: entry.documentNumber ?? entry.invoiceNumber,
      description: entry.description,
      receivableIncreaseVnd: source.type === TransactionType.CREDIT_SALE ? receivableEffect : 0,
      receivableCollectedVnd: source.type === TransactionType.CUSTOMER_PAYMENT ? -receivableEffect : 0,
      payableIncreaseVnd: source.type === TransactionType.CREDIT_PURCHASE ? payableEffect : 0,
      payablePaidVnd: source.type === TransactionType.SUPPLIER_PAYMENT ? -payableEffect : 0,
    });
  }
  return rows;
}

function projectS4a(input: ProjectSupplementaryInput): Tt58S4aBook {
  const issues: SupplementaryIssue[] = [];
  const rows: DebtSourceRow[] = semanticDebtRows(input, issues);
  for (const entry of input.debtEntries) {
    if (entry.date > input.period.end) continue;
    rows.push({
      id: entry.id,
      subjectKey: `manual:${entry.subjectKind}:${entry.subjectCode}`,
      subjectCode: entry.subjectCode,
      subjectName: entry.subjectName,
      subjectKind: entry.subjectKind,
      date: entry.date,
      documentNumber: entry.documentNumber,
      description: entry.description,
      receivableIncreaseVnd: entry.receivableIncreaseVnd,
      receivableCollectedVnd: entry.receivableCollectedVnd,
      payableIncreaseVnd: entry.payableIncreaseVnd,
      payablePaidVnd: entry.payablePaidVnd,
    });
  }

  if (input.legacyTransactionIds.length > 0) {
    issues.push({ code: 'S4A_LEGACY_POSITION_PARTIAL', message: 'Công nợ legacy trước cutover không đủ dữ liệu để tái dựng đầy đủ S4a.' });
  }

  const groups = new Map<string, DebtSourceRow[]>();
  for (const row of rows) {
    const group = groups.get(row.subjectKey) ?? [];
    group.push(row);
    groups.set(row.subjectKey, group);
  }

  const sections: S4aSection[] = [];
  for (const [key, sourceRows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    void key;
    sourceRows.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const first = sourceRows[0]!;
    let openingReceivable = 0;
    let openingPayable = 0;
    for (const row of sourceRows) {
      if (row.date >= input.period.start) continue;
      openingReceivable = addSafe(openingReceivable, row.receivableIncreaseVnd - row.receivableCollectedVnd, 'S4a opening receivable');
      openingPayable = addSafe(openingPayable, row.payableIncreaseVnd - row.payablePaidVnd, 'S4a opening payable');
    }
    let receivableBalance = openingReceivable;
    let payableBalance = openingPayable;
    let totalReceivableIncrease = 0;
    let totalReceivableCollected = 0;
    let totalPayableIncrease = 0;
    let totalPayablePaid = 0;
    const periodRows: S4aRow[] = [];
    for (const row of sourceRows) {
      if (row.date < input.period.start || row.date > input.period.end) continue;
      totalReceivableIncrease = addSafe(totalReceivableIncrease, row.receivableIncreaseVnd, 'S4a receivable increase');
      totalReceivableCollected = addSafe(totalReceivableCollected, row.receivableCollectedVnd, 'S4a receivable collected');
      totalPayableIncrease = addSafe(totalPayableIncrease, row.payableIncreaseVnd, 'S4a payable increase');
      totalPayablePaid = addSafe(totalPayablePaid, row.payablePaidVnd, 'S4a payable paid');
      receivableBalance = addSafe(receivableBalance, row.receivableIncreaseVnd - row.receivableCollectedVnd, 'S4a receivable balance');
      payableBalance = addSafe(payableBalance, row.payableIncreaseVnd - row.payablePaidVnd, 'S4a payable balance');
      periodRows.push({ ...row, receivableBalanceVnd: receivableBalance, payableBalanceVnd: payableBalance });
    }
    sections.push({
      subjectCode: first.subjectCode,
      subjectName: first.subjectName,
      subjectKind: first.subjectKind,
      openingReceivableVnd: openingReceivable,
      openingPayableVnd: openingPayable,
      rows: periodRows,
      totalReceivableIncreaseVnd: totalReceivableIncrease,
      totalReceivableCollectedVnd: totalReceivableCollected,
      closingReceivableVnd: receivableBalance,
      totalPayableIncreaseVnd: totalPayableIncrease,
      totalPayablePaidVnd: totalPayablePaid,
      closingPayableVnd: payableBalance,
    });
  }
  return { code: 'S4a-DNSN', status: issues.length ? 'PARTIAL' : 'IMPLEMENTED', issues, sections };
}

function projectS4b(input: ProjectSupplementaryInput): Tt58S4bBook {
  const rows = input.fixedAssets
    .filter((asset) => asset.increaseDate <= input.period.end)
    .filter((asset) => asset.decreaseDate === undefined || asset.decreaseDate >= input.period.start)
    .map((asset) => ({ ...asset }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
  return { code: 'S4b-DNSN', status: 'IMPLEMENTED', issues: [], rows };
}

function projectS4c(input: ProjectSupplementaryInput): Tt58S4cBook {
  const rows = input.otherTaxEntries
    .filter((entry) => entry.date >= input.period.start && entry.date <= input.period.end)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.taxCode.localeCompare(b.taxCode) || a.date - b.date || a.id.localeCompare(b.id));
  return { code: 'S4c-DNSN', status: 'IMPLEMENTED', issues: [], rows };
}

interface EquitySourceRow {
  id: string;
  key: string;
  accountCode: string;
  accountName: string;
  category: string;
  date: number;
  documentNumber?: string;
  description: string;
  openingBalanceVnd: number;
  increaseVnd: number;
  decreaseVnd: number;
}

function projectS4d(input: ProjectSupplementaryInput): Tt58S4dBook {
  const issues: SupplementaryIssue[] = [];
  const rows: EquitySourceRow[] = [];
  const transactions = new Map(input.transactions.map((transaction) => [transaction.id, transaction]));
  const entries = deriveSemanticAccountingEntries(input.transactions, input.legacyTransactionIds);
  for (const entry of entries) {
    if (entry.date > input.period.end) continue;
    const amount = sumEffect(entry, AccountingEffectKind.EQUITY);
    if (amount === 0) continue;
    const tx = transactions.get(entry.transactionId);
    const source = tx?.reversalOfTransactionId ? transactions.get(tx.reversalOfTransactionId) ?? tx : tx;
    if (!source || source.type !== TransactionType.CAPITAL_CONTRIBUTION) {
      issues.push({ code: 'S4D_UNCLASSIFIED_EQUITY', message: 'Có biến động vốn semantic chưa xác định loại vốn S4d.', transactionId: entry.transactionId });
      continue;
    }
    rows.push({
      id: `tx:${entry.transactionId}`,
      key: 'semantic:owner-contribution',
      accountCode: 'VON-GOP',
      accountName: 'Vốn góp chủ sở hữu',
      category: EquityCategory.OWNER_CONTRIBUTION,
      date: entry.date,
      documentNumber: entry.documentNumber,
      description: entry.description ?? 'Góp vốn chủ sở hữu',
      openingBalanceVnd: 0,
      increaseVnd: amount,
      decreaseVnd: 0,
    });
  }
  for (const entry of input.equityEntries) {
    if (entry.date > input.period.end) continue;
    rows.push({
      id: entry.id,
      key: `manual:${entry.category}:${entry.accountCode}`,
      accountCode: entry.accountCode,
      accountName: entry.accountName,
      category: entry.category,
      date: entry.date,
      documentNumber: entry.documentNumber,
      description: entry.description,
      openingBalanceVnd: entry.openingBalanceVnd,
      increaseVnd: entry.increaseVnd,
      decreaseVnd: entry.decreaseVnd,
    });
  }
  if (input.legacyTransactionIds.length > 0) {
    issues.push({ code: 'S4D_LEGACY_POSITION_PARTIAL', message: 'Vốn chủ sở hữu legacy trước cutover không đủ dữ liệu để tái dựng đầy đủ S4d.' });
  }

  const groups = new Map<string, EquitySourceRow[]>();
  for (const row of rows) {
    const group = groups.get(row.key) ?? [];
    group.push(row);
    groups.set(row.key, group);
  }
  const sections: S4dSection[] = [];
  for (const [, sourceRows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    sourceRows.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const first = sourceRows[0]!;
    let opening = 0;
    for (const row of sourceRows) {
      if (row.date < input.period.start) opening = addSafe(opening, row.openingBalanceVnd + row.increaseVnd - row.decreaseVnd, 'S4d opening');
      else if (row.date === input.period.start) opening = addSafe(opening, row.openingBalanceVnd, 'S4d explicit opening');
    }
    let balance = opening;
    let totalIncrease = 0;
    let totalDecrease = 0;
    const periodRows: S4dRow[] = [];
    for (const row of sourceRows) {
      if (row.date < input.period.start || row.date > input.period.end) continue;
      if (row.openingBalanceVnd !== 0) continue;
      totalIncrease = addSafe(totalIncrease, row.increaseVnd, 'S4d increase');
      totalDecrease = addSafe(totalDecrease, row.decreaseVnd, 'S4d decrease');
      balance = addSafe(balance, row.increaseVnd - row.decreaseVnd, 'S4d balance');
      periodRows.push({
        id: row.id, date: row.date, documentNumber: row.documentNumber, description: row.description,
        increaseVnd: row.increaseVnd, decreaseVnd: row.decreaseVnd, balanceVnd: balance,
      });
    }
    sections.push({
      accountCode: first.accountCode,
      accountName: first.accountName,
      category: first.category,
      openingBalanceVnd: opening,
      rows: periodRows,
      totalIncreaseVnd: totalIncrease,
      totalDecreaseVnd: totalDecrease,
      closingBalanceVnd: balance,
    });
  }
  return { code: 'S4d-DNSN', status: issues.length ? 'PARTIAL' : 'IMPLEMENTED', issues, sections };
}

export function projectTt58SupplementaryBooks(input: ProjectSupplementaryInput): Tt58SupplementaryBooks {
  return { s4a: projectS4a(input), s4b: projectS4b(input), s4c: projectS4c(input), s4d: projectS4d(input) };
}

async function assertUnlocked(database: AccountingDB, timestamp: number): Promise<void> {
  const locks = await database.periodLocks.where('status').equals('LOCKED').toArray();
  const conflict = locks.find((lock) => timestamp >= lock.periodStart && timestamp <= lock.periodEnd);
  if (conflict) throw new Error(`Không thể thay đổi sổ bổ sung vì kỳ ${conflict.periodStart}-${conflict.periodEnd} đang khóa.`);
}

export class Tt58SupplementaryService {
  constructor(private readonly database: AccountingDB) {}

  async addDebtEntry(input: Omit<SupplementaryDebtEntry, 'id' | 'createdAt'>): Promise<SupplementaryDebtEntry> {
    await assertUnlocked(this.database, input.date);
    const record = SupplementaryDebtEntrySchema.parse({ ...input, id: crypto.randomUUID(), createdAt: Date.now() });
    await this.database.supplementaryDebtEntries.add(record);
    return record;
  }

  async reverseDebtEntry(id: string, date: number, documentNumber?: string): Promise<SupplementaryDebtEntry> {
    await assertUnlocked(this.database, date);
    const original = await this.database.supplementaryDebtEntries.get(id);
    if (!original) throw new Error('Không tìm thấy dòng công nợ cần đảo.');
    if (original.reversalOfEntryId) throw new Error('Không thể đảo một dòng đã là bút toán đảo.');
    const record = SupplementaryDebtEntrySchema.parse({
      ...original, id: crypto.randomUUID(), date, documentNumber: documentNumber?.trim() || undefined,
      description: `Đảo: ${original.description ?? original.subjectName}`,
      receivableIncreaseVnd: -original.receivableIncreaseVnd,
      receivableCollectedVnd: -original.receivableCollectedVnd,
      payableIncreaseVnd: -original.payableIncreaseVnd,
      payablePaidVnd: -original.payablePaidVnd,
      reversalOfEntryId: original.id, createdAt: Date.now(),
    });
    await this.database.supplementaryDebtEntries.add(record);
    return record;
  }

  async addFixedAsset(input: Omit<FixedAsset, 'id' | 'createdAt' | 'updatedAt'>): Promise<FixedAsset> {
    await assertUnlocked(this.database, input.increaseDate);
    if (input.decreaseDate !== undefined) await assertUnlocked(this.database, input.decreaseDate);
    if (await this.database.fixedAssets.where('code').equals(input.code.trim()).first()) throw new Error(`Mã tài sản ${input.code} đã tồn tại.`);
    const now = Date.now();
    const record = FixedAssetSchema.parse({ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
    await this.database.fixedAssets.add(record);
    return record;
  }

  async recordFixedAssetDecrease(id: string, input: { decreaseDocumentNumber: string; decreaseDate: number; decreaseReason: string }): Promise<FixedAsset> {
    await assertUnlocked(this.database, input.decreaseDate);
    const asset = await this.database.fixedAssets.get(id);
    if (!asset) throw new Error('Không tìm thấy tài sản cố định.');
    if (asset.decreaseDate !== undefined) throw new Error('Tài sản đã có thông tin giảm.');
    const updated = FixedAssetSchema.parse({ ...asset, ...input, updatedAt: Date.now() });
    await this.database.fixedAssets.put(updated);
    return updated;
  }

  async addOtherTaxEntry(input: Omit<OtherTaxEntry, 'id' | 'createdAt'>): Promise<OtherTaxEntry> {
    await assertUnlocked(this.database, input.date);
    const record = OtherTaxEntrySchema.parse({ ...input, id: crypto.randomUUID(), createdAt: Date.now() });
    await this.database.otherTaxEntries.add(record);
    return record;
  }

  async addEquityEntry(input: Omit<SupplementaryEquityEntry, 'id' | 'createdAt'>): Promise<SupplementaryEquityEntry> {
    await assertUnlocked(this.database, input.date);
    const record = SupplementaryEquityEntrySchema.parse({ ...input, id: crypto.randomUUID(), createdAt: Date.now() });
    await this.database.supplementaryEquityEntries.add(record);
    return record;
  }

  async reverseEquityEntry(id: string, date: number, documentNumber?: string): Promise<SupplementaryEquityEntry> {
    await assertUnlocked(this.database, date);
    const original = await this.database.supplementaryEquityEntries.get(id);
    if (!original) throw new Error('Không tìm thấy dòng vốn cần đảo.');
    if (original.reversalOfEntryId) throw new Error('Không thể đảo một dòng đã là bút toán đảo.');
    const record = SupplementaryEquityEntrySchema.parse({
      ...original, id: crypto.randomUUID(), date, documentNumber: documentNumber?.trim() || undefined,
      description: `Đảo: ${original.description}`,
      openingBalanceVnd: -original.openingBalanceVnd,
      increaseVnd: -original.increaseVnd,
      decreaseVnd: -original.decreaseVnd,
      reversalOfEntryId: original.id, createdAt: Date.now(),
    });
    await this.database.supplementaryEquityEntries.add(record);
    return record;
  }
}

export const tt58SupplementaryService = new Tt58SupplementaryService(db);

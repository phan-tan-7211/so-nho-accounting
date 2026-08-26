import type { AccountingProfile } from './accountingProfile';
import type { ProjectionPeriod } from './accountingProjections';
import {
  TT58_INVENTORY_VALUATION_METHOD,
  formatInventoryQuantity,
  tt58PeriodAverageUnitCostVnd,
} from './inventory';
import type { Tt58RuntimeBookCapability } from './tt58CapabilityReadiness';
import type { Tt58FinalMaterializedBooks } from './tt58TaxSettledBooks';

export type ReportCell = string | number;

export interface Tt58ReportTable {
  code: string;
  title: string;
  columns: readonly string[];
  rows: readonly (readonly ReportCell[])[];
  status?: 'IMPLEMENTED' | 'PARTIAL';
  issues?: readonly string[];
}

export interface Tt58ReportInventoryValuation {
  method: typeof TT58_INVENTORY_VALUATION_METHOD;
  sections: readonly {
    itemId: string;
    itemCode: string;
    closingQuantityMilli: number;
    closingValueVnd: number;
  }[];
}

export interface Tt58ReportBundle {
  schemaVersion: 1;
  regime: AccountingProfile['regime'];
  entityType: AccountingProfile['entityType'];
  entityName?: string;
  entityAddress?: string;
  vatMethod: AccountingProfile['vatMethod'];
  incomeTaxMethod: AccountingProfile['incomeTaxMethod'];
  periodStart: number;
  periodEnd: number;
  inventoryValuation?: Tt58ReportInventoryValuation;
  tables: readonly Tt58ReportTable[];
}

export interface BuildTt58ReportInput {
  profile: AccountingProfile;
  capabilities: readonly Tt58RuntimeBookCapability[];
  materializedBooks: Tt58FinalMaterializedBooks;
  period: ProjectionPeriod;
}

function dateCell(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function settledRows(settlement: {
  openingNetPosition: number;
  periodNetTaxChange: number;
  paid: number;
  refunded: number;
  closingNetPosition: number;
}): readonly (readonly ReportCell[])[] {
  return [
    ['OPENING_TAX_POSITION', settlement.openingNetPosition],
    ['PERIOD_TAX_CHANGE', settlement.periodNetTaxChange],
    ['TAX_PAID', settlement.paid],
    ['TAX_REFUNDED', settlement.refunded],
    ['CLOSING_TAX_POSITION', settlement.closingNetPosition],
  ];
}

function revenueTable(
  code: 'S1-DNSN' | 'S2a-DNSN' | 'S3a-DNSN',
  title: string,
  book: NonNullable<Tt58FinalMaterializedBooks['s1' | 's2a' | 's3a']>,
): Tt58ReportTable {
  const rows: ReportCell[][] = [];
  for (const group of book.groups) {
    for (const row of group.rows) {
      rows.push([
        'ENTRY', dateCell(row.date), row.documentNumber ?? '', row.description ?? '',
        row.activityLabel, row.taxRevenueAmount, row.vatRevenueRate ?? '', row.incomeTaxRevenueRate ?? '',
      ]);
    }
    rows.push([
      'GROUP_TOTAL', '', '', '', group.activityLabel, group.totalRevenue,
      group.vatTaxDue ?? '', group.incomeTaxDue ?? '',
    ]);
  }
  rows.push(['TOTAL', '', '', '', '', book.totalRevenue, book.totalVatTaxDue ?? '', book.totalIncomeTaxDue ?? '']);
  if ('taxSettlement' in book && book.taxSettlement) {
    for (const summary of settledRows(book.taxSettlement)) rows.push([summary[0]!, '', '', '', '', summary[1]!, '', '']);
  }
  return {
    code,
    title,
    columns: ['rowType', 'date', 'documentNumber', 'description', 'activityLabel', 'taxRevenueAmount', 'vatTaxDueOrRate', 'incomeTaxDueOrRate'],
    rows,
  };
}

function s2bTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s2b']>): Tt58ReportTable {
  const rows: ReportCell[][] = book.rows.map((row) => [
    'ENTRY', dateCell(row.date), row.documentNumber ?? '', row.description ?? '', row.section, row.expenseCategory ?? '', row.amount,
  ]);
  rows.push(['TOTAL_REVENUE', '', '', '', 'REVENUE', '', book.revenueTotal]);
  rows.push(['TOTAL_EXPENSE', '', '', '', 'EXPENSE', '', book.expenseTotal]);
  for (const summary of settledRows(book.taxSettlement)) rows.push([summary[0]!, '', '', '', 'INCOME_TAX', '', summary[1]!]);
  return {
    code: 'S2b-DNSN',
    title,
    columns: ['rowType', 'date', 'documentNumber', 'description', 'section', 'expenseCategory', 'amount'],
    rows,
  };
}

function s2cTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s2c']>): Tt58ReportTable {
  const rows: ReportCell[][] = [];
  for (const section of book.sections) {
    const openingUnitCost = tt58PeriodAverageUnitCostVnd(section.openingQuantityMilli, section.openingValueVnd, 0, 0);
    rows.push([
      'OPENING', section.itemCode, section.itemName, section.unit, '', '', '',
      formatInventoryQuantity(section.openingQuantityMilli), '', section.openingValueVnd,
      formatInventoryQuantity(section.openingQuantityMilli), section.openingValueVnd,
      openingUnitCost, '', '',
    ]);
    for (const row of section.rows) {
      rows.push([
        'ENTRY', section.itemCode, section.itemName, section.unit, dateCell(row.date),
        row.documentNumber ?? '', row.description ?? '', formatInventoryQuantity(row.quantityMilli),
        row.direction, row.valueVnd, formatInventoryQuantity(row.quantityBalanceMilli), row.valueBalanceVnd,
        row.unitCostVnd, row.recordedUnitCostVnd, row.reversal ? 'REVERSAL' : '',
      ]);
    }
    rows.push([
      'TOTAL', section.itemCode, section.itemName, section.unit, '', '', '',
      `IN ${formatInventoryQuantity(section.inboundQuantityMilli)} / OUT ${formatInventoryQuantity(section.outboundQuantityMilli)}`,
      '', section.inboundValueVnd - section.outboundValueVnd,
      formatInventoryQuantity(section.closingQuantityMilli), section.closingValueVnd,
      section.periodAverageUnitCostVnd, section.valuationAdjustmentVnd, section.valuationMethod,
    ]);
  }
  return {
    code: 'S2c-DNSN',
    title,
    columns: [
      'rowType', 'itemCode', 'itemName', 'unit', 'date', 'documentNumber', 'description',
      'quantity', 'direction', 'movementValueVnd', 'quantityBalance', 'valueBalanceVnd',
      'valuationUnitCostVnd', 'recordedUnitCostVnd', 'valuationNote',
    ],
    rows,
  };
}

function s2dTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s2d']>): Tt58ReportTable {
  const rows: ReportCell[][] = [];
  for (const section of book.sections) {
    rows.push(['OPENING', section.accountId, section.accountName, section.accountKind ?? '', '', '', '', 0, 0, section.openingBalance]);
    for (const row of section.rows) {
      rows.push(['ENTRY', section.accountId, section.accountName, section.accountKind ?? '', dateCell(row.date), row.documentNumber ?? '', row.description ?? '', row.moneyIn, row.moneyOut, row.balance]);
    }
    rows.push(['TOTAL', section.accountId, section.accountName, section.accountKind ?? '', '', '', '', section.totalIn, section.totalOut, section.closingBalance]);
  }
  return {
    code: 'S2d-DNSN',
    title,
    columns: ['rowType', 'accountId', 'accountName', 'accountKind', 'date', 'documentNumber', 'description', 'moneyIn', 'moneyOut', 'balance'],
    rows,
  };
}

function s3bTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s3b']>): Tt58ReportTable {
  const rows: ReportCell[][] = book.rows.map((row) => [
    'ENTRY', dateCell(row.date), row.documentNumber ?? '', row.description ?? '', row.deductibleVatInput, row.vatOutput,
  ]);
  rows.push(['TOTAL', '', '', '', book.deductibleVatInputTotal, book.vatOutputTotal]);
  for (const summary of settledRows(book.taxSettlement)) rows.push([summary[0]!, '', '', '', '', summary[1]!]);
  return {
    code: 'S3b-DNSN',
    title,
    columns: ['rowType', 'date', 'documentNumber', 'description', 'deductibleVatInput', 'vatOutput'],
    rows,
  };
}

function supplementaryMeta(book: { status: 'IMPLEMENTED' | 'PARTIAL'; issues: readonly { message: string }[] }) {
  return { status: book.status, issues: book.issues.map((issue) => issue.message) } as const;
}

function s4aTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s4a']>): Tt58ReportTable {
  const rows: ReportCell[][] = [];
  for (const section of book.sections) {
    rows.push(['OPENING', section.subjectCode, section.subjectName, section.subjectKind, '', '', 'Số dư đầu kỳ', 0, 0, section.openingReceivableVnd, 0, 0, section.openingPayableVnd]);
    for (const row of section.rows) {
      rows.push(['ENTRY', section.subjectCode, section.subjectName, section.subjectKind, dateCell(row.date), row.documentNumber ?? '', row.description ?? '', row.receivableIncreaseVnd, row.receivableCollectedVnd, row.receivableBalanceVnd, row.payableIncreaseVnd, row.payablePaidVnd, row.payableBalanceVnd]);
    }
    rows.push(['TOTAL', section.subjectCode, section.subjectName, section.subjectKind, '', '', 'Cộng phát sinh / Số dư cuối kỳ', section.totalReceivableIncreaseVnd, section.totalReceivableCollectedVnd, section.closingReceivableVnd, section.totalPayableIncreaseVnd, section.totalPayablePaidVnd, section.closingPayableVnd]);
  }
  return {
    code: 'S4a-DNSN', title,
    columns: ['rowType', 'subjectCode', 'subjectName', 'subjectKind', 'date', 'documentNumber', 'description', 'receivableIncrease', 'receivableCollected', 'receivableBalance', 'payableIncrease', 'payablePaid', 'payableBalance'],
    rows, ...supplementaryMeta(book),
  };
}

function s4bTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s4b']>): Tt58ReportTable {
  const rows: ReportCell[][] = book.rows.map((asset) => [
    'ENTRY', asset.increaseDocumentNumber, dateCell(asset.increaseDate), `${asset.code} · ${asset.name} · ${asset.category}`,
    asset.putIntoUseMonth, asset.originalCostVnd, asset.annualDepreciationRatePct, asset.depreciationVndForYear,
    asset.accumulatedDepreciationVnd, asset.decreaseDocumentNumber ?? '', asset.decreaseDate === undefined ? '' : dateCell(asset.decreaseDate), asset.decreaseReason ?? '',
  ]);
  return {
    code: 'S4b-DNSN', title,
    columns: ['rowType', 'increaseDocumentNumber', 'increaseDate', 'asset', 'putIntoUseMonth', 'originalCost', 'annualDepreciationRatePct', 'depreciationForYear', 'accumulatedDepreciation', 'decreaseDocumentNumber', 'decreaseDate', 'decreaseReason'],
    rows, ...supplementaryMeta(book),
  };
}

function s4cTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s4c']>): Tt58ReportTable {
  const rows: ReportCell[][] = book.rows.map((entry) => [
    'ENTRY', entry.taxCode, entry.taxName, dateCell(entry.date), entry.description, formatInventoryQuantity(entry.taxableQuantityMilli),
    entry.absoluteTaxRateVnd, entry.taxableUnitPriceVnd, entry.taxRatePct, entry.proportionalTaxVnd, entry.absoluteTaxVnd,
    entry.exportImportExcisePayableVnd, entry.environmentalProtectionTaxVnd, entry.resourceTaxVnd, entry.landUseTaxVnd, entry.otherTaxVnd,
  ]);
  return {
    code: 'S4c-DNSN', title,
    columns: ['rowType', 'taxCode', 'taxName', 'date', 'description', 'taxableQuantity', 'absoluteTaxRate', 'taxableUnitPrice', 'taxRatePct', 'proportionalTax', 'absoluteTax', 'exportImportExcisePayable', 'environmentalProtectionTax', 'resourceTax', 'landUseTax', 'otherTax'],
    rows, ...supplementaryMeta(book),
  };
}

function s4dTable(title: string, book: NonNullable<Tt58FinalMaterializedBooks['s4d']>): Tt58ReportTable {
  const rows: ReportCell[][] = [];
  for (const section of book.sections) {
    rows.push(['OPENING', section.accountCode, section.accountName, section.category, '', '', 'Số dư đầu kỳ', 0, 0, section.openingBalanceVnd]);
    for (const row of section.rows) {
      rows.push(['ENTRY', section.accountCode, section.accountName, section.category, dateCell(row.date), row.documentNumber ?? '', row.description, row.increaseVnd, row.decreaseVnd, row.balanceVnd]);
    }
    rows.push(['TOTAL', section.accountCode, section.accountName, section.category, '', '', 'Cộng phát sinh / Số dư cuối kỳ', section.totalIncreaseVnd, section.totalDecreaseVnd, section.closingBalanceVnd]);
  }
  return {
    code: 'S4d-DNSN', title,
    columns: ['rowType', 'accountCode', 'accountName', 'category', 'date', 'documentNumber', 'description', 'increase', 'decrease', 'balance'],
    rows, ...supplementaryMeta(book),
  };
}

function requiredImplementedCapabilities(capabilities: readonly Tt58RuntimeBookCapability[]): readonly Tt58RuntimeBookCapability[] {
  const required = capabilities.filter((capability) => capability.required);
  if (required.length === 0) throw new Error('TT58 tax profile has no required books to export');
  for (const capability of required) {
    if (capability.status !== 'IMPLEMENTED') {
      const detail = capability.blockers.length > 0 ? `: ${capability.blockers.join('; ')}` : '';
      throw new Error(`Cannot finalize TT58 report because ${capability.code} is ${capability.status}${detail}`);
    }
  }
  return required;
}

function coreTable(capability: Tt58RuntimeBookCapability, books: Tt58FinalMaterializedBooks): Tt58ReportTable {
  switch (capability.code) {
    case 'S1-DNSN': if (books.s1) return revenueTable('S1-DNSN', capability.name, books.s1); break;
    case 'S2a-DNSN': if (books.s2a) return revenueTable('S2a-DNSN', capability.name, books.s2a); break;
    case 'S2b-DNSN': if (books.s2b) return s2bTable(capability.name, books.s2b); break;
    case 'S2c-DNSN': if (books.s2c) return s2cTable(capability.name, books.s2c); break;
    case 'S2d-DNSN': if (books.s2d) return s2dTable(capability.name, books.s2d); break;
    case 'S3a-DNSN': if (books.s3a) return revenueTable('S3a-DNSN', capability.name, books.s3a); break;
    case 'S3b-DNSN': if (books.s3b) return s3bTable(capability.name, books.s3b); break;
  }
  throw new Error(`Required TT58 book ${capability.code} has no materialized export formatter`);
}

function supplementaryTables(capabilities: readonly Tt58RuntimeBookCapability[], books: Tt58FinalMaterializedBooks): Tt58ReportTable[] {
  const titles = new Map(capabilities.map((capability) => [capability.code, capability.name]));
  const tables: Tt58ReportTable[] = [];
  if (books.s4a && books.s4a.sections.length > 0) tables.push(s4aTable(titles.get('S4a-DNSN') ?? 'Sổ chi tiết thanh toán công nợ', books.s4a));
  if (books.s4b && books.s4b.rows.length > 0) tables.push(s4bTable(titles.get('S4b-DNSN') ?? 'Sổ tài sản cố định', books.s4b));
  if (books.s4c && books.s4c.rows.length > 0) tables.push(s4cTable(titles.get('S4c-DNSN') ?? 'Sổ theo dõi nghĩa vụ thuế khác', books.s4c));
  if (books.s4d && books.s4d.sections.length > 0) tables.push(s4dTable(titles.get('S4d-DNSN') ?? 'Sổ theo dõi vốn chủ sở hữu', books.s4d));
  return tables;
}

export function buildTt58ReportBundle(input: BuildTt58ReportInput): Tt58ReportBundle {
  if (!input.profile.taxProfileConfigured) throw new Error('TT58 tax profile must be configured before report export');
  if (!Number.isFinite(input.period.start) || !Number.isFinite(input.period.end) || input.period.start > input.period.end) throw new Error('Invalid TT58 report period');

  const required = requiredImplementedCapabilities(input.capabilities);
  const tables = required.map((capability) => coreTable(capability, input.materializedBooks));
  tables.push(...supplementaryTables(input.capabilities, input.materializedBooks));

  const s2c = input.materializedBooks.s2c;
  return {
    schemaVersion: 1,
    regime: input.profile.regime,
    entityType: input.profile.entityType,
    entityName: input.profile.entityName,
    entityAddress: input.profile.entityAddress,
    vatMethod: input.profile.vatMethod,
    incomeTaxMethod: input.profile.incomeTaxMethod,
    periodStart: input.period.start,
    periodEnd: input.period.end,
    inventoryValuation: s2c ? {
      method: s2c.valuationMethod,
      sections: s2c.sections.map((section) => ({
        itemId: section.itemId,
        itemCode: section.itemCode,
        closingQuantityMilli: section.closingQuantityMilli,
        closingValueVnd: section.closingValueVnd,
      })),
    } : undefined,
    tables,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) result[key] = sortJson(record[key]);
    return result;
  }
  return value;
}

export function canonicalReportJson(bundle: Tt58ReportBundle): string {
  return JSON.stringify(sortJson(bundle));
}

function csvCell(value: ReportCell): string {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportTableToCsv(table: Tt58ReportTable): string {
  const lines = [table.columns.map(csvCell).join(','), ...table.rows.map((row) => row.map(csvCell).join(',') )];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function parseTt58ReportBundle(json: string): Tt58ReportBundle {
  const parsed = JSON.parse(json) as Tt58ReportBundle;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tables)) throw new Error('Stored TT58 report snapshot is invalid');
  return parsed;
}

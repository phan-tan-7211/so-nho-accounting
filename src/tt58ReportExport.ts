import type { AccountingProfile } from './accountingProfile';
import type { ProjectionPeriod } from './accountingProjections';
import { formatInventoryQuantity } from './inventory';
import type { Tt58RuntimeBookCapability } from './tt58CapabilityReadiness';
import type { Tt58FinalMaterializedBooks } from './tt58TaxSettledBooks';

export type ReportCell = string | number;

export interface Tt58ReportTable {
  code: string;
  title: string;
  columns: readonly string[];
  rows: readonly (readonly ReportCell[])[];
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
    rows.push([
      'OPENING', section.itemCode, section.itemName, section.unit, '', '', '',
      formatInventoryQuantity(section.openingQuantityMilli), '', section.openingValueVnd,
      formatInventoryQuantity(section.openingQuantityMilli), section.openingValueVnd,
    ]);
    for (const row of section.rows) {
      rows.push([
        'ENTRY', section.itemCode, section.itemName, section.unit, dateCell(row.date),
        row.documentNumber ?? '', row.description ?? '', formatInventoryQuantity(row.quantityMilli),
        row.direction, row.valueVnd, formatInventoryQuantity(row.quantityBalanceMilli), row.valueBalanceVnd,
      ]);
    }
    rows.push([
      'TOTAL', section.itemCode, section.itemName, section.unit, '', '', '',
      `IN ${formatInventoryQuantity(section.inboundQuantityMilli)} / OUT ${formatInventoryQuantity(section.outboundQuantityMilli)}`,
      '', section.inboundValueVnd - section.outboundValueVnd,
      formatInventoryQuantity(section.closingQuantityMilli), section.closingValueVnd,
    ]);
  }
  return {
    code: 'S2c-DNSN',
    title,
    columns: [
      'rowType', 'itemCode', 'itemName', 'unit', 'date', 'documentNumber', 'description',
      'quantity', 'direction', 'movementValueVnd', 'quantityBalance', 'valueBalanceVnd',
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

function requiredImplementedCapabilities(
  capabilities: readonly Tt58RuntimeBookCapability[],
): readonly Tt58RuntimeBookCapability[] {
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

export function buildTt58ReportBundle(input: BuildTt58ReportInput): Tt58ReportBundle {
  if (!input.profile.taxProfileConfigured) throw new Error('TT58 tax profile must be configured before report export');
  if (!Number.isFinite(input.period.start) || !Number.isFinite(input.period.end) || input.period.start > input.period.end) {
    throw new Error('Invalid TT58 report period');
  }

  const required = requiredImplementedCapabilities(input.capabilities);
  const tables: Tt58ReportTable[] = [];
  for (const capability of required) {
    switch (capability.code) {
      case 'S1-DNSN':
        if (!input.materializedBooks.s1) throw new Error('S1-DNSN materialized book is missing');
        tables.push(revenueTable('S1-DNSN', capability.name, input.materializedBooks.s1));
        break;
      case 'S2a-DNSN':
        if (!input.materializedBooks.s2a) throw new Error('S2a-DNSN materialized book is missing');
        tables.push(revenueTable('S2a-DNSN', capability.name, input.materializedBooks.s2a));
        break;
      case 'S2b-DNSN':
        if (!input.materializedBooks.s2b) throw new Error('S2b-DNSN materialized book is missing');
        tables.push(s2bTable(capability.name, input.materializedBooks.s2b));
        break;
      case 'S2c-DNSN':
        if (!input.materializedBooks.s2c) throw new Error('S2c-DNSN materialized book is missing');
        tables.push(s2cTable(capability.name, input.materializedBooks.s2c));
        break;
      case 'S2d-DNSN':
        if (!input.materializedBooks.s2d) throw new Error('S2d-DNSN materialized book is missing');
        tables.push(s2dTable(capability.name, input.materializedBooks.s2d));
        break;
      case 'S3a-DNSN':
        if (!input.materializedBooks.s3a) throw new Error('S3a-DNSN materialized book is missing');
        tables.push(revenueTable('S3a-DNSN', capability.name, input.materializedBooks.s3a));
        break;
      case 'S3b-DNSN':
        if (!input.materializedBooks.s3b) throw new Error('S3b-DNSN materialized book is missing');
        tables.push(s3bTable(capability.name, input.materializedBooks.s3b));
        break;
      default:
        throw new Error(`Required TT58 book ${capability.code} has no export formatter in V1`);
    }
  }

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
  const lines = [table.columns.map(csvCell).join(','), ...table.rows.map((row) => row.map(csvCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function parseTt58ReportBundle(json: string): Tt58ReportBundle {
  const parsed = JSON.parse(json) as Tt58ReportBundle;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.tables)) throw new Error('Stored TT58 report snapshot is invalid');
  return parsed;
}

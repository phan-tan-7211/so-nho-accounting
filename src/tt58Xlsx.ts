import type { ReportCell, Tt58ReportBundle, Tt58ReportTable } from './tt58ReportExport';

interface XlsxCell {
  value?: ReportCell;
  style?: number;
}

interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  merges: string[];
  widths: number[];
  landscape?: boolean;
}

export interface Tt58XlsxOptions {
  draft?: boolean;
}

const STYLE_NORMAL = 0;
const STYLE_TITLE = 1;
const STYLE_HEADER = 2;
const STYLE_BOLD = 3;
const STYLE_MONEY = 4;
const STYLE_CENTER = 5;
const STYLE_NOTE = 6;
const STYLE_MONEY_BOLD = 7;

function c(value?: ReportCell, style = STYLE_NORMAL): XlsxCell {
  return { value, style };
}

function money(value: ReportCell | undefined, bold = false): XlsxCell {
  return c(typeof value === 'number' ? value : value ?? '', bold ? STYLE_MONEY_BOLD : STYLE_MONEY);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cellText(value: ReportCell | undefined): string {
  return value === undefined ? '' : String(value);
}

function periodYear(bundle: Tt58ReportBundle): number {
  return new Date(bundle.periodStart).getFullYear();
}

function officialIdentity(bundle: Tt58ReportBundle): { name: string; address: string } {
  const name = bundle.entityName?.trim();
  const address = bundle.entityAddress?.trim();
  if (!name || !address) {
    throw new Error('XLSX TT58 requires Đơn vị và Địa chỉ stored in the report snapshot. Configure them, then unlock/relock the period.');
  }
  return { name, address };
}

function commonHeader(
  bundle: Tt58ReportBundle,
  table: Tt58ReportTable,
  columnCount: number,
  title = table.title.toUpperCase(),
  subtitle?: string,
): { rows: XlsxCell[][]; merges: string[] } {
  const identity = officialIdentity(bundle);
  const end = columnName(columnCount);
  const rows: XlsxCell[][] = [
    [c(`ĐƠN VỊ: ${identity.name}`, STYLE_BOLD)],
    [c(`Địa chỉ: ${identity.address}`)],
    [c(title, STYLE_TITLE)],
    [c(`Năm: ${periodYear(bundle)}`, STYLE_CENTER)],
    [c(subtitle ?? 'Đơn vị tính: VND', STYLE_CENTER)],
  ];
  const merges = [`A3:${end}3`, `A4:${end}4`, `A5:${end}5`];
  return { rows, merges };
}

function footerRows(columnCount: number, draft: boolean): { rows: XlsxCell[][]; merges: string[] } {
  const end = columnName(columnCount);
  const rows: XlsxCell[][] = [
    [],
    [c(draft ? 'BẢN NHÁP — dữ liệu chưa khóa kỳ' : 'Nguồn: snapshot kỳ kế toán đã khóa', STYLE_NOTE)],
    [],
    [c('Người lập biểu', STYLE_CENTER), ...Array(Math.max(0, columnCount - 2)).fill(c()), c('Người đại diện theo pháp luật', STYLE_CENTER)],
    [c('(Ký, ghi rõ họ tên)', STYLE_CENTER), ...Array(Math.max(0, columnCount - 2)).fill(c()), c('(Ký, ghi rõ họ tên)', STYLE_CENTER)],
  ];
  return { rows, merges: [`A${2}:${end}${2}`] };
}

function settlementLabel(code: string, rowType: string): string | null {
  const tax = code === 'S2a-DNSN' || code === 'S3b-DNSN' ? 'GTGT' : 'TNDN';
  switch (rowType) {
    case 'OPENING_TAX_POSITION': return `Số thuế ${tax} còn phải nộp đầu kỳ (1)`;
    case 'PERIOD_TAX_CHANGE': return `Tổng số thuế ${tax} phải nộp trong kỳ (2)`;
    case 'TAX_PAID': return `Số thuế ${tax} đã nộp trong kỳ (3)`;
    case 'TAX_REFUNDED': return tax === 'GTGT' ? 'Số thuế GTGT đã được hoàn trong kỳ (4)' : null;
    case 'CLOSING_TAX_POSITION': return `Số thuế ${tax} còn phải nộp cuối kỳ`;
    default: return null;
  }
}

function revenueSheet(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet {
  const header = commonHeader(bundle, table, 4);
  const rows = [...header.rows];
  rows.push(
    [c('Hóa đơn, chứng từ', STYLE_HEADER), c('', STYLE_HEADER), c('Diễn giải', STYLE_HEADER), c('Số tiền', STYLE_HEADER)],
    [c('Số hiệu', STYLE_HEADER), c('Ngày, tháng', STYLE_HEADER), c('C', STYLE_HEADER), c('1', STYLE_HEADER)],
  );
  const merges = [...header.merges, 'A6:B6', 'C6:C7', 'D6:D7'];
  let currentGroup = '';
  let groupIndex = 0;

  for (const row of table.rows) {
    const rowType = cellText(row[0]);
    if (rowType === 'ENTRY') {
      const label = cellText(row[4]);
      const vatRate = row[6];
      const incomeRate = row[7];
      const key = `${label}|${vatRate}|${incomeRate}`;
      if (key !== currentGroup) {
        currentGroup = key;
        groupIndex += 1;
        const rates = [
          typeof vatRate === 'number' ? `GTGT ${vatRate}%` : '',
          typeof incomeRate === 'number' ? `TNDN ${incomeRate}%` : '',
        ].filter(Boolean).join(' · ');
        rows.push([c(), c(), c(`${String.fromCharCode(64 + Math.min(groupIndex, 26))}. Nhóm ${label}${rates ? ` (${rates})` : ''}`, STYLE_BOLD), c()]);
      }
      rows.push([c(row[2]), c(row[1], STYLE_CENTER), c(row[3]), money(row[5])]);
      continue;
    }
    if (rowType === 'GROUP_TOTAL') {
      rows.push([c(), c(), c(`Tổng cộng nhóm ${cellText(row[4])}`, STYLE_BOLD), money(row[5], true)]);
      if ((table.code === 'S1-DNSN' || table.code === 'S2a-DNSN') && typeof row[6] === 'number') {
        rows.push([c(), c(), c('Thuế GTGT', STYLE_BOLD), money(row[6], true)]);
      }
      if ((table.code === 'S1-DNSN' || table.code === 'S3a-DNSN') && typeof row[7] === 'number') {
        rows.push([c(), c(), c('Thuế TNDN', STYLE_BOLD), money(row[7], true)]);
      }
      continue;
    }
    if (rowType === 'TOTAL') {
      rows.push([c(), c(), c('Tổng doanh thu trong kỳ', STYLE_BOLD), money(row[5], true)]);
      if (table.code === 'S1-DNSN' && typeof row[6] === 'number') rows.push([c(), c(), c('Tổng số thuế GTGT phải nộp trong kỳ', STYLE_BOLD), money(row[6], true)]);
      if (table.code === 'S1-DNSN' && typeof row[7] === 'number') rows.push([c(), c(), c('Tổng số thuế TNDN phải nộp trong kỳ', STYLE_BOLD), money(row[7], true)]);
      continue;
    }
    const label = settlementLabel(table.code, rowType);
    if (label) rows.push([c(), c(), c(label, STYLE_BOLD), money(row[5], true)]);
  }

  appendFooter(rows, merges, 4, draft);
  return { name: table.code, rows, merges, widths: [18, 14, 54, 20] };
}

const EXPENSE_LABELS: Record<string, string> = {
  MATERIALS_GOODS_ENERGY: 'a) Chi phí nguyên liệu, vật liệu, nhiên liệu, năng lượng, hàng hóa',
  LABOR: 'b) Chi phí tiền lương, tiền công, phụ cấp, bảo hiểm và khoản chi cho người lao động',
  DEPRECIATION: 'c) Chi phí khấu hao tài sản cố định',
  OUTSIDE_SERVICES: 'd) Chi phí dịch vụ mua ngoài',
  INTEREST: 'đ) Chi phí lãi tiền vay',
  OTHER_DIRECT_BUSINESS: 'e) Chi phí khác phục vụ trực tiếp cho hoạt động sản xuất, kinh doanh',
};

function s2bSheet(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet {
  const header = commonHeader(bundle, table, 4);
  const rows = [...header.rows];
  const merges = [...header.merges, 'A6:B6', 'C6:C7', 'D6:D7'];
  rows.push(
    [c('Hóa đơn, chứng từ', STYLE_HEADER), c('', STYLE_HEADER), c('Diễn giải', STYLE_HEADER), c('Số tiền', STYLE_HEADER)],
    [c('Số hiệu', STYLE_HEADER), c('Ngày, tháng', STYLE_HEADER), c('C', STYLE_HEADER), c('1', STYLE_HEADER)],
  );
  let section = '';
  let expenseCategory = '';
  for (const row of table.rows) {
    const type = cellText(row[0]);
    if (type === 'ENTRY') {
      const nextSection = cellText(row[4]);
      if (nextSection !== section) {
        section = nextSection;
        expenseCategory = '';
        rows.push([c(), c(), c(section === 'REVENUE' ? '1. Doanh thu và thu nhập' : '2. Chi phí', STYLE_BOLD), c()]);
      }
      if (section === 'EXPENSE') {
        const nextCategory = cellText(row[5]);
        if (nextCategory !== expenseCategory) {
          expenseCategory = nextCategory;
          rows.push([c(), c(), c(EXPENSE_LABELS[nextCategory] ?? nextCategory, STYLE_BOLD), c()]);
        }
      }
      rows.push([c(row[2]), c(row[1], STYLE_CENTER), c(row[3]), money(row[6])]);
      continue;
    }
    if (type === 'TOTAL_REVENUE') rows.push([c(), c(), c('Cộng doanh thu và thu nhập', STYLE_BOLD), money(row[6], true)]);
    else if (type === 'TOTAL_EXPENSE') rows.push([c(), c(), c('Cộng chi phí', STYLE_BOLD), money(row[6], true)]);
    else {
      const label = settlementLabel(table.code, type);
      if (label) rows.push([c(), c(), c(label, STYLE_BOLD), money(row[6], true)]);
    }
  }
  appendFooter(rows, merges, 4, draft);
  return { name: table.code, rows, merges, widths: [18, 14, 64, 20] };
}

function splitS2cSections(table: Tt58ReportTable): ReportCell[][][] {
  const sections: ReportCell[][][] = [];
  let current: ReportCell[][] = [];
  for (const source of table.rows) {
    const row = [...source];
    if (row[0] === 'OPENING' && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

function parseQuantity(value: ReportCell | undefined): ReportCell {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value ?? '';
}

function s2cSheets(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet[] {
  const sections = splitS2cSections(table);
  return sections.map((section, index) => {
    const first = section[0] ?? [];
    const itemCode = cellText(first[1]);
    const itemName = cellText(first[2]);
    const unit = cellText(first[3]);
    const header = commonHeader(bundle, table, 11, table.title.toUpperCase(), `Tên vật liệu, dụng cụ, sản phẩm, hàng hóa: ${itemCode} · ${itemName} · ĐVT: ${unit}`);
    const rows = [...header.rows];
    const merges = [...header.merges, 'A6:B6', 'C6:C7', 'D6:D7', 'E6:E7', 'F6:G6', 'H6:I6', 'J6:K6'];
    rows.push(
      [c('Hóa đơn, chứng từ', STYLE_HEADER), c('', STYLE_HEADER), c('Diễn giải', STYLE_HEADER), c('ĐVT', STYLE_HEADER), c('Đơn giá', STYLE_HEADER), c('Nhập', STYLE_HEADER), c('', STYLE_HEADER), c('Xuất', STYLE_HEADER), c('', STYLE_HEADER), c('Tồn', STYLE_HEADER), c('', STYLE_HEADER)],
      [c('Số hiệu', STYLE_HEADER), c('Ngày, tháng', STYLE_HEADER), c('C', STYLE_HEADER), c('D', STYLE_HEADER), c('1', STYLE_HEADER), c('Số lượng', STYLE_HEADER), c('Thành tiền', STYLE_HEADER), c('Số lượng', STYLE_HEADER), c('Thành tiền', STYLE_HEADER), c('Số lượng', STYLE_HEADER), c('Thành tiền', STYLE_HEADER)],
    );
    for (const row of section) {
      const type = cellText(row[0]);
      if (type === 'OPENING') {
        rows.push([c(), c(), c('Tồn đầu kỳ', STYLE_BOLD), c(unit, STYLE_CENTER), c(), c(), c(), c(), c(), c(parseQuantity(row[10]), STYLE_CENTER), money(row[11], true)]);
      } else if (type === 'ENTRY') {
        const quantity = parseQuantity(row[7]);
        const direction = cellText(row[8]);
        const value = row[9];
        rows.push([
          c(row[5]), c(row[4], STYLE_CENTER), c(row[6]), c(unit, STYLE_CENTER), c(),
          direction === 'IN' ? c(quantity, STYLE_CENTER) : c(), direction === 'IN' ? money(value) : c(),
          direction === 'OUT' ? c(quantity, STYLE_CENTER) : c(), direction === 'OUT' ? money(value) : c(),
          c(parseQuantity(row[10]), STYLE_CENTER), money(row[11]),
        ]);
      } else if (type === 'TOTAL') {
        rows.push([c(), c(), c('Tồn cuối kỳ', STYLE_BOLD), c(unit, STYLE_CENTER), c(), c(), c(), c(), c(), c(parseQuantity(row[10]), STYLE_CENTER), money(row[11], true)]);
      }
    }
    appendFooter(rows, merges, 11, draft);
    return {
      name: uniqueSheetName(`S2c-${itemCode || index + 1}`, index),
      rows,
      merges,
      widths: [17, 14, 34, 10, 14, 13, 18, 13, 18, 13, 18],
      landscape: true,
    };
  });
}

function s2dSheet(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet {
  const header = commonHeader(bundle, table, 6);
  const rows = [...header.rows];
  const merges = [...header.merges, 'A6:B6', 'C6:C7', 'D6:D7', 'E6:E7', 'F6:F7'];
  rows.push(
    [c('Hóa đơn, chứng từ', STYLE_HEADER), c('', STYLE_HEADER), c('Diễn giải', STYLE_HEADER), c('Thu', STYLE_HEADER), c('Chi', STYLE_HEADER), c('Tồn', STYLE_HEADER)],
    [c('Số hiệu', STYLE_HEADER), c('Ngày, tháng', STYLE_HEADER), c('C', STYLE_HEADER), c('1', STYLE_HEADER), c('2', STYLE_HEADER), c('3', STYLE_HEADER)],
  );
  let currentAccount = '';
  for (const row of table.rows) {
    const type = cellText(row[0]);
    const accountKey = `${cellText(row[1])}|${cellText(row[2])}|${cellText(row[3])}`;
    if (accountKey !== currentAccount) {
      currentAccount = accountKey;
      rows.push([c(), c(), c(`Tài khoản tiền: ${cellText(row[2])} (${cellText(row[3])})`, STYLE_BOLD), c(), c(), c()]);
    }
    if (type === 'OPENING') rows.push([c(), c(), c('Số dư đầu kỳ', STYLE_BOLD), c(), c(), money(row[9], true)]);
    else if (type === 'ENTRY') rows.push([c(row[5]), c(row[4], STYLE_CENTER), c(row[6]), money(row[7]), money(row[8]), money(row[9])]);
    else if (type === 'TOTAL') rows.push([c(), c(), c('Cộng phát sinh / Số dư cuối kỳ', STYLE_BOLD), money(row[7], true), money(row[8], true), money(row[9], true)]);
  }
  appendFooter(rows, merges, 6, draft);
  return { name: table.code, rows, merges, widths: [18, 14, 46, 18, 18, 20] };
}

function s3bSheet(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet {
  const header = commonHeader(bundle, table, 5);
  const rows = [...header.rows];
  const merges = [...header.merges, 'A6:B6', 'C6:C7', 'D6:D7', 'E6:E7'];
  rows.push(
    [c('Hóa đơn, chứng từ', STYLE_HEADER), c('', STYLE_HEADER), c('Diễn giải', STYLE_HEADER), c('Số thuế GTGT đầu vào', STYLE_HEADER), c('Số thuế GTGT đầu ra', STYLE_HEADER)],
    [c('Số hiệu', STYLE_HEADER), c('Ngày, tháng', STYLE_HEADER), c('C', STYLE_HEADER), c('1', STYLE_HEADER), c('2', STYLE_HEADER)],
  );
  for (const row of table.rows) {
    const type = cellText(row[0]);
    if (type === 'ENTRY') {
      rows.push([c(row[2]), c(row[1], STYLE_CENTER), c(row[3]), money(row[4]), money(row[5])]);
    } else if (type === 'TOTAL') {
      rows.push([c(), c(), c('Cộng số phát sinh trong kỳ', STYLE_BOLD), money(row[4], true), money(row[5], true)]);
    } else if (type === 'OPENING_TAX_POSITION') {
      const signed = typeof row[5] === 'number' ? row[5] : 0;
      rows.push([c(), c(), c('Số thuế GTGT còn được khấu trừ hoặc được hoàn đầu kỳ', STYLE_BOLD), money(signed < 0 ? Math.abs(signed) : 0, true), c()]);
      rows.push([c(), c(), c('Số thuế GTGT còn phải nộp đầu kỳ', STYLE_BOLD), c(), money(signed > 0 ? signed : 0, true)]);
    } else if (type === 'PERIOD_TAX_CHANGE') {
      const signed = typeof row[5] === 'number' ? row[5] : 0;
      rows.push([c(), c(), c('Tổng số thuế GTGT phải nộp trong kỳ (2)', STYLE_BOLD), c(), money(Math.max(0, signed), true)]);
    } else if (type === 'TAX_PAID') {
      rows.push([c(), c(), c('Số thuế GTGT đã nộp trong kỳ (3)', STYLE_BOLD), c(), money(row[5], true)]);
    } else if (type === 'TAX_REFUNDED') {
      rows.push([c(), c(), c('Số thuế GTGT đã được hoàn trong kỳ (4)', STYLE_BOLD), money(row[5], true), c()]);
    } else if (type === 'CLOSING_TAX_POSITION') {
      const signed = typeof row[5] === 'number' ? row[5] : 0;
      rows.push([c(), c(), c('Số thuế GTGT còn được khấu trừ hoặc được hoàn cuối kỳ', STYLE_BOLD), money(signed < 0 ? Math.abs(signed) : 0, true), c()]);
      rows.push([c(), c(), c('Số thuế GTGT còn phải nộp cuối kỳ', STYLE_BOLD), c(), money(signed > 0 ? signed : 0, true)]);
    }
  }
  appendFooter(rows, merges, 5, draft);
  return { name: table.code, rows, merges, widths: [18, 14, 60, 22, 22] };
}

function appendFooter(rows: XlsxCell[][], merges: string[], columnCount: number, draft: boolean): void {
  const start = rows.length + 1;
  const footer = footerRows(columnCount, draft);
  rows.push(...footer.rows);
  const end = columnName(columnCount);
  merges.push(`A${start + 1}:${end}${start + 1}`);
}

function tableSheets(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): XlsxSheet[] {
  switch (table.code) {
    case 'S1-DNSN':
    case 'S2a-DNSN':
    case 'S3a-DNSN':
      return [revenueSheet(bundle, table, draft)];
    case 'S2b-DNSN': return [s2bSheet(bundle, table, draft)];
    case 'S2c-DNSN': return s2cSheets(bundle, table, draft);
    case 'S2d-DNSN': return [s2dSheet(bundle, table, draft)];
    case 'S3b-DNSN': return [s3bSheet(bundle, table, draft)];
    default: throw new Error(`No official XLSX renderer for ${table.code}`);
  }
}

function uniqueSheetName(base: string, index: number): string {
  const sanitized = base.replace(/[\\/*?:[\]]/g, '-').slice(0, 27);
  return `${sanitized}${index > 0 ? `-${index + 1}` : ''}`.slice(0, 31);
}

function columnName(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheetXml(sheet: XlsxSheet): string {
  const rowsXml = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      const style = cell.style ?? STYLE_NORMAL;
      if (cell.value === undefined || cell.value === '') return `<c r="${ref}" s="${style}"/>`;
      if (typeof cell.value === 'number') return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
      const value = escapeXml(String(cell.value));
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${value}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const cols = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const merges = sheet.merges.length > 0 ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rowsXml}</sheetData>${merges}` +
    `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>` +
    `<pageSetup orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/></numFmts>` +
    `<fonts count="5">` +
      `<font><sz val="11"/><name val="Arial"/></font>` +
      `<font><b/><sz val="14"/><name val="Arial"/></font>` +
      `<font><b/><sz val="11"/><name val="Arial"/></font>` +
      `<font><i/><sz val="10"/><name val="Arial"/></font>` +
      `<font><b/><sz val="11"/><name val="Arial"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="8">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf>` +
      `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
      `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf>` +
      `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="right" vertical="top"/></xf>` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center" vertical="top" wrapText="1"/></xf>` +
      `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf>` +
      `<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0"><alignment horizontal="right" vertical="top"/></xf>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function workbookXml(sheets: XlsxSheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
}

function workbookRelsXml(sheets: XlsxSheet[]): string {
  const sheetRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypesXml(sheets: XlsxSheet[]): string {
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function corePropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TT58 accounting books</dc:title><dc:creator>Sổ nhỏ</dc:creator><cp:lastModifiedBy>Sổ nhỏ</cp:lastModifiedBy></cp:coreProperties>`;
}

function appPropsXml(sheets: XlsxSheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Sổ nhỏ</Application><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zipStored(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data,
    ]);
    locals.push(local);
    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = concat(centrals);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return concat([...locals, central, end]);
}

function textEntry(name: string, content: string): ZipEntry {
  return { name, data: new TextEncoder().encode(content) };
}

export function buildTt58Xlsx(bundle: Tt58ReportBundle, options: Tt58XlsxOptions = {}): Uint8Array {
  officialIdentity(bundle);
  if (bundle.tables.length === 0) throw new Error('TT58 report has no books to render');
  const draft = options.draft === true;
  const sheets = bundle.tables.flatMap((table) => tableSheets(bundle, table, draft));
  if (sheets.length === 0) throw new Error('TT58 report produced no XLSX worksheets');
  const entries: ZipEntry[] = [
    textEntry('[Content_Types].xml', contentTypesXml(sheets)),
    textEntry('_rels/.rels', rootRelsXml()),
    textEntry('docProps/core.xml', corePropsXml()),
    textEntry('docProps/app.xml', appPropsXml(sheets)),
    textEntry('xl/workbook.xml', workbookXml(sheets)),
    textEntry('xl/_rels/workbook.xml.rels', workbookRelsXml(sheets)),
    textEntry('xl/styles.xml', stylesXml()),
    ...sheets.map((sheet, index) => textEntry(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet))),
  ];
  return zipStored(entries);
}

export function tt58XlsxFilename(month: string, locked: boolean): string {
  return `tt58-${month}-${locked ? 'locked' : 'draft'}.xlsx`;
}

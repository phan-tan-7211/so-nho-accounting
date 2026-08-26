import type { ReportCell, Tt58ReportBundle, Tt58ReportTable } from './tt58ReportExport';

interface Cell { value?: ReportCell; kind?: 'title' | 'header' | 'money' | 'bold' | 'center' | 'note' }
interface Sheet { name: string; rows: Cell[][]; merges: string[]; widths: number[]; landscape?: boolean }
export interface SupplementaryXlsxOptions { draft?: boolean }

const S4_CODES = new Set(['S4a-DNSN', 'S4b-DNSN', 'S4c-DNSN', 'S4d-DNSN']);
const STYLE: Record<NonNullable<Cell['kind']> | 'normal', number> = {
  normal: 0, title: 1, header: 2, bold: 3, money: 4, center: 5, note: 6,
};
const c = (value?: ReportCell, kind?: Cell['kind']): Cell => ({ value, kind });
const m = (value?: ReportCell): Cell => c(value ?? '', 'money');

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function col(index: number): string {
  let n = index;
  let result = '';
  while (n > 0) { n -= 1; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
  return result;
}
function text(value: ReportCell | undefined): string { return value === undefined ? '' : String(value); }
function identity(bundle: Tt58ReportBundle): { name: string; address: string } {
  const name = bundle.entityName?.trim();
  const address = bundle.entityAddress?.trim();
  if (!name || !address) throw new Error('XLSX S4 TT58 cần Đơn vị và Địa chỉ trong snapshot.');
  return { name, address };
}
function header(bundle: Tt58ReportBundle, table: Tt58ReportTable, count: number): { rows: Cell[][]; merges: string[] } {
  const entity = identity(bundle);
  const end = col(count);
  return {
    rows: [
      [c(`ĐƠN VỊ: ${entity.name}`, 'bold')],
      [c(`Địa chỉ: ${entity.address}`)],
      [c(table.title.toUpperCase(), 'title')],
      [c(`Năm: ${new Date(bundle.periodStart).getFullYear()}`, 'center')],
      [c('Sổ chi tiết bổ sung theo Điều 9 Thông tư 58/2026/TT-BTC', 'note')],
    ],
    merges: [`A3:${end}3`, `A4:${end}4`, `A5:${end}5`],
  };
}
function footer(rows: Cell[][], merges: string[], count: number, draft: boolean, status?: string, issues: readonly string[] = []): void {
  const end = col(count);
  rows.push([]);
  if (draft) rows.push([c('BẢN NHÁP — kỳ chưa khóa', 'note')]);
  else rows.push([c('Nguồn: snapshot kỳ kế toán đã khóa', 'note')]);
  merges.push(`A${rows.length}:${end}${rows.length}`);
  if (status === 'PARTIAL' || issues.length > 0) {
    rows.push([c(`CẢNH BÁO: ${issues.join('; ') || 'Sổ đang ở trạng thái PARTIAL.'}`, 'note')]);
    merges.push(`A${rows.length}:${end}${rows.length}`);
  }
  rows.push([], [c('Người lập biểu', 'center'), ...Array(Math.max(0, count - 2)).fill(c()), c('Người đại diện theo pháp luật', 'center')]);
}

function s4a(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): Sheet {
  const h = header(bundle, table, 9);
  const rows = [...h.rows];
  const merges = [...h.merges, 'A6:A7', 'B6:B7', 'C6:C7', 'D6:F6', 'G6:I6'];
  rows.push(
    [c('Số hiệu chứng từ', 'header'), c('Ngày, tháng', 'header'), c('Diễn giải', 'header'), c('Phải thu', 'header'), c('', 'header'), c('', 'header'), c('Phải trả', 'header'), c('', 'header'), c('', 'header')],
    [c('A', 'header'), c('B', 'header'), c('C', 'header'), c('Phát sinh', 'header'), c('Đã thu', 'header'), c('Còn phải thu', 'header'), c('Phát sinh', 'header'), c('Đã trả', 'header'), c('Còn phải trả', 'header')],
  );
  let current = '';
  for (const r of table.rows) {
    const key = `${text(r[1])}|${text(r[2])}|${text(r[3])}`;
    if (key !== current) {
      current = key;
      rows.push([c(), c(), c(`Đối tượng: ${text(r[1])} · ${text(r[2])} (${text(r[3])})`, 'bold')]);
    }
    const type = text(r[0]);
    if (type === 'OPENING') rows.push([c(), c(), c('Số dư đầu kỳ', 'bold'), c(), c(), m(r[9]), c(), c(), m(r[12])]);
    else if (type === 'ENTRY') rows.push([c(r[5]), c(r[4], 'center'), c(r[6]), m(r[7]), m(r[8]), m(r[9]), m(r[10]), m(r[11]), m(r[12])]);
    else if (type === 'TOTAL') rows.push([c(), c(), c('Cộng phát sinh / Số dư cuối kỳ', 'bold'), m(r[7]), m(r[8]), m(r[9]), m(r[10]), m(r[11]), m(r[12])]);
  }
  footer(rows, merges, 9, draft, table.status, table.issues);
  return { name: 'S4a-DNSN', rows, merges, widths: [18, 14, 42, 16, 16, 18, 16, 16, 18], landscape: true };
}

function s4b(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): Sheet {
  const h = header(bundle, table, 12);
  const rows = [...h.rows];
  const merges = [...h.merges];
  rows.push([c('Số CT tăng', 'header'), c('Ngày tăng', 'header'), c('Tên/đặc điểm/mã TSCĐ', 'header'), c('Tháng đưa vào dùng', 'header'), c('Nguyên giá', 'header'), c('Tỷ lệ KH năm %', 'header'), c('Khấu hao năm', 'header'), c('KH lũy kế', 'header'), c('Số CT giảm', 'header'), c('Ngày giảm', 'header'), c('Lý do giảm', 'header'), c('Ghi chú', 'header')]);
  for (const r of table.rows) {
    rows.push([c(r[1]), c(r[2], 'center'), c(r[3]), c(r[4], 'center'), m(r[5]), c(r[6], 'center'), m(r[7]), m(r[8]), c(r[9]), c(r[10], 'center'), c(r[11]), c()]);
  }
  footer(rows, merges, 12, draft, table.status, table.issues);
  return { name: 'S4b-DNSN', rows, merges, widths: [16, 13, 38, 15, 18, 13, 18, 18, 16, 13, 28, 12], landscape: true };
}

function s4c(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): Sheet {
  const h = header(bundle, table, 13);
  const rows = [...h.rows];
  const merges = [...h.merges];
  rows.push([c('Ngày', 'header'), c('Diễn giải', 'header'), c('SL tính thuế', 'header'), c('Mức thuế tuyệt đối', 'header'), c('Đơn giá tính thuế', 'header'), c('Thuế suất %', 'header'), c('Thuế tỷ lệ', 'header'), c('Thuế tuyệt đối', 'header'), c('XNK/TTĐB phải nộp', 'header'), c('BVMT', 'header'), c('Tài nguyên', 'header'), c('Sử dụng đất', 'header'), c('Thuế khác', 'header')]);
  let group = '';
  for (const r of table.rows) {
    const key = `${text(r[1])}|${text(r[2])}`;
    if (key !== group) { group = key; rows.push([c(), c(`Loại thuế: ${text(r[1])} · ${text(r[2])}`, 'bold')]); }
    rows.push([c(r[3], 'center'), c(r[4]), c(r[5], 'center'), m(r[6]), m(r[7]), c(r[8], 'center'), m(r[9]), m(r[10]), m(r[11]), m(r[12]), m(r[13]), m(r[14]), m(r[15])]);
  }
  footer(rows, merges, 13, draft, table.status, table.issues);
  return { name: 'S4c-DNSN', rows, merges, widths: [13, 34, 14, 17, 17, 12, 16, 16, 19, 16, 16, 16, 16], landscape: true };
}

function s4d(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): Sheet {
  const h = header(bundle, table, 6);
  const rows = [...h.rows];
  const merges = [...h.merges];
  rows.push([c('Số hiệu chứng từ', 'header'), c('Ngày, tháng', 'header'), c('Diễn giải', 'header'), c('Vốn tăng', 'header'), c('Vốn giảm', 'header'), c('Số dư', 'header')]);
  let group = '';
  for (const r of table.rows) {
    const key = `${text(r[1])}|${text(r[2])}|${text(r[3])}`;
    if (key !== group) { group = key; rows.push([c(), c(), c(`Khoản mục: ${text(r[1])} · ${text(r[2])} (${text(r[3])})`, 'bold')]); }
    const type = text(r[0]);
    if (type === 'OPENING') rows.push([c(), c(), c('Số dư đầu kỳ', 'bold'), c(), c(), m(r[9])]);
    else if (type === 'ENTRY') rows.push([c(r[5]), c(r[4], 'center'), c(r[6]), m(r[7]), m(r[8]), m(r[9])]);
    else if (type === 'TOTAL') rows.push([c(), c(), c('Cộng phát sinh / Số dư cuối kỳ', 'bold'), m(r[7]), m(r[8]), m(r[9])]);
  }
  footer(rows, merges, 6, draft, table.status, table.issues);
  return { name: 'S4d-DNSN', rows, merges, widths: [18, 14, 48, 18, 18, 20] };
}

function sheetFor(bundle: Tt58ReportBundle, table: Tt58ReportTable, draft: boolean): Sheet {
  switch (table.code) {
    case 'S4a-DNSN': return s4a(bundle, table, draft);
    case 'S4b-DNSN': return s4b(bundle, table, draft);
    case 'S4c-DNSN': return s4c(bundle, table, draft);
    case 'S4d-DNSN': return s4d(bundle, table, draft);
    default: throw new Error(`Không có renderer XLSX S4 cho ${table.code}.`);
  }
}

function worksheetXml(sheet: Sheet): string {
  const rowsXml = sheet.rows.map((row, ri) => `<row r="${ri + 1}">${row.map((cell, ci) => {
    const ref = `${col(ci + 1)}${ri + 1}`;
    const style = STYLE[cell.kind ?? 'normal'];
    if (cell.value === undefined || cell.value === '') return `<c r="${ref}" s="${style}"/>`;
    if (typeof cell.value === 'number') return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(String(cell.value))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const mergeXml = sheet.merges.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rowsXml}</sheetData>${mergeXml}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="${sheet.landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
function workbookXml(sheets: Sheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
}
function workbookRelsXml(sheets: Sheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}
function contentTypesXml(sheets: Sheet[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
}
const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

function u16(v: number) { return new Uint8Array([v & 255, (v >>> 8) & 255]); }
function u32(v: number) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }
function concat(parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out; }
function crc32(data: Uint8Array): number { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function zip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder(); const locals: Uint8Array[] = []; const centrals: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const crc = crc32(entry.data);
    const local = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data]);
    locals.push(local);
    centrals.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const central = concat(centrals);
  return concat([...locals, central, concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)])]);
}
function entry(name: string, value: string) { return { name, data: new TextEncoder().encode(value) }; }

export function buildTt58SupplementaryXlsx(bundle: Tt58ReportBundle, options: SupplementaryXlsxOptions = {}): Uint8Array {
  identity(bundle);
  const draft = options.draft === true;
  const tables = bundle.tables.filter((table) => S4_CODES.has(table.code));
  if (tables.length === 0) throw new Error('Kỳ này chưa có sổ S4 để xuất.');
  if (!draft) {
    const partial = tables.find((table) => table.status === 'PARTIAL');
    if (partial) throw new Error(`Không thể xuất XLSX S4 từ kỳ khóa vì ${partial.code} đang PARTIAL: ${(partial.issues ?? []).join('; ')}`);
  }
  const sheets = tables.map((table) => sheetFor(bundle, table, draft));
  return zip([
    entry('[Content_Types].xml', contentTypesXml(sheets)), entry('_rels/.rels', rootRels),
    entry('xl/workbook.xml', workbookXml(sheets)), entry('xl/_rels/workbook.xml.rels', workbookRelsXml(sheets)), entry('xl/styles.xml', stylesXml()),
    ...sheets.map((sheet, index) => entry(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet))),
  ]);
}

export function tt58SupplementaryXlsxFilename(month: string, locked: boolean): string {
  return `tt58-s4-${month}-${locked ? 'locked' : 'draft'}.xlsx`;
}

import type { ReportCell, Tt58ReportBundle, Tt58ReportTable } from './tt58ReportExport';

export interface Tt58PrintOptions {
  draft?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cell(value: ReportCell | undefined): string {
  if (value === undefined || value === '') return '';
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN').format(value);
  return escapeHtml(String(value));
}

function tableHtml(table: Tt58ReportTable): string {
  const headers = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const rows = table.rows.map((row) => (
    `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`
  )).join('');
  return `<section class="book"><h2>${escapeHtml(table.code)} · ${escapeHtml(table.title)}</h2><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

function periodLabel(bundle: Tt58ReportBundle): string {
  const start = new Date(bundle.periodStart);
  const end = new Date(bundle.periodEnd);
  const format = (date: Date) => new Intl.DateTimeFormat('vi-VN').format(date);
  return `${format(start)} – ${format(end)}`;
}

export function buildTt58PrintableHtml(
  bundle: Tt58ReportBundle,
  options: Tt58PrintOptions = {},
): string {
  const name = bundle.entityName?.trim();
  const address = bundle.entityAddress?.trim();
  if (!name || !address) {
    throw new Error('Bản in TT58 cần Đơn vị và Địa chỉ trong report snapshot.');
  }
  if (bundle.tables.length === 0) throw new Error('TT58 report has no books to print');
  const draft = options.draft === true;
  const valuation = bundle.inventoryValuation
    ? `<p class="meta">S2c valuation: ${escapeHtml(bundle.inventoryValuation.method)}</p>`
    : '';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>TT58 ${escapeHtml(periodLabel(bundle))}</title><style>
@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:10pt}header{margin-bottom:16px}h1{font-size:18pt;margin:6px 0}h2{font-size:13pt;margin:0 0 8px}.meta{margin:2px 0}.draft{border:2px solid #555;padding:6px 10px;font-weight:700;display:inline-block}.book{break-after:page;margin-bottom:18px}.book:last-child{break-after:auto}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #555;padding:4px 5px;vertical-align:top;white-space:pre-wrap;word-break:break-word}th{font-weight:700;background:#eee}.signatures{margin-top:28px;display:flex;justify-content:space-between;text-align:center}.signatures div{width:42%}.note{margin-top:10px;font-size:9pt;color:#444}@media screen{body{padding:18px;background:#fff}}
</style></head><body><header><p class="meta"><strong>ĐƠN VỊ:</strong> ${escapeHtml(name)}</p><p class="meta"><strong>Địa chỉ:</strong> ${escapeHtml(address)}</p><h1>Sổ kế toán TT58</h1><p class="meta">Kỳ: ${escapeHtml(periodLabel(bundle))}</p>${valuation}${draft ? '<p class="draft">BẢN NHÁP — KỲ CHƯA KHÓA</p>' : '<p class="meta"><strong>Nguồn:</strong> snapshot kỳ đã khóa</p>'}</header>${bundle.tables.map(tableHtml).join('')}<div class="signatures"><div><strong>Người lập biểu</strong><p>(Ký, ghi rõ họ tên)</p></div><div><strong>Người đại diện theo pháp luật</strong><p>(Ký, ghi rõ họ tên)</p></div></div><p class="note">Dùng chức năng In của trình duyệt và chọn “Lưu dưới dạng PDF” nếu cần file PDF. Nội dung được dựng từ cùng report bundle/snapshot dùng cho JSON, CSV và XLSX.</p></body></html>`;
}

export function openTt58PrintWindow(bundle: Tt58ReportBundle, options: Tt58PrintOptions = {}): void {
  const html = buildTt58PrintableHtml(bundle, options);
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('Trình duyệt đã chặn cửa sổ in. Hãy cho phép pop-up cho ứng dụng rồi thử lại.');
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 50);
}

import { describe, expect, it } from 'vitest';
import type { Tt58ReportBundle } from './tt58ReportExport';
import { buildTt58PrintableHtml } from './tt58Print';

const report: Tt58ReportBundle = {
  schemaVersion: 1,
  regime: 'TT58_2026_MICRO',
  entityType: 'MICRO_ENTERPRISE',
  entityName: 'Công ty <A>',
  entityAddress: '01 & 02 Đường B',
  vatMethod: 'PERCENT_ON_REVENUE',
  incomeTaxMethod: 'PERCENT_ON_REVENUE',
  periodStart: new Date(2026, 6, 1).getTime(),
  periodEnd: new Date(2026, 7, 1).getTime() - 1,
  tables: [{
    code: 'S1-DNSN',
    title: 'Sổ doanh thu',
    columns: ['rowType', 'amount'],
    rows: [['TOTAL', 1_000_000]],
  }],
};

describe('TT58 printable HTML', () => {
  it('is deterministic and escapes report identity/content', () => {
    const first = buildTt58PrintableHtml(report);
    const second = buildTt58PrintableHtml({ ...report, tables: [...report.tables] });
    expect(first).toBe(second);
    expect(first).toContain('Công ty &lt;A&gt;');
    expect(first).toContain('01 &amp; 02 Đường B');
    expect(first).toContain('S1-DNSN');
    expect(first).toContain('snapshot kỳ đã khóa');
  });

  it('marks draft print output clearly', () => {
    expect(buildTt58PrintableHtml(report, { draft: true })).toContain('BẢN NHÁP — KỲ CHƯA KHÓA');
  });

  it('fails closed when legal identity is missing', () => {
    expect(() => buildTt58PrintableHtml({ ...report, entityName: undefined })).toThrow(/Đơn vị và Địa chỉ/);
  });
});

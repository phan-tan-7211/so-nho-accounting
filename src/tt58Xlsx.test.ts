import { describe, expect, it } from 'vitest';
import type { Tt58ReportBundle } from './tt58ReportExport';
import { buildTt58Xlsx, tt58XlsxFilename } from './tt58Xlsx';

const base: Tt58ReportBundle = {
  schemaVersion: 1,
  regime: 'TT58_2026_MICRO',
  entityType: 'MICRO_ENTERPRISE',
  entityName: 'Công ty TNHH Thử nghiệm',
  entityAddress: '01 Đường A, TP.HCM',
  vatMethod: 'PERCENT_ON_REVENUE',
  incomeTaxMethod: 'PERCENT_ON_REVENUE',
  periodStart: new Date(2026, 6, 1).getTime(),
  periodEnd: new Date(2026, 7, 1).getTime() - 1,
  tables: [{
    code: 'S1-DNSN',
    title: 'Sổ doanh thu bán hàng hóa, dịch vụ',
    columns: ['rowType', 'date', 'documentNumber', 'description', 'activityLabel', 'taxRevenueAmount', 'vatTaxDueOrRate', 'incomeTaxDueOrRate'],
    rows: [
      ['ENTRY', '2026-07-03', 'HD01', 'Bán hàng A', 'Bán hàng', 1_000_000, 1, 2],
      ['GROUP_TOTAL', '', '', '', 'Bán hàng', 1_000_000, 10_000, 20_000],
      ['TOTAL', '', '', '', '', 1_000_000, 10_000, 20_000],
    ],
  }],
};

describe('TT58 XLSX renderer', () => {
  it('creates deterministic OpenXML ZIP bytes with official identity and book title', () => {
    const first = buildTt58Xlsx(base);
    const second = buildTt58Xlsx({ ...base, tables: [...base.tables] });
    expect([...first]).toEqual([...second]);
    expect([...first.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(first);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('Công ty TNHH Thử nghiệm');
    expect(text).toContain('SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ');
    expect(text).toContain('Thuế GTGT');
  });

  it('fails closed when the locked report snapshot does not contain unit identity', () => {
    expect(() => buildTt58Xlsx({ ...base, entityName: undefined })).toThrow(/Đơn vị và Địa chỉ/);
    expect(() => buildTt58Xlsx({ ...base, entityAddress: ' ' })).toThrow(/Đơn vị và Địa chỉ/);
  });

  it('creates a separate S2c worksheet for each inventory item section', () => {
    const report: Tt58ReportBundle = {
      ...base,
      vatMethod: 'PERCENT_ON_REVENUE',
      incomeTaxMethod: 'TAXABLE_INCOME',
      tables: [{
        code: 'S2c-DNSN',
        title: 'Sổ chi tiết vật liệu, dụng cụ, sản phẩm, hàng hóa',
        columns: [],
        rows: [
          ['OPENING', 'HH01', 'Hàng A', 'kg', '', '', '', '2', '', 20_000, '2', 20_000],
          ['ENTRY', 'HH01', 'Hàng A', 'kg', '2026-07-03', 'NK01', 'Nhập', '1', 'IN', 10_000, '3', 30_000],
          ['TOTAL', 'HH01', 'Hàng A', 'kg', '', '', '', '', '', 10_000, '3', 30_000],
          ['OPENING', 'HH02', 'Hàng B', 'cái', '', '', '', '1', '', 5_000, '1', 5_000],
          ['TOTAL', 'HH02', 'Hàng B', 'cái', '', '', '', '', '', 0, '1', 5_000],
        ],
      }],
    };
    const text = new TextDecoder().decode(buildTt58Xlsx(report));
    expect(text).toContain('sheet1.xml');
    expect(text).toContain('sheet2.xml');
    expect(text).toContain('S2c-HH01');
    expect(text).toContain('S2c-HH02-2');
  });

  it('marks draft output and generates stable filenames', () => {
    const text = new TextDecoder().decode(buildTt58Xlsx(base, { draft: true }));
    expect(text).toContain('BẢN NHÁP');
    expect(tt58XlsxFilename('2026-07', true)).toBe('tt58-2026-07-locked.xlsx');
    expect(tt58XlsxFilename('2026-07', false)).toBe('tt58-2026-07-draft.xlsx');
  });
});

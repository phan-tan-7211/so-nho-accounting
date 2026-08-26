import { describe, expect, it } from 'vitest';
import type { Tt58ReportBundle } from './tt58ReportExport';
import { assertLockedTt58XlsxCompatibility } from './tt58XlsxPolicy';

function report(code: string): Tt58ReportBundle {
  return {
    schemaVersion: 1,
    regime: 'TT58_2026_MICRO',
    entityType: 'MICRO_ENTERPRISE',
    entityName: 'Đơn vị A',
    entityAddress: 'Địa chỉ A',
    vatMethod: 'PERCENT_ON_REVENUE',
    incomeTaxMethod: code === 'S2c-DNSN' ? 'TAXABLE_INCOME' : 'PERCENT_ON_REVENUE',
    periodStart: 1,
    periodEnd: 2,
    tables: [{ code, title: code, columns: [], rows: [] }],
  };
}

describe('locked TT58 XLSX compatibility', () => {
  it('allows locked books whose export does not conflict with a pending valuation rule', () => {
    expect(() => assertLockedTt58XlsxCompatibility(report('S1-DNSN'))).not.toThrow();
  });

  it('blocks locked S2c until inventory valuation follows the TT58 period-average outbound formula', () => {
    expect(() => assertLockedTt58XlsxCompatibility(report('S2c-DNSN'))).toThrow(/đơn giá xuất kho theo bình quân/);
  });
});

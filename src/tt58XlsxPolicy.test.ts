import { describe, expect, it } from 'vitest';
import { TT58_INVENTORY_VALUATION_METHOD } from './inventory';
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
  it('allows locked books without S2c', () => {
    expect(() => assertLockedTt58XlsxCompatibility(report('S1-DNSN'))).not.toThrow();
  });

  it('keeps legacy locked S2c snapshots fail-closed', () => {
    expect(() => assertLockedTt58XlsxCompatibility(report('S2c-DNSN'))).toThrow(/snapshot khóa cũ/);
  });

  it('allows locked S2c after the snapshot records TT58 period-average valuation', () => {
    const compliant = {
      ...report('S2c-DNSN'),
      inventoryValuation: {
        method: TT58_INVENTORY_VALUATION_METHOD,
        sections: [{
          itemId: '11111111-1111-4111-8111-111111111111',
          itemCode: 'HH-01',
          closingQuantityMilli: 1_000,
          closingValueVnd: 20_000,
        }],
      },
    } satisfies Tt58ReportBundle;
    expect(() => assertLockedTt58XlsxCompatibility(compliant)).not.toThrow();
  });
});

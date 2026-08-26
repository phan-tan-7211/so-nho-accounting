import { describe, expect, it } from 'vitest';
import { TT58_INVENTORY_VALUATION_METHOD } from './inventory';
import { findPriorInventoryValuation } from './inventoryValuationSnapshot';
import type { Tt58ReportBundle } from './tt58ReportExport';

function snapshot(overrides: Partial<Tt58ReportBundle> = {}): Tt58ReportBundle {
  return {
    schemaVersion: 1,
    regime: 'TT58_2026_MICRO',
    entityType: 'MICRO_ENTERPRISE',
    vatMethod: 'PERCENT_ON_REVENUE',
    incomeTaxMethod: 'TAXABLE_INCOME',
    periodStart: 100,
    periodEnd: 199,
    inventoryValuation: {
      method: TT58_INVENTORY_VALUATION_METHOD,
      sections: [{
        itemId: '11111111-1111-4111-8111-111111111111',
        itemCode: 'HH-01',
        closingQuantityMilli: 9_000,
        closingValueVnd: 182_880,
      }],
    },
    tables: [{ code: 'S2c-DNSN', title: 'S2c', columns: [], rows: [] }],
    ...overrides,
  };
}

describe('S2c locked valuation carry-forward', () => {
  it('uses the immediately preceding compliant locked snapshot as the next opening', () => {
    const report = snapshot();
    const prior = findPriorInventoryValuation([{
      periodStart: 100,
      periodEnd: 199,
      status: 'LOCKED',
      revision: 2,
      reportSnapshotJson: JSON.stringify(report),
    }], { start: 200, end: 299 });

    expect(prior).toEqual({
      method: TT58_INVENTORY_VALUATION_METHOD,
      periodEnd: 199,
      sections: [{
        itemId: '11111111-1111-4111-8111-111111111111',
        itemCode: 'HH-01',
        closingQuantityMilli: 9_000,
        closingValueVnd: 182_880,
      }],
    });
  });

  it('does not reuse non-contiguous, unlocked or legacy S2c snapshots', () => {
    const compliant = snapshot();
    const legacy = snapshot({ inventoryValuation: undefined });
    expect(findPriorInventoryValuation([{
      periodStart: 100, periodEnd: 198, status: 'LOCKED', revision: 1,
      reportSnapshotJson: JSON.stringify(compliant),
    }], { start: 200, end: 299 })).toBeUndefined();
    expect(findPriorInventoryValuation([{
      periodStart: 100, periodEnd: 199, status: 'UNLOCKED', revision: 1,
      reportSnapshotJson: JSON.stringify(compliant),
    }], { start: 200, end: 299 })).toBeUndefined();
    expect(findPriorInventoryValuation([{
      periodStart: 100, periodEnd: 199, status: 'LOCKED', revision: 1,
      reportSnapshotJson: JSON.stringify(legacy),
    }], { start: 200, end: 299 })).toBeUndefined();
  });
});

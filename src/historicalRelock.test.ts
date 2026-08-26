import { describe, expect, it } from 'vitest';
import { TT58_INVENTORY_VALUATION_METHOD } from './inventory';
import type { PeriodLockRecord } from './periodLock';
import { analyzeHistoricalS2cRelockPlan } from './historicalRelock';
import { canonicalReportJson } from './tt58ReportExport';
import type { Tt58ReportBundle } from './tt58ReportExport';

function report(start: number, end: number, compliant: boolean): Tt58ReportBundle {
  return {
    schemaVersion: 1,
    regime: 'TT58_2026_MICRO',
    entityType: 'MICRO_ENTERPRISE',
    entityName: 'Đơn vị A',
    entityAddress: 'Địa chỉ A',
    vatMethod: 'PERCENT_ON_REVENUE',
    incomeTaxMethod: 'TAXABLE_INCOME',
    periodStart: start,
    periodEnd: end,
    inventoryValuation: compliant ? { method: TT58_INVENTORY_VALUATION_METHOD, sections: [] } : undefined,
    tables: [{ code: 'S2c-DNSN', title: 'S2c', columns: [], rows: [] }],
  };
}

function lock(start: number, end: number, compliant: boolean, revision = 1): PeriodLockRecord {
  return {
    id: `tt58-period:${start}:${end}`,
    periodStart: start,
    periodEnd: end,
    status: 'LOCKED',
    revision,
    lockedAt: end + 1,
    reportSnapshotJson: canonicalReportJson(report(start, end, compliant)),
  };
}

describe('historical S2c relock plan', () => {
  it('marks a fully compliant locked history as safe', () => {
    const plan = analyzeHistoricalS2cRelockPlan([
      lock(100, 199, true),
      lock(200, 299, true),
    ]);
    expect(plan.hasBlockingHistory).toBe(false);
    expect(plan.items.map((item) => item.status)).toEqual(['COMPLIANT', 'COMPLIANT']);
  });

  it('requires relock from the first legacy snapshot and blocks later carry-forward until repaired', () => {
    const plan = analyzeHistoricalS2cRelockPlan([
      lock(200, 299, true),
      lock(100, 199, false),
    ]);
    expect(plan.hasBlockingHistory).toBe(true);
    expect(plan.earliestRelockPeriodStart).toBe(100);
    expect(plan.items.map((item) => item.status)).toEqual(['RELOCK_REQUIRED', 'BLOCKED_BY_PRIOR_RELOCK']);
  });

  it('fails closed on an unreadable historical snapshot', () => {
    const broken: PeriodLockRecord = {
      ...lock(100, 199, true),
      reportSnapshotJson: '{not-json',
    };
    const plan = analyzeHistoricalS2cRelockPlan([broken]);
    expect(plan.items[0]?.status).toBe('INVALID_SNAPSHOT');
    expect(plan.hasBlockingHistory).toBe(true);
  });
});

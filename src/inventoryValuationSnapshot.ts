import {
  TT58_INVENTORY_VALUATION_METHOD,
} from './inventory';
import type { InventoryPriorValuationSnapshot } from './inventory';
import type { ProjectionPeriod } from './accountingProjections';
import { parseTt58ReportBundle } from './tt58ReportExport';

export interface LockedReportSnapshotLike {
  periodStart: number;
  periodEnd: number;
  status: string;
  revision: number;
  reportSnapshotJson: string;
}

export function findPriorInventoryValuation(
  locks: readonly LockedReportSnapshotLike[],
  period: ProjectionPeriod,
): InventoryPriorValuationSnapshot | undefined {
  const candidates = locks
    .filter((lock) => lock.status === 'LOCKED' && lock.periodEnd === period.start - 1)
    .sort((a, b) => b.revision - a.revision || b.periodStart - a.periodStart);
  const previous = candidates[0];
  if (!previous) return undefined;

  const report = parseTt58ReportBundle(previous.reportSnapshotJson);
  if (
    report.periodEnd !== previous.periodEnd ||
    report.inventoryValuation?.method !== TT58_INVENTORY_VALUATION_METHOD
  ) return undefined;

  return {
    method: TT58_INVENTORY_VALUATION_METHOD,
    periodEnd: previous.periodEnd,
    sections: report.inventoryValuation.sections.map((section) => ({ ...section })),
  };
}

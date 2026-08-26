import { TT58_INVENTORY_VALUATION_METHOD } from './inventory';
import type { PeriodLockRecord } from './periodLock';
import { parseTt58ReportBundle } from './tt58ReportExport';

export type HistoricalRelockStatus =
  | 'COMPLIANT'
  | 'RELOCK_REQUIRED'
  | 'BLOCKED_BY_PRIOR_RELOCK'
  | 'INVALID_SNAPSHOT';

export interface HistoricalRelockItem {
  periodStart: number;
  periodEnd: number;
  revision: number;
  lockStatus: PeriodLockRecord['status'];
  status: HistoricalRelockStatus;
  reason: string;
}

export interface HistoricalRelockPlan {
  items: readonly HistoricalRelockItem[];
  earliestRelockPeriodStart?: number;
  hasBlockingHistory: boolean;
}

function hasS2cSnapshot(lock: PeriodLockRecord): boolean {
  try {
    const report = parseTt58ReportBundle(lock.reportSnapshotJson);
    return report.tables.some((table) => table.code === 'S2c-DNSN');
  } catch {
    return true;
  }
}

export function analyzeHistoricalS2cRelockPlan(
  locks: readonly PeriodLockRecord[],
): HistoricalRelockPlan {
  const sorted = locks
    .filter(hasS2cSnapshot)
    .slice()
    .sort((left, right) => left.periodStart - right.periodStart || left.revision - right.revision);

  const items: HistoricalRelockItem[] = [];
  let chainBroken = false;
  let earliestRelockPeriodStart: number | undefined;

  for (const lock of sorted) {
    let report;
    try {
      report = parseTt58ReportBundle(lock.reportSnapshotJson);
    } catch {
      chainBroken = true;
      earliestRelockPeriodStart ??= lock.periodStart;
      items.push({
        periodStart: lock.periodStart,
        periodEnd: lock.periodEnd,
        revision: lock.revision,
        lockStatus: lock.status,
        status: 'INVALID_SNAPSHOT',
        reason: 'Snapshot kỳ này không đọc được; phải phục hồi/đối chiếu trước khi tái khóa lịch sử.',
      });
      continue;
    }

    const hasS2c = report.tables.some((table) => table.code === 'S2c-DNSN');
    if (!hasS2c) continue;

    const compliantValuation = report.inventoryValuation?.method === TT58_INVENTORY_VALUATION_METHOD;
    if (lock.status !== 'LOCKED' || !compliantValuation) {
      chainBroken = true;
      earliestRelockPeriodStart ??= lock.periodStart;
      items.push({
        periodStart: lock.periodStart,
        periodEnd: lock.periodEnd,
        revision: lock.revision,
        lockStatus: lock.status,
        status: 'RELOCK_REQUIRED',
        reason: lock.status !== 'LOCKED'
          ? 'Kỳ S2c đang mở khóa; cần khóa lại theo thứ tự thời gian để tạo snapshot valuation mới.'
          : 'Snapshot S2c cũ chưa có marker TT58_PERIOD_AVERAGE_V1.',
      });
      continue;
    }

    if (chainBroken) {
      items.push({
        periodStart: lock.periodStart,
        periodEnd: lock.periodEnd,
        revision: lock.revision,
        lockStatus: lock.status,
        status: 'BLOCKED_BY_PRIOR_RELOCK',
        reason: 'Valuation của kỳ này đã đúng nhưng chuỗi opening phải được tái lập sau khi xử lý kỳ cũ phía trước.',
      });
      continue;
    }

    items.push({
      periodStart: lock.periodStart,
      periodEnd: lock.periodEnd,
      revision: lock.revision,
      lockStatus: lock.status,
      status: 'COMPLIANT',
      reason: 'Snapshot S2c khóa bằng TT58_PERIOD_AVERAGE_V1 và không có blocker lịch sử trước đó.',
    });
  }

  return {
    items,
    earliestRelockPeriodStart,
    hasBlockingHistory: items.some((item) => item.status !== 'COMPLIANT'),
  };
}

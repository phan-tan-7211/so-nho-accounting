import { describe, expect, it } from 'vitest';
import {
  findPeriodLockCoveringTimestamp,
  lockCoversTimestamp,
  periodLockId,
} from './periodLock';
import type { PeriodLockRecord } from './periodLock';

const locked: PeriodLockRecord = {
  id: 'tt58-period:100:199',
  periodStart: 100,
  periodEnd: 199,
  status: 'LOCKED',
  revision: 1,
  lockedAt: 200,
  reportSnapshotJson: '{}',
};

describe('period lock range helpers', () => {
  it('uses an exact deterministic period id', () => {
    expect(periodLockId({ start: 100, end: 199 })).toBe('tt58-period:100:199');
  });

  it('covers both period boundaries only while locked', () => {
    expect(lockCoversTimestamp(locked, 100)).toBe(true);
    expect(lockCoversTimestamp(locked, 199)).toBe(true);
    expect(lockCoversTimestamp(locked, 200)).toBe(false);
    expect(lockCoversTimestamp({ ...locked, status: 'UNLOCKED' }, 150)).toBe(false);
  });

  it('finds the active lock that covers a transaction timestamp', () => {
    expect(findPeriodLockCoveringTimestamp([
      { ...locked, status: 'UNLOCKED' },
      { ...locked, id: 'second' },
    ], 150)?.id).toBe('second');
  });
});

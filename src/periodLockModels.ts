export type PeriodLockStatus = 'LOCKED' | 'UNLOCKED';
export type PeriodLockAction = 'LOCK' | 'UNLOCK';

export interface PeriodLockRecord {
  id: string;
  periodStart: number;
  periodEnd: number;
  status: PeriodLockStatus;
  revision: number;
  lockedAt: number;
  unlockedAt?: number;
  reportSnapshotJson: string;
}

export interface PeriodLockEvent {
  id: string;
  periodLockId: string;
  action: PeriodLockAction;
  revision: number;
  timestamp: number;
}

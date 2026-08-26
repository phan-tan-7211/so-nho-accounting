import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingDB } from '../src/db';
import { DataBackupService } from '../src/dataBackup';
import { AccountingEngineService } from '../src/engine';
import { AccountKind, TransactionType } from '../src/models';
import type { Account } from '../src/models';
import { PeriodLockService } from '../src/periodLock';
import { canonicalReportJson } from '../src/tt58ReportExport';
import { buildTt58PrintableHtml } from '../src/tt58Print';
import { buildTt58Xlsx } from '../src/tt58Xlsx';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = { start: 100, end: 199 } as const;
let sequence = 0;
const databases: string[] = [];

function dbName(label: string): string {
  const name = `AccountingDB-rc-${label}-${sequence++}`;
  databases.push(name);
  return name;
}

function account(): Account {
  return { id: CASH_ID, name: 'Tiền mặt', balance: 0, kind: AccountKind.CASH, createdAt: 1 };
}

function profile(): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    entityName: 'Công ty RC',
    entityAddress: '01 Đường Kiểm thử, TP.HCM',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: true,
    vatMethod: 'PERCENT_ON_REVENUE',
    incomeTaxMethod: 'PERCENT_ON_REVENUE',
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(async () => {
  while (databases.length > 0) {
    const name = databases.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('release candidate acceptance flow', () => {
  it('posts -> locks -> renders -> backs up -> restores -> reproduces the same locked outputs', async () => {
    const source = new AccountingDB(dbName('source'));
    await source.open();
    await source.accounts.put(account());
    await source.accountingProfiles.put(profile());

    const engine = new AccountingEngineService(source);
    await engine.processTransaction({
      date: 120,
      amount: 1_000_000,
      type: TransactionType.CASH_SALE,
      destinationAccountId: CASH_ID,
      documentNumber: 'HD-RC-001',
      description: 'Bán hàng acceptance',
      taxActivityLabel: 'Bán hàng',
      taxRevenueAmount: 1_000_000,
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      status: 'POSTED',
    });

    const sourceLocks = new PeriodLockService(source);
    const locked = await sourceLocks.lockPeriod(PERIOD);
    expect(locked.state.status).toBe('LOCKED');
    expect(locked.report.tables.map((table) => table.code)).toEqual(['S1-DNSN']);

    const sourceJson = canonicalReportJson(locked.report);
    const sourceXlsx = buildTt58Xlsx(locked.report);
    const sourcePrint = buildTt58PrintableHtml(locked.report);
    expect([...sourceXlsx.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(sourcePrint).toContain('Công ty RC');

    const backupJson = await new DataBackupService(source).exportJson(500);
    source.close();

    const restored = new AccountingDB(dbName('restored'));
    await restored.open();
    const restoreService = new DataBackupService(restored);
    const preview = await restoreService.previewJson(backupJson);
    expect(preview.lockedPeriods).toBe(1);
    await restoreService.restoreJson(backupJson);

    const restoredReport = await new PeriodLockService(restored).getLockedReport(PERIOD);
    expect(restoredReport).not.toBeNull();
    expect(canonicalReportJson(restoredReport!)).toBe(sourceJson);
    expect([...buildTt58Xlsx(restoredReport!)]).toEqual([...sourceXlsx]);
    expect(buildTt58PrintableHtml(restoredReport!)).toBe(sourcePrint);

    restored.close();
  });
});

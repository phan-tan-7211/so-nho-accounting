import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingDB } from '../src/db';
import { AccountKind, TransactionType } from '../src/models';
import { ReleaseReadinessService } from '../src/releaseReadiness';

let sequence = 0;
const names: string[] = [];
function databaseName(): string {
  const name = `AccountingDB-readiness-${sequence++}`;
  names.push(name);
  return name;
}

const profile: AccountingProfile = {
  id: 'primary',
  regime: TT58_REGIME,
  entityType: 'MICRO_ENTERPRISE',
  dataStartDate: '2026-07-01',
  taxProfileConfigured: true,
  vatMethod: 'PERCENT_ON_REVENUE',
  incomeTaxMethod: 'PERCENT_ON_REVENUE',
  createdAt: 1,
  updatedAt: 1,
};

afterEach(async () => {
  while (names.length) {
    const name = names.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('release readiness diagnostics', () => {
  it('reports orphan partner, missing account kind and corrupt lock snapshot as errors', async () => {
    const database = new AccountingDB(databaseName());
    await database.open();
    await database.accountingProfiles.put(profile);
    await database.accounts.put({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Legacy account',
      balance: 0,
      createdAt: 1,
    });
    await database.transactions.put({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      date: 100,
      amount: 100,
      amountBeforeVat: 100,
      vatAmount: 0,
      vatRate: 0,
      type: TransactionType.CREDIT_SALE,
      partnerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'POSTED',
      createdAt: 1,
      updatedAt: 1,
    });
    await database.periodLocks.put({
      id: 'tt58-period:100:199',
      periodStart: 100,
      periodEnd: 199,
      status: 'LOCKED',
      revision: 1,
      lockedAt: 200,
      reportSnapshotJson: '{bad-json',
    });

    const report = await new ReleaseReadinessService(database).scan(300);
    expect(report.ready).toBe(false);
    expect(report.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'ACCOUNT_KIND_MISSING',
      'TRANSACTION_PARTNER_MISSING',
      'LOCK_SNAPSHOT_INVALID',
    ]));
    database.close();
  });

  it('returns ready when configured data has no structural integrity errors', async () => {
    const database = new AccountingDB(databaseName());
    await database.open();
    await database.accountingProfiles.put(profile);
    await database.accounts.put({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Tiền mặt',
      balance: 0,
      kind: AccountKind.CASH,
      createdAt: 1,
    });

    const report = await new ReleaseReadinessService(database).scan(300);
    expect(report.ready).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(report.counts.accounts).toBe(1);
    database.close();
  });
});

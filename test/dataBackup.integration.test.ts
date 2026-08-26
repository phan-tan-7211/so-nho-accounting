import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { DataBackupService } from '../src/dataBackup';
import { AccountingDB } from '../src/db';
import { AccountKind } from '../src/models';
import type { Account } from '../src/models';
import { PartnerKind, PartnerService } from '../src/partners';

let sequence = 0;
const names: string[] = [];
function databaseName(): string {
  const name = `AccountingDB-backup-${sequence++}`;
  names.push(name);
  return name;
}

const profile: AccountingProfile = {
  id: 'primary',
  regime: TT58_REGIME,
  entityType: 'MICRO_ENTERPRISE',
  dataStartDate: '2026-07-01',
  taxProfileConfigured: false,
  vatMethod: 'UNCONFIGURED',
  incomeTaxMethod: 'UNCONFIGURED',
  createdAt: 1,
  updatedAt: 1,
};

function account(id: string, name: string): Account {
  return { id, name, balance: 0, kind: AccountKind.CASH, createdAt: 1 };
}

afterEach(async () => {
  while (names.length) {
    const name = names.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('full database backup and restore', () => {
  it('round-trips V7 data with a verified SHA-256 checksum', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open();
    await target.open();
    const sourceAccount = account('11111111-1111-4111-8111-111111111111', 'Tiền mặt');
    await source.accounts.put(sourceAccount);
    await source.accountingProfiles.put(profile);
    const partner = await new PartnerService(source).create({ code: 'KH-01', name: 'Khách A', kind: PartnerKind.CUSTOMER });

    const json = await new DataBackupService(source).exportJson(123456);
    const verified = await new DataBackupService(source).verifyJson(json);
    expect(verified.envelope.createdAt).toBe(123456);
    expect(verified.envelope.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    await target.accounts.put(account('22222222-2222-4222-8222-222222222222', 'Sentinel'));
    await new DataBackupService(target).restoreJson(json);

    expect(await target.accounts.toArray()).toEqual([sourceAccount]);
    expect(await target.accountingProfiles.get('primary')).toEqual(profile);
    expect(await target.partners.get(partner.id)).toEqual(partner);
    source.close();
    target.close();
  });

  it('rejects checksum tampering before replacing current data', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open();
    await target.open();
    await source.accounts.put(account('11111111-1111-4111-8111-111111111111', 'Nguồn'));
    const json = await new DataBackupService(source).exportJson(1);
    const tampered = JSON.parse(json) as { data: { accounts: Array<{ name: string }> } };
    tampered.data.accounts[0]!.name = 'Đã sửa';
    const sentinel = account('22222222-2222-4222-8222-222222222222', 'Sentinel');
    await target.accounts.put(sentinel);

    await expect(new DataBackupService(target).restoreJson(JSON.stringify(tampered))).rejects.toThrow(/checksum/);
    expect(await target.accounts.toArray()).toEqual([sentinel]);
    source.close();
    target.close();
  });

  it('rolls back table clears if a restore write fails mid-transaction', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open();
    await target.open();
    await source.accounts.put(account('11111111-1111-4111-8111-111111111111', 'Nguồn'));
    await new PartnerService(source).create({ code: 'KH-01', name: 'Khách A', kind: PartnerKind.CUSTOMER });
    const json = await new DataBackupService(source).exportJson(1);
    const sentinel = account('22222222-2222-4222-8222-222222222222', 'Sentinel');
    await target.accounts.put(sentinel);

    const originalBulkPut = target.partners.bulkPut;
    target.partners.bulkPut = (async () => { throw new Error('simulated partner restore failure'); }) as typeof target.partners.bulkPut;
    await expect(new DataBackupService(target).restoreJson(json)).rejects.toThrow('simulated partner restore failure');
    expect(await target.accounts.toArray()).toEqual([sentinel]);
    target.partners.bulkPut = originalBulkPut;
    source.close();
    target.close();
  });
});

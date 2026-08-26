import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, DataBackupService, canonicalBackupPayload } from '../src/dataBackup';
import { AccountingDB } from '../src/db';
import { AccountKind } from '../src/models';
import type { Account } from '../src/models';
import { PartnerKind, PartnerService } from '../src/partners';
import { DebtSubjectKind, SupplementaryDebtEntrySchema } from '../src/tt58Supplementary';

let sequence = 0;
const names: string[] = [];
function databaseName(): string {
  const name = `AccountingDB-backup-${sequence++}`;
  names.push(name);
  return name;
}

const profile: AccountingProfile = {
  id: 'primary', regime: TT58_REGIME, entityType: 'MICRO_ENTERPRISE', dataStartDate: '2026-07-01',
  taxProfileConfigured: false, vatMethod: 'UNCONFIGURED', incomeTaxMethod: 'UNCONFIGURED', createdAt: 1, updatedAt: 1,
};

function account(id: string, name: string): Account {
  return { id, name, balance: 0, kind: AccountKind.CASH, createdAt: 1 };
}

async function checksum(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

afterEach(async () => {
  while (names.length) {
    const name = names.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('full database backup and restore', () => {
  it('round-trips V8 core and S4 data with a verified SHA-256 checksum and preview summary', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open();
    await target.open();
    const sourceAccount = account('11111111-1111-4111-8111-111111111111', 'Tiền mặt');
    await source.accounts.put(sourceAccount);
    await source.accountingProfiles.put(profile);
    const partner = await new PartnerService(source).create({ code: 'KH-01', name: 'Khách A', kind: PartnerKind.CUSTOMER });
    const debt = SupplementaryDebtEntrySchema.parse({
      id: '44444444-4444-4444-8444-444444444444', subjectCode: 'VAY-01', subjectName: 'Khoản vay A',
      subjectKind: DebtSubjectKind.LOAN, date: 10, receivableIncreaseVnd: 0, receivableCollectedVnd: 0,
      payableIncreaseVnd: 500_000, payablePaidVnd: 0, createdAt: 10,
    });
    await source.supplementaryDebtEntries.put(debt);

    const service = new DataBackupService(source);
    const json = await service.exportJson(123456);
    const verified = await service.verifyJson(json);
    expect(verified.envelope.createdAt).toBe(123456);
    expect(verified.envelope.databaseVersion).toBe(8);
    expect(verified.envelope.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const preview = await service.previewJson(json);
    expect(preview).toMatchObject({
      createdAt: 123456,
      databaseVersion: 8,
      counts: {
        accounts: 1,
        accountingProfiles: 1,
        partners: 1,
        transactions: 0,
        inventoryItems: 0,
        supplementaryDebtEntries: 1,
        fixedAssets: 0,
        otherTaxEntries: 0,
        supplementaryEquityEntries: 0,
      },
      lockedPeriods: 0,
    });
    expect(preview.totalRecords).toBe(4);
    expect(preview.checksumSha256).toBe(verified.envelope.checksumSha256);

    await target.accounts.put(account('22222222-2222-4222-8222-222222222222', 'Sentinel'));
    await new DataBackupService(target).restoreJson(json);

    expect(await target.accounts.toArray()).toEqual([sourceAccount]);
    expect(await target.accountingProfiles.get('primary')).toEqual(profile);
    expect(await target.partners.get(partner.id)).toEqual(partner);
    expect(await target.supplementaryDebtEntries.get(debt.id)).toEqual(debt);
    source.close(); target.close();
  });

  it('verifies the original V7 checksum before normalizing missing S4 tables and restores them as empty', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open(); await target.open();
    await source.accounts.put(account('11111111-1111-4111-8111-111111111111', 'Nguồn V7'));
    const current = await new DataBackupService(source).exportEnvelope(99);
    const {
      supplementaryDebtEntries: _debt,
      fixedAssets: _assets,
      otherTaxEntries: _tax,
      supplementaryEquityEntries: _equity,
      ...legacyData
    } = current.data;
    const unsignedV7 = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      databaseVersion: 7,
      createdAt: current.createdAt,
      data: legacyData,
    } as const;
    const legacyJson = JSON.stringify({ ...unsignedV7, checksumSha256: await checksum(canonicalBackupPayload(unsignedV7)) });

    await target.supplementaryDebtEntries.put(SupplementaryDebtEntrySchema.parse({
      id: '55555555-5555-4555-8555-555555555555', subjectCode: 'OLD', subjectName: 'Sentinel debt',
      subjectKind: DebtSubjectKind.OTHER, date: 10, receivableIncreaseVnd: 1, receivableCollectedVnd: 0,
      payableIncreaseVnd: 0, payablePaidVnd: 0, createdAt: 10,
    }));
    const restored = await new DataBackupService(target).restoreJson(legacyJson);
    expect(restored.databaseVersion).toBe(7);
    expect(await target.accounts.count()).toBe(1);
    expect(await target.supplementaryDebtEntries.count()).toBe(0);
    expect(await target.fixedAssets.count()).toBe(0);
    expect(await target.otherTaxEntries.count()).toBe(0);
    expect(await target.supplementaryEquityEntries.count()).toBe(0);
    source.close(); target.close();
  });

  it('rejects checksum tampering before preview or replacement of current data', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open(); await target.open();
    await source.accounts.put(account('11111111-1111-4111-8111-111111111111', 'Nguồn'));
    const json = await new DataBackupService(source).exportJson(1);
    const tampered = JSON.parse(json) as { data: { accounts: Array<{ name: string }> } };
    tampered.data.accounts[0]!.name = 'Đã sửa';
    const sentinel = account('22222222-2222-4222-8222-222222222222', 'Sentinel');
    await target.accounts.put(sentinel);

    const targetService = new DataBackupService(target);
    await expect(targetService.previewJson(JSON.stringify(tampered))).rejects.toThrow(/checksum/);
    await expect(targetService.restoreJson(JSON.stringify(tampered))).rejects.toThrow(/checksum/);
    expect(await target.accounts.toArray()).toEqual([sentinel]);
    source.close(); target.close();
  });

  it('rolls back table clears if a restore write fails mid-transaction', async () => {
    const source = new AccountingDB(databaseName());
    const target = new AccountingDB(databaseName());
    await source.open(); await target.open();
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
    source.close(); target.close();
  });
});

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { TransactionType } from '../src/models';
import { PartnerKind, PartnerService } from '../src/partners';

let sequence = 0;
const names: string[] = [];
function databaseName(): string {
  const name = `AccountingDB-partner-${sequence++}`;
  names.push(name);
  return name;
}

afterEach(async () => {
  while (names.length) {
    const name = names.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('partner master integration', () => {
  it('accepts a compatible active partner and rejects missing/incompatible/inactive partners', async () => {
    const database = new AccountingDB(databaseName());
    await database.open();
    const partners = new PartnerService(database);
    const customer = await partners.create({ code: 'KH-01', name: 'Khách A', kind: PartnerKind.CUSTOMER });
    const supplier = await partners.create({ code: 'NCC-01', name: 'NCC A', kind: PartnerKind.SUPPLIER });
    const engine = new AccountingEngineService(database);

    const sale = await engine.processTransaction({
      date: 100,
      amount: 100_000,
      amountBeforeVat: 100_000,
      vatAmount: 0,
      vatRate: 0,
      type: TransactionType.CREDIT_SALE,
      partnerId: customer.id,
      status: 'POSTED',
    });
    expect(sale.partnerId).toBe(customer.id);

    await expect(engine.processTransaction({
      date: 110,
      amount: 50_000,
      amountBeforeVat: 50_000,
      vatAmount: 0,
      vatRate: 0,
      type: TransactionType.CREDIT_SALE,
      partnerId: supplier.id,
      status: 'POSTED',
    })).rejects.toThrow(/incompatible/);

    await expect(engine.processTransaction({
      date: 120,
      amount: 50_000,
      amountBeforeVat: 50_000,
      vatAmount: 0,
      vatRate: 0,
      type: TransactionType.CREDIT_SALE,
      partnerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'POSTED',
    })).rejects.toThrow(/not found/);

    await partners.setActive(customer.id, false);
    await expect(engine.processTransaction({
      date: 130,
      amount: 50_000,
      amountBeforeVat: 50_000,
      vatAmount: 0,
      vatRate: 0,
      type: TransactionType.CREDIT_SALE,
      partnerId: customer.id,
      status: 'POSTED',
    })).rejects.toThrow(/inactive/);

    database.close();
  });
});

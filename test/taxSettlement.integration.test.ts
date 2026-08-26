import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { TT58_REGIME } from '../src/accountingProfile';
import type { AccountingProfile } from '../src/accountingProfile';
import { AccountingProjectionService } from '../src/accountingProjectionService';
import { AccountingDB } from '../src/db';
import { AccountingEngineService } from '../src/engine';
import { AccountKind, TaxType, TransactionType, Tt58ExpenseCategory } from '../src/models';
import type { Account } from '../src/models';
import { createTaxOpeningPosition } from '../src/taxOpeningPosition';

const CASH_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = { start: 100, end: 199 } as const;
let dbSequence = 0;
const databasesToDelete: string[] = [];

function nextDatabaseName(): string {
  const name = `AccountingDB-tax-settlement-${dbSequence++}`;
  databasesToDelete.push(name);
  return name;
}

function account(): Account {
  return {
    id: CASH_ID,
    name: 'Tiền mặt',
    balance: 1_000,
    kind: AccountKind.CASH,
    createdAt: 1,
  };
}

function profile(): AccountingProfile {
  return {
    id: 'primary',
    regime: TT58_REGIME,
    entityType: 'MICRO_ENTERPRISE',
    dataStartDate: '2026-07-01',
    taxProfileConfigured: true,
    vatMethod: 'DEDUCTION',
    incomeTaxMethod: 'TAXABLE_INCOME',
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(async () => {
  while (databasesToDelete.length > 0) {
    const name = databasesToDelete.pop();
    if (name) await Dexie.delete(name);
  }
});

const describeIndexedDb = process.env.CI === 'true' ? describe : describe.skip;

describeIndexedDb('TT58 tax settlement integration', () => {
  it('keeps tax settlement, cash and TT58 books consistent through IndexedDB', async () => {
    const database = new AccountingDB(nextDatabaseName());
    await database.open();
    await database.accounts.put(account());
    await database.accountingProfiles.put(profile());
    await database.taxOpeningPositions.bulkPut([
      createTaxOpeningPosition({
        taxType: TaxType.VAT,
        periodStart: PERIOD.start,
        amount: -20,
        now: 1,
      }),
      createTaxOpeningPosition({
        taxType: TaxType.INCOME_TAX,
        periodStart: PERIOD.start,
        amount: 5,
        now: 1,
      }),
    ]);

    const engine = new AccountingEngineService(database);
    await engine.processTransaction({
      date: 120,
      amount: 110,
      type: TransactionType.CASH_PURCHASE,
      sourceAccountId: CASH_ID,
      amountBeforeVat: 100,
      vatAmount: 10,
      vatRate: 10,
      vatDeductible: false,
      tt58ExpenseCategory: Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY,
      documentNumber: 'PUR-001',
      status: 'POSTED',
    });
    await engine.processTransaction({
      date: 130,
      amount: 30,
      type: TransactionType.TAX_ASSESSMENT,
      taxType: TaxType.INCOME_TAX,
      taxPeriodStart: PERIOD.start,
      taxPeriodEnd: PERIOD.end,
      documentNumber: 'CIT-ASS-001',
      status: 'POSTED',
    });
    await engine.processTransaction({
      date: 140,
      amount: 10,
      type: TransactionType.TAX_PAYMENT,
      taxType: TaxType.INCOME_TAX,
      sourceAccountId: CASH_ID,
      documentNumber: 'CIT-PAY-001',
      status: 'POSTED',
    });
    await engine.processTransaction({
      date: 150,
      amount: 5,
      type: TransactionType.TAX_REFUND,
      taxType: TaxType.VAT,
      destinationAccountId: CASH_ID,
      documentNumber: 'VAT-REF-001',
      status: 'POSTED',
    });

    const result = await new AccountingProjectionService(database).buildTt58Projection(PERIOD);

    expect(result.materializedBooks.s2b).toMatchObject({
      status: 'IMPLEMENTED',
      expenseTotal: 110,
      taxSettlement: {
        openingPayable: 5,
        periodNetTaxChange: 30,
        paid: 10,
        closingPayable: 25,
      },
    });
    expect(result.materializedBooks.s3b).toMatchObject({
      status: 'IMPLEMENTED',
      deductibleVatInputTotal: 0,
      taxSettlement: {
        openingCredit: 20,
        refunded: 5,
        closingCredit: 15,
      },
    });

    const moneyBook = result.materializedBooks.s2d;
    expect(moneyBook?.status).toBe('IMPLEMENTED');
    expect(moneyBook?.sections[0]).toMatchObject({
      accountId: CASH_ID,
      openingBalance: 1_000,
      totalIn: 5,
      totalOut: 120,
      closingBalance: 885,
    });
    expect(await engine.getBalance(CASH_ID)).toBe(885);
    expect((await database.accounts.get(CASH_ID))?.balance).toBe(1_000);

    database.close();
  });
});

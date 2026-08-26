import { AccountingEffectKind } from './accountingEffects';
import type { AccountingProfile } from './accountingProfile';
import type {
  AccountingDimensionProjection,
  AccountingJournalEntry,
  ProjectionPeriod,
} from './accountingProjections';
import { TaxType, TransactionType } from './models';
import type { TaxType as TaxTypeValue, Transaction } from './models';
import { TaxOpeningPositionSchema } from './taxOpeningPosition';
import type { TaxOpeningPosition } from './taxOpeningPosition';
import type { Tt58MaterializedBooks } from './tt58MaterializedBooks';

export type TaxSettlementStatus = 'COMPLETE' | 'PARTIAL';

export interface TaxSettlementIssue {
  code:
    | 'MISSING_TAX_OPENING_POSITION'
    | 'LEGACY_TAX_ACTIVITY_UNAVAILABLE'
    | 'NEGATIVE_OPENING_POSITION_UNSUPPORTED'
    | 'MISSING_INCOME_TAX_ASSESSMENT'
    | 'INCOME_TAX_ASSESSMENT_PERIOD_MISMATCH';
  message: string;
  transactionId?: string;
  taxType?: TaxTypeValue;
}

export interface TaxSettlementSummary {
  taxType: TaxTypeValue;
  status: TaxSettlementStatus;
  issues: readonly TaxSettlementIssue[];
  openingNetPosition: number;
  openingPayable: number;
  openingCredit: number;
  periodNetTaxChange: number;
  periodTaxDue: number;
  paid: number;
  refunded: number;
  closingNetPosition: number;
  closingPayable: number;
  closingCredit: number;
  assessmentConfirmed?: boolean;
}

export interface Tt58TaxSettlementBundle {
  vat?: TaxSettlementSummary;
  incomeTax?: TaxSettlementSummary;
}

export interface ProjectTt58TaxSettlementsInput {
  profile: AccountingProfile;
  projection: AccountingDimensionProjection;
  transactions: readonly Transaction[];
  taxOpeningPositions: readonly TaxOpeningPosition[];
  materializedBooks: Tt58MaterializedBooks;
  period: ProjectionPeriod;
}

function addSafe(current: number, amount: number, label: string): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe VND integer range`);
  return next;
}

function openingFor(
  taxType: TaxTypeValue,
  periodStart: number,
  positions: readonly TaxOpeningPosition[],
  issues: TaxSettlementIssue[],
): number {
  const matches = positions.filter(
    (position) => position.taxType === taxType && position.periodStart === periodStart,
  );
  if (matches.length === 0) {
    issues.push({
      code: 'MISSING_TAX_OPENING_POSITION',
      taxType,
      message: `Explicit ${taxType} opening position is required for reporting period start ${periodStart}`,
    });
    return 0;
  }
  if (matches.length > 1) {
    throw new Error(`Duplicate ${taxType} opening positions for period start ${periodStart}`);
  }
  return matches[0]!.amount;
}

function transactionSource(
  entry: AccountingJournalEntry,
  transactionsById: ReadonlyMap<string, Transaction>,
): Transaction {
  const tx = transactionsById.get(entry.transactionId);
  if (!tx) throw new Error(`Transaction ${entry.transactionId} is missing during tax settlement projection`);
  if (!tx.reversalOfTransactionId) return tx;
  return transactionsById.get(tx.reversalOfTransactionId) ?? tx;
}

function taxEffectAmount(entry: AccountingJournalEntry, taxType: TaxTypeValue): number {
  let total = 0;
  for (const effect of entry.effects) {
    if (effect.kind !== AccountingEffectKind.TAX || effect.taxType !== taxType) continue;
    total = addSafe(total, effect.amount, `${taxType} settlement effect`);
  }
  return total;
}

function settlementEvents(
  taxType: TaxTypeValue,
  projection: AccountingDimensionProjection,
  transactions: readonly Transaction[],
  period: ProjectionPeriod,
  issues: TaxSettlementIssue[],
): { paid: number; refunded: number; assessed: number; assessmentConfirmed: boolean } {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  let paid = 0;
  let refunded = 0;
  let assessed = 0;

  for (const entry of projection.entries) {
    const taxAmount = taxEffectAmount(entry, taxType);
    if (taxAmount === 0 && entry.type !== TransactionType.TAX_ASSESSMENT) continue;
    const source = transactionSource(entry, byId);

    if (source.type === TransactionType.TAX_PAYMENT && source.taxType === taxType) {
      // TAX_PAYMENT has a negative TAX effect; its REVERSAL has the exact positive inverse.
      paid = addSafe(paid, -taxAmount, `${taxType} paid`);
    } else if (source.type === TransactionType.TAX_REFUND && source.taxType === taxType) {
      refunded = addSafe(refunded, taxAmount, `${taxType} refunded`);
    } else if (source.type === TransactionType.TAX_ASSESSMENT && source.taxType === taxType) {
      if (source.taxPeriodStart !== period.start || source.taxPeriodEnd !== period.end) {
        issues.push({
          code: 'INCOME_TAX_ASSESSMENT_PERIOD_MISMATCH',
          taxType,
          transactionId: entry.transactionId,
          message: 'Income-tax assessment inside this report must identify the exact requested reporting period',
        });
      } else {
        assessed = addSafe(assessed, taxAmount, `${taxType} assessed`);
      }
    }
  }

  const assessmentConfirmed = transactions.some(
    (tx) =>
      tx.type === TransactionType.TAX_ASSESSMENT &&
      tx.taxType === taxType &&
      tx.taxPeriodStart === period.start &&
      tx.taxPeriodEnd === period.end &&
      tx.status === 'POSTED' &&
      tx.date >= period.start &&
      tx.date <= period.end,
  );

  return { paid, refunded, assessed, assessmentConfirmed };
}

function finishSummary(
  taxType: TaxTypeValue,
  openingNetPosition: number,
  periodNetTaxChange: number,
  paid: number,
  refunded: number,
  issues: readonly TaxSettlementIssue[],
  assessmentConfirmed?: boolean,
): TaxSettlementSummary {
  let closingNetPosition = openingNetPosition;
  closingNetPosition = addSafe(closingNetPosition, periodNetTaxChange, `${taxType} closing position`);
  closingNetPosition = addSafe(closingNetPosition, -paid, `${taxType} closing position`);
  closingNetPosition = addSafe(closingNetPosition, refunded, `${taxType} closing position`);

  return {
    taxType,
    status: issues.length === 0 ? 'COMPLETE' : 'PARTIAL',
    issues,
    openingNetPosition,
    openingPayable: Math.max(openingNetPosition, 0),
    openingCredit: Math.max(-openingNetPosition, 0),
    periodNetTaxChange,
    periodTaxDue: Math.max(periodNetTaxChange, 0),
    paid,
    refunded,
    closingNetPosition,
    closingPayable: Math.max(closingNetPosition, 0),
    closingCredit: Math.max(-closingNetPosition, 0),
    assessmentConfirmed,
  };
}

function projectVatSettlement(input: ProjectTt58TaxSettlementsInput): TaxSettlementSummary {
  const { profile, projection, transactions, taxOpeningPositions, materializedBooks, period } = input;
  const issues: TaxSettlementIssue[] = [];
  if (projection.activityCoverage.status === 'PARTIAL') {
    issues.push({
      code: 'LEGACY_TAX_ACTIVITY_UNAVAILABLE',
      taxType: TaxType.VAT,
      message: projection.activityCoverage.reason ?? 'Legacy VAT activity cannot be reconstructed in this period',
    });
  }

  const opening = openingFor(TaxType.VAT, period.start, taxOpeningPositions, issues);
  if (profile.vatMethod === 'PERCENT_ON_REVENUE' && opening < 0) {
    issues.push({
      code: 'NEGATIVE_OPENING_POSITION_UNSUPPORTED',
      taxType: TaxType.VAT,
      message: 'S2a tracks VAT payable opening balance; a negative VAT opening credit is not representable in this book',
    });
  }

  const events = settlementEvents(TaxType.VAT, projection, transactions, period, issues);
  let periodNetTaxChange = 0;
  if (profile.vatMethod === 'PERCENT_ON_REVENUE') {
    periodNetTaxChange = materializedBooks.s2a?.totalVatTaxDue ?? 0;
  } else {
    const s3b = materializedBooks.s3b;
    if (s3b) {
      periodNetTaxChange = addSafe(
        s3b.vatOutputTotal,
        -s3b.deductibleVatInputTotal,
        'VAT deduction period net change',
      );
    }
  }

  return finishSummary(
    TaxType.VAT,
    opening,
    periodNetTaxChange,
    events.paid,
    events.refunded,
    issues,
  );
}

function projectIncomeTaxSettlement(input: ProjectTt58TaxSettlementsInput): TaxSettlementSummary {
  const { profile, projection, transactions, taxOpeningPositions, materializedBooks, period } = input;
  const issues: TaxSettlementIssue[] = [];
  if (projection.activityCoverage.status === 'PARTIAL') {
    issues.push({
      code: 'LEGACY_TAX_ACTIVITY_UNAVAILABLE',
      taxType: TaxType.INCOME_TAX,
      message: projection.activityCoverage.reason ?? 'Legacy income-tax activity cannot be reconstructed in this period',
    });
  }

  const opening = openingFor(TaxType.INCOME_TAX, period.start, taxOpeningPositions, issues);
  if (profile.incomeTaxMethod === 'PERCENT_ON_REVENUE' && opening < 0) {
    issues.push({
      code: 'NEGATIVE_OPENING_POSITION_UNSUPPORTED',
      taxType: TaxType.INCOME_TAX,
      message: 'S3a tracks income-tax payable opening balance; a negative opening credit is not representable in this book',
    });
  }

  const events = settlementEvents(TaxType.INCOME_TAX, projection, transactions, period, issues);
  let periodNetTaxChange = 0;
  if (profile.incomeTaxMethod === 'PERCENT_ON_REVENUE') {
    periodNetTaxChange = materializedBooks.s3a?.totalIncomeTaxDue ?? 0;
  } else {
    periodNetTaxChange = events.assessed;
    if (!events.assessmentConfirmed) {
      issues.push({
        code: 'MISSING_INCOME_TAX_ASSESSMENT',
        taxType: TaxType.INCOME_TAX,
        message: 'TAXABLE_INCOME requires an explicit posted TNDN assessment for the exact reporting period, including an explicit zero assessment when tax due is zero',
      });
    }
  }

  return finishSummary(
    TaxType.INCOME_TAX,
    opening,
    periodNetTaxChange,
    events.paid,
    0,
    issues,
    profile.incomeTaxMethod === 'TAXABLE_INCOME' ? events.assessmentConfirmed : undefined,
  );
}

export function projectTt58TaxSettlements(
  input: ProjectTt58TaxSettlementsInput,
): Tt58TaxSettlementBundle {
  for (const position of input.taxOpeningPositions) {
    const parsed = TaxOpeningPositionSchema.safeParse(position);
    if (!parsed.success) throw new Error('Stored tax opening position is invalid');
  }

  if (!input.profile.taxProfileConfigured) return {};

  const needsVatSettlement =
    input.profile.vatMethod === 'DEDUCTION' ||
    (input.profile.vatMethod === 'PERCENT_ON_REVENUE' &&
      input.profile.incomeTaxMethod === 'TAXABLE_INCOME');
  const needsIncomeTaxSettlement =
    input.profile.incomeTaxMethod === 'TAXABLE_INCOME' ||
    (input.profile.incomeTaxMethod === 'PERCENT_ON_REVENUE' &&
      input.profile.vatMethod === 'DEDUCTION');

  return {
    vat: needsVatSettlement ? projectVatSettlement(input) : undefined,
    incomeTax: needsIncomeTaxSettlement ? projectIncomeTaxSettlement(input) : undefined,
  };
}

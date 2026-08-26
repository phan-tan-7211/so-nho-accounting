import { AccountingEffectKind } from './accountingEffects';
import { getRequiredTt58Books } from './accountingProfile';
import type { AccountingProfile, Tt58BookCode } from './accountingProfile';
import type {
  AccountingDimensionProjection,
  AccountingJournalEntry,
} from './accountingProjections';

export const Tt58SupplementaryBookCode = {
  S4A: 'S4a-DNSN',
  S4B: 'S4b-DNSN',
  S4C: 'S4c-DNSN',
  S4D: 'S4d-DNSN',
} as const;

export type Tt58SupplementaryBookCode =
  typeof Tt58SupplementaryBookCode[keyof typeof Tt58SupplementaryBookCode];
export type Tt58AnyBookCode = Tt58BookCode | Tt58SupplementaryBookCode;
export type Tt58BookProjectionStatus = 'PARTIAL' | 'PLANNED';

export interface Tt58BookCapability {
  code: Tt58AnyBookCode;
  name: string;
  required: boolean;
  supplementary: boolean;
  status: Tt58BookProjectionStatus;
  availableProjection?: string;
  blockers: readonly string[];
}

export interface Tt58RevenueExpenseActivityRow {
  transactionId: string;
  date: number;
  invoiceNumber?: string;
  description?: string;
  revenue: number;
  expense: number;
}

export interface Tt58VatActivityRow {
  transactionId: string;
  date: number;
  invoiceNumber?: string;
  description?: string;
  vatInput: number;
  vatOutput: number;
}

export interface Tt58MoneyActivityRow {
  transactionId: string;
  date: number;
  description?: string;
  accountId: string;
  amount: number;
}

export interface Tt58DebtActivityRow {
  transactionId: string;
  date: number;
  description?: string;
  partnerId: string;
  receivableChange: number;
  payableChange: number;
}

export interface Tt58EquityActivityRow {
  transactionId: string;
  date: number;
  description?: string;
  amount: number;
}

export interface Tt58CoreActivityBundle {
  revenueExpense: readonly Tt58RevenueExpenseActivityRow[];
  vat: readonly Tt58VatActivityRow[];
  money: readonly Tt58MoneyActivityRow[];
  debt: readonly Tt58DebtActivityRow[];
  equity: readonly Tt58EquityActivityRow[];
}

const BOOK_NAMES: Record<Tt58AnyBookCode, string> = {
  'S1-DNSN': 'Sổ doanh thu bán hàng hóa, dịch vụ',
  'S2a-DNSN': 'Sổ doanh thu bán hàng hóa, dịch vụ',
  'S2b-DNSN': 'Sổ chi tiết doanh thu, chi phí',
  'S2c-DNSN': 'Sổ chi tiết vật liệu, dụng cụ, sản phẩm, hàng hóa',
  'S2d-DNSN': 'Sổ chi tiết tiền',
  'S3a-DNSN': 'Sổ doanh thu bán hàng hóa, dịch vụ',
  'S3b-DNSN': 'Sổ theo dõi nghĩa vụ thuế GTGT',
  'S4a-DNSN': 'Sổ chi tiết thanh toán công nợ',
  'S4b-DNSN': 'Sổ tài sản cố định',
  'S4c-DNSN': 'Sổ theo dõi nghĩa vụ thuế khác',
  'S4d-DNSN': 'Sổ theo dõi vốn chủ sở hữu',
};

const CAPABILITY_BASE: Record<
  Tt58AnyBookCode,
  Omit<Tt58BookCapability, 'code' | 'name' | 'required' | 'supplementary'>
> = {
  'S1-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'semantic revenue activity',
    blockers: [
      'Thiếu nhóm hàng hóa/dịch vụ/ngành nghề và tỷ lệ thuế trên doanh thu',
      'Chưa có tax settlement domain để theo dõi số thuế đã nộp',
      'Không được dùng VAT invoice rate thay cho tỷ lệ thuế trên doanh thu',
    ],
  },
  'S2a-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'semantic revenue activity',
    blockers: [
      'Thiếu nhóm hàng hóa/dịch vụ/ngành nghề và tỷ lệ VAT trên doanh thu',
      'Chưa có số dư/nghiệp vụ nộp thuế GTGT để lập đầy đủ phần nghĩa vụ thuế',
    ],
  },
  'S2b-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'revenue and expense activity',
    blockers: [
      'Category hiện tại chưa phải taxonomy chi phí TT58',
      'Chưa có TNDN opening/payment/settlement domain',
    ],
  },
  'S2c-DNSN': {
    status: 'PLANNED',
    blockers: ['Cần inventory domain thực: item, unit, quantity, unit cost, inbound/outbound stock'],
  },
  'S2d-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'cash movement by account',
    blockers: [
      'Account chưa có semantic kind để phân biệt tiền mặt và tiền gửi không kỳ hạn',
      'Book-form opening/running balance rows chưa được materialize trong Phase 7',
    ],
  },
  'S3a-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'semantic revenue activity',
    blockers: [
      'Thiếu nhóm hàng hóa/dịch vụ/ngành nghề và tỷ lệ thuế thu nhập trên doanh thu',
      'Chưa có income-tax settlement domain',
    ],
  },
  'S3b-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'VAT input/output activity',
    blockers: [
      'Transaction chưa lưu explicit VAT deductible eligibility',
      'Chưa có opening VAT obligation, VAT payment và VAT refund domain',
    ],
  },
  'S4a-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'trade receivable/payable movements and semantic partner positions',
    blockers: [
      'V1 mới bao phủ công nợ phát sinh từ semantic customer/supplier transactions',
      'Chưa bao phủ vay, tạm ứng, ký quỹ, lương và các loại công nợ khác',
    ],
  },
  'S4b-DNSN': {
    status: 'PLANNED',
    blockers: ['Cần fixed-asset domain thực trước khi lập sổ tài sản cố định'],
  },
  'S4c-DNSN': {
    status: 'PLANNED',
    blockers: ['Cần other-tax obligation domain thực trước khi lập sổ nghĩa vụ thuế khác'],
  },
  'S4d-DNSN': {
    status: 'PARTIAL',
    availableProjection: 'semantic equity movements',
    blockers: [
      'V1 hiện có capital contribution nhưng chưa có đầy đủ retained earnings, distributions và equity funds',
    ],
  },
};

const ALL_BOOK_CODES = Object.keys(BOOK_NAMES) as Tt58AnyBookCode[];

export function getTt58BookCapabilities(
  profile: Pick<AccountingProfile, 'taxProfileConfigured' | 'vatMethod' | 'incomeTaxMethod'>,
): readonly Tt58BookCapability[] {
  const required = new Set(getRequiredTt58Books(profile));

  return ALL_BOOK_CODES.map((code) => ({
    code,
    name: BOOK_NAMES[code],
    required: required.has(code as Tt58BookCode),
    supplementary: code.startsWith('S4'),
    ...CAPABILITY_BASE[code],
  }));
}

function addSafe(current: number, amount: number, label: string): number {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) throw new Error(`${label} exceeds safe VND integer range`);
  return next;
}

function sumEffect(entry: AccountingJournalEntry, kind: AccountingEffectKind): number {
  let total = 0;
  for (const effect of entry.effects) {
    if (effect.kind === kind) total = addSafe(total, effect.amount, `${kind} row`);
  }
  return total;
}

export function projectTt58CoreActivities(
  projection: AccountingDimensionProjection,
): Tt58CoreActivityBundle {
  const revenueExpense: Tt58RevenueExpenseActivityRow[] = [];
  const vat: Tt58VatActivityRow[] = [];
  const money: Tt58MoneyActivityRow[] = [];
  const debt: Tt58DebtActivityRow[] = [];
  const equity: Tt58EquityActivityRow[] = [];

  for (const entry of projection.entries) {
    const revenue = sumEffect(entry, AccountingEffectKind.REVENUE);
    const expense = sumEffect(entry, AccountingEffectKind.EXPENSE);
    if (revenue !== 0 || expense !== 0) {
      revenueExpense.push({
        transactionId: entry.transactionId,
        date: entry.date,
        invoiceNumber: entry.invoiceNumber,
        description: entry.description,
        revenue,
        expense,
      });
    }

    const vatInput = sumEffect(entry, AccountingEffectKind.VAT_INPUT);
    const vatOutput = sumEffect(entry, AccountingEffectKind.VAT_OUTPUT);
    if (vatInput !== 0 || vatOutput !== 0) {
      vat.push({
        transactionId: entry.transactionId,
        date: entry.date,
        invoiceNumber: entry.invoiceNumber,
        description: entry.description,
        vatInput,
        vatOutput,
      });
    }

    const moneyByAccount = new Map<string, number>();
    const debtByPartner = new Map<string, { receivableChange: number; payableChange: number }>();
    let equityAmount = 0;

    for (const effect of entry.effects) {
      if (effect.kind === AccountingEffectKind.CASH) {
        if (!effect.accountId) throw new Error('Cash effect is missing accountId');
        moneyByAccount.set(
          effect.accountId,
          addSafe(moneyByAccount.get(effect.accountId) ?? 0, effect.amount, 'Cash activity row'),
        );
      } else if (
        effect.kind === AccountingEffectKind.RECEIVABLE ||
        effect.kind === AccountingEffectKind.PAYABLE
      ) {
        if (!effect.partnerId) throw new Error(`${effect.kind} effect is missing partnerId`);
        const current = debtByPartner.get(effect.partnerId) ?? {
          receivableChange: 0,
          payableChange: 0,
        };
        if (effect.kind === AccountingEffectKind.RECEIVABLE) {
          current.receivableChange = addSafe(
            current.receivableChange,
            effect.amount,
            'Receivable activity row',
          );
        } else {
          current.payableChange = addSafe(
            current.payableChange,
            effect.amount,
            'Payable activity row',
          );
        }
        debtByPartner.set(effect.partnerId, current);
      } else if (effect.kind === AccountingEffectKind.EQUITY) {
        equityAmount = addSafe(equityAmount, effect.amount, 'Equity activity row');
      }
    }

    for (const [accountId, amount] of [...moneyByAccount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (amount === 0) continue;
      money.push({
        transactionId: entry.transactionId,
        date: entry.date,
        description: entry.description,
        accountId,
        amount,
      });
    }

    for (const [partnerId, movement] of [...debtByPartner.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (movement.receivableChange === 0 && movement.payableChange === 0) continue;
      debt.push({
        transactionId: entry.transactionId,
        date: entry.date,
        description: entry.description,
        partnerId,
        ...movement,
      });
    }

    if (equityAmount !== 0) {
      equity.push({
        transactionId: entry.transactionId,
        date: entry.date,
        description: entry.description,
        amount: equityAmount,
      });
    }
  }

  return { revenueExpense, vat, money, debt, equity };
}

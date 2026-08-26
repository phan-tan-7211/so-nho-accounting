import type { AccountingProfile } from './accountingProfile';
import type { NewPostedTransactionInput } from './engine';
import {
  TaxType,
  TransactionType,
} from './models';
import type { TaxType as TaxTypeValue, TransactionType as TransactionTypeValue } from './models';

export interface UiPeriod {
  start: number;
  end: number;
  month: string;
}

export interface TransactionFormRequirements {
  sourceAccount: boolean;
  destinationAccount: boolean;
  partner: boolean;
  vatInvoice: boolean;
  revenueTaxMetadata: boolean;
  expenseMetadata: boolean;
  taxType: boolean;
  assessmentPeriod: boolean;
}

export interface TransactionFormDraft {
  type: TransactionTypeValue;
  date: string;
  amount: string;
  sourceAccountId: string;
  destinationAccountId: string;
  partnerId: string;
  description: string;
  documentNumber: string;
  invoiceNumber: string;
  amountBeforeVat: string;
  vatAmount: string;
  vatRate: string;
  taxActivityLabel: string;
  taxRevenueAmount: string;
  vatRevenueRate: string;
  incomeTaxRevenueRate: string;
  vatDeductible: '' | 'true' | 'false';
  tt58ExpenseCategory: string;
  taxType: '' | TaxTypeValue;
  taxPeriodMonth: string;
}

export const TRANSACTION_TYPE_LABELS: Readonly<Record<TransactionTypeValue, string>> = {
  CASH_SALE: 'Bán hàng thu tiền ngay',
  CREDIT_SALE: 'Bán hàng công nợ',
  CUSTOMER_PAYMENT: 'Thu tiền khách hàng',
  CASH_PURCHASE: 'Mua/chi trả ngay',
  CREDIT_PURCHASE: 'Mua hàng công nợ',
  SUPPLIER_PAYMENT: 'Trả tiền nhà cung cấp',
  TRANSFER: 'Chuyển tiền nội bộ',
  CAPITAL_CONTRIBUTION: 'Góp vốn',
  CUSTOMER_REFUND: 'Hoàn tiền khách hàng',
  SUPPLIER_REFUND: 'Nhà cung cấp hoàn tiền',
  TAX_PAYMENT: 'Nộp thuế',
  TAX_REFUND: 'Nhận hoàn VAT',
  TAX_ASSESSMENT: 'Xác nhận thuế TNDN phải nộp',
  REVERSAL: 'Bút toán đảo',
  INCOME: 'Legacy income',
  EXPENSE: 'Legacy expense',
  REFUND: 'Legacy refund',
  ADJUSTMENT: 'Legacy adjustment',
};

export const UI_TRANSACTION_TYPES: readonly TransactionTypeValue[] = [
  TransactionType.CASH_SALE,
  TransactionType.CREDIT_SALE,
  TransactionType.CUSTOMER_PAYMENT,
  TransactionType.CASH_PURCHASE,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.SUPPLIER_PAYMENT,
  TransactionType.TRANSFER,
  TransactionType.CAPITAL_CONTRIBUTION,
  TransactionType.CUSTOMER_REFUND,
  TransactionType.SUPPLIER_REFUND,
  TransactionType.TAX_PAYMENT,
  TransactionType.TAX_REFUND,
  TransactionType.TAX_ASSESSMENT,
];

const UI_TRANSACTION_TYPE_SET = new Set<TransactionTypeValue>(UI_TRANSACTION_TYPES);
const SOURCE_ACCOUNT_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CASH_PURCHASE,
  TransactionType.SUPPLIER_PAYMENT,
  TransactionType.TRANSFER,
  TransactionType.CUSTOMER_REFUND,
  TransactionType.TAX_PAYMENT,
]);
const DESTINATION_ACCOUNT_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CASH_SALE,
  TransactionType.CUSTOMER_PAYMENT,
  TransactionType.TRANSFER,
  TransactionType.CAPITAL_CONTRIBUTION,
  TransactionType.SUPPLIER_REFUND,
  TransactionType.TAX_REFUND,
]);
const PARTNER_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CREDIT_SALE,
  TransactionType.CUSTOMER_PAYMENT,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.SUPPLIER_PAYMENT,
]);
const VAT_INVOICE_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CASH_SALE,
  TransactionType.CREDIT_SALE,
  TransactionType.CASH_PURCHASE,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.CUSTOMER_REFUND,
  TransactionType.SUPPLIER_REFUND,
]);
const REVENUE_METADATA_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CASH_SALE,
  TransactionType.CREDIT_SALE,
  TransactionType.CUSTOMER_REFUND,
]);
const EXPENSE_METADATA_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CASH_PURCHASE,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.SUPPLIER_REFUND,
]);
const TAX_TYPE_INPUT_TYPES = new Set<TransactionTypeValue>([
  TransactionType.TAX_PAYMENT,
  TransactionType.TAX_REFUND,
]);

export function getTransactionFormRequirements(
  type: TransactionTypeValue,
): TransactionFormRequirements {
  return {
    sourceAccount: SOURCE_ACCOUNT_TYPES.has(type),
    destinationAccount: DESTINATION_ACCOUNT_TYPES.has(type),
    partner: PARTNER_TYPES.has(type),
    vatInvoice: VAT_INVOICE_TYPES.has(type),
    revenueTaxMetadata: REVENUE_METADATA_TYPES.has(type),
    expenseMetadata: EXPENSE_METADATA_TYPES.has(type),
    taxType: TAX_TYPE_INPUT_TYPES.has(type),
    assessmentPeriod: type === TransactionType.TAX_ASSESSMENT,
  };
}

function requiredVnd(value: string, label: string, allowZero = false): number {
  const normalized = value.replace(/[.,\s₫]/g, '');
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} phải là số nguyên VND.`);
  const parsed = Number(normalized);
  const valid = Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) throw new Error(`${label} không hợp lệ.`);
  return parsed;
}

function optionalVnd(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined;
  return requiredVnd(value, label, true);
}

function optionalRate(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    throw new Error(`${label} phải là số từ 0–100%; có thể dùng dấu phẩy hoặc dấu chấm cho phần thập phân.`);
  }
  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${label} phải nằm trong khoảng 0–100%.`);
  }
  return parsed;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function dateInputToTimestamp(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Ngày giao dịch chưa hợp lệ.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error('Ngày giao dịch không tồn tại trên lịch.');
  }
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Ngày giao dịch chưa hợp lệ.');
  return timestamp;
}

export function timestampToDateInput(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentDateInput(now = Date.now()): string {
  return timestampToDateInput(now);
}

export function monthInputToPeriod(month: string): UiPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('Kỳ báo cáo phải có dạng YYYY-MM.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error('Kỳ báo cáo không hợp lệ.');
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0).getTime() - 1;
  return { start, end, month };
}

export function currentMonthInput(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function selectedTaxType(draft: TransactionFormDraft): TaxTypeValue | undefined {
  if (draft.type === TransactionType.TAX_ASSESSMENT) return TaxType.INCOME_TAX;
  if (draft.type === TransactionType.TAX_REFUND) return TaxType.VAT;
  return draft.taxType || undefined;
}

export function createPostedTransactionInput(
  draft: TransactionFormDraft,
  profile: AccountingProfile | null,
): NewPostedTransactionInput {
  if (!UI_TRANSACTION_TYPE_SET.has(draft.type)) throw new Error('Loại giao dịch không được hỗ trợ trong V1.');
  const requirements = getTransactionFormRequirements(draft.type);
  const amount = requiredVnd(
    draft.amount,
    'Số tiền',
    draft.type === TransactionType.TAX_ASSESSMENT,
  );

  if (requirements.sourceAccount && !draft.sourceAccountId) throw new Error('Hãy chọn tài khoản chi/nguồn.');
  if (requirements.destinationAccount && !draft.destinationAccountId) throw new Error('Hãy chọn tài khoản thu/đích.');
  if (requirements.partner && !draft.partnerId.trim()) throw new Error('Hãy chọn khách hàng / nhà cung cấp phù hợp cho giao dịch công nợ.');

  const input: NewPostedTransactionInput = {
    date: dateInputToTimestamp(draft.date),
    amount,
    type: draft.type,
    status: 'POSTED',
  };

  const description = optionalText(draft.description);
  const documentNumber = optionalText(draft.documentNumber);
  const invoiceNumber = optionalText(draft.invoiceNumber);
  if (description) input.description = description;
  if (documentNumber) input.documentNumber = documentNumber;
  if (invoiceNumber) input.invoiceNumber = invoiceNumber;
  if (draft.sourceAccountId) input.sourceAccountId = draft.sourceAccountId;
  if (draft.destinationAccountId) input.destinationAccountId = draft.destinationAccountId;
  if (draft.partnerId.trim()) input.partnerId = draft.partnerId.trim();

  if (requirements.vatInvoice) {
    const amountBeforeVat = optionalVnd(draft.amountBeforeVat, 'Giá trị trước VAT');
    const vatAmount = optionalVnd(draft.vatAmount, 'Tiền VAT');
    const vatRate = optionalRate(draft.vatRate, 'Thuế suất VAT hóa đơn');
    if (amountBeforeVat !== undefined) input.amountBeforeVat = amountBeforeVat;
    if (vatAmount !== undefined) input.vatAmount = vatAmount;
    if (vatRate !== undefined) input.vatRate = vatRate;
  }

  if (requirements.revenueTaxMetadata) {
    const taxActivityLabel = optionalText(draft.taxActivityLabel);
    const taxRevenueAmount = optionalVnd(draft.taxRevenueAmount, 'Doanh thu tính thuế');
    const vatRevenueRate = optionalRate(draft.vatRevenueRate, 'Tỷ lệ VAT trên doanh thu');
    const incomeTaxRevenueRate = optionalRate(draft.incomeTaxRevenueRate, 'Tỷ lệ thuế thu nhập trên doanh thu');
    if (taxActivityLabel) input.taxActivityLabel = taxActivityLabel;
    if (taxRevenueAmount !== undefined) input.taxRevenueAmount = taxRevenueAmount;
    if (vatRevenueRate !== undefined) input.vatRevenueRate = vatRevenueRate;
    if (incomeTaxRevenueRate !== undefined) input.incomeTaxRevenueRate = incomeTaxRevenueRate;
  }

  if (requirements.expenseMetadata) {
    if (draft.vatDeductible) input.vatDeductible = draft.vatDeductible === 'true';
    if (draft.tt58ExpenseCategory) {
      input.tt58ExpenseCategory = draft.tt58ExpenseCategory as NonNullable<NewPostedTransactionInput['tt58ExpenseCategory']>;
    }
  }

  const taxType = selectedTaxType(draft);
  if (requirements.taxType || requirements.assessmentPeriod) {
    if (!taxType) throw new Error('Hãy chọn loại thuế.');
    input.taxType = taxType;
  }

  if (requirements.assessmentPeriod) {
    const period = monthInputToPeriod(draft.taxPeriodMonth);
    input.taxPeriodStart = period.start;
    input.taxPeriodEnd = period.end;
  }

  if (
    profile?.taxProfileConfigured &&
    profile.vatMethod === 'DEDUCTION' &&
    requirements.expenseMetadata &&
    optionalVnd(draft.vatAmount, 'Tiền VAT') !== undefined &&
    draft.vatDeductible === ''
  ) {
    throw new Error('Hãy xác nhận VAT đầu vào có được khấu trừ hay không.');
  }

  return input;
}

export function createEmptyTransactionDraft(now = Date.now()): TransactionFormDraft {
  return {
    type: TransactionType.CASH_SALE,
    date: currentDateInput(now),
    amount: '',
    sourceAccountId: '',
    destinationAccountId: '',
    partnerId: '',
    description: '',
    documentNumber: '',
    invoiceNumber: '',
    amountBeforeVat: '',
    vatAmount: '',
    vatRate: '',
    taxActivityLabel: '',
    taxRevenueAmount: '',
    vatRevenueRate: '',
    incomeTaxRevenueRate: '',
    vatDeductible: '',
    tt58ExpenseCategory: '',
    taxType: '',
    taxPeriodMonth: currentMonthInput(now),
  };
}

export function formatVnd(value: number): string {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} ₫`;
}
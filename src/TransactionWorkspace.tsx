import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AccountingProfileSchema } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import { db } from './db';
import { AccountingEngine } from './engine';
import {
  TaxType,
  TransactionType,
  Tt58ExpenseCategory,
} from './models';
import type { Account, Transaction, TransactionType as TransactionTypeValue } from './models';
import { partnerSupportsTransaction } from './partners';
import type { Partner } from './partners';
import {
  TRANSACTION_TYPE_LABELS,
  UI_TRANSACTION_TYPES,
  createEmptyTransactionDraft,
  createPostedTransactionInput,
  formatVnd,
  getTransactionFormRequirements,
} from './uiAccounting';
import type { TransactionFormDraft } from './uiAccounting';

const EXPENSE_LABELS: Readonly<Record<string, string>> = {
  [Tt58ExpenseCategory.MATERIALS_GOODS_ENERGY]: 'Vật liệu, hàng hóa, năng lượng',
  [Tt58ExpenseCategory.LABOR]: 'Chi phí nhân công',
  [Tt58ExpenseCategory.DEPRECIATION]: 'Khấu hao TSCĐ',
  [Tt58ExpenseCategory.OUTSIDE_SERVICES]: 'Dịch vụ mua ngoài',
  [Tt58ExpenseCategory.INTEREST]: 'Chi phí lãi vay',
  [Tt58ExpenseCategory.OTHER_DIRECT_BUSINESS]: 'Chi phí kinh doanh trực tiếp khác',
};

const POSITIVE_TYPES = new Set<Transaction['type']>([
  TransactionType.CASH_SALE,
  TransactionType.CUSTOMER_PAYMENT,
  TransactionType.SUPPLIER_REFUND,
  TransactionType.CAPITAL_CONTRIBUTION,
  TransactionType.TAX_REFUND,
]);
const NEGATIVE_TYPES = new Set<Transaction['type']>([
  TransactionType.CASH_PURCHASE,
  TransactionType.SUPPLIER_PAYMENT,
  TransactionType.CUSTOMER_REFUND,
  TransactionType.TAX_PAYMENT,
]);
const LEGACY_TYPES = new Set<Transaction['type']>([
  TransactionType.INCOME,
  TransactionType.EXPENSE,
  TransactionType.REFUND,
  TransactionType.ADJUSTMENT,
]);

function transactionTone(tx: Transaction): 'positive' | 'negative' | 'neutral' {
  if (POSITIVE_TYPES.has(tx.type)) return 'positive';
  if (NEGATIVE_TYPES.has(tx.type)) return 'negative';
  return 'neutral';
}

function signedAmount(tx: Transaction): string {
  const tone = transactionTone(tx);
  const prefix = tone === 'positive' ? '+' : tone === 'negative' ? '-' : '';
  return `${prefix}${formatVnd(tx.amount)}`;
}

export function TransactionWorkspace({
  requestedType,
  requestToken,
}: {
  requestedType?: TransactionTypeValue;
  requestToken?: number;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [profile, setProfile] = useState<AccountingProfile | null>(null);
  const [draft, setDraft] = useState<TransactionFormDraft>(() => createEmptyTransactionDraft());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [storedAccounts, storedPartners, storedTransactions, rawProfile] = await Promise.all([
      db.accounts.orderBy('name').toArray(),
      db.partners.orderBy('code').toArray(),
      db.transactions.orderBy('date').reverse().toArray(),
      db.accountingProfiles.get('primary'),
    ]);
    setAccounts(storedAccounts);
    setPartners(storedPartners);
    setTransactions(storedTransactions);
    const parsed = rawProfile ? AccountingProfileSchema.safeParse(rawProfile) : null;
    setProfile(parsed?.success ? parsed.data : null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch(() => setError('Không thể đọc dữ liệu giao dịch.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  useEffect(() => {
    if (!requestedType || requestToken === undefined) return;
    const timer = window.setTimeout(() => {
      setDraft({ ...createEmptyTransactionDraft(), type: requestedType });
      setShowForm(true);
      setError(null);
      setMessage(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [requestToken, requestedType]);

  const requirements = useMemo(() => getTransactionFormRequirements(draft.type), [draft.type]);
  const partnerOptions = useMemo(
    () => partners.filter((partner) => partner.active && partnerSupportsTransaction(partner, draft.type)),
    [draft.type, partners],
  );

  function patch(values: Partial<TransactionFormDraft>) {
    setDraft((current) => ({ ...current, ...values }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const input = createPostedTransactionInput(draft, profile);
      await AccountingEngine.processTransaction(input);
      setDraft(createEmptyTransactionDraft());
      setShowForm(false);
      setMessage('Đã ghi giao dịch và cập nhật projection kế toán.');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể ghi giao dịch.');
    } finally {
      setSaving(false);
    }
  }

  async function reverse(tx: Transaction) {
    if (!window.confirm(`Đảo giao dịch “${TRANSACTION_TYPE_LABELS[tx.type]}” ${formatVnd(tx.amount)}?`)) return;
    setError(null);
    setMessage(null);
    try {
      await AccountingEngine.reverseTransaction(tx.id);
      setMessage('Đã tạo bút toán đảo. Giao dịch gốc không bị xóa.');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể đảo giao dịch.');
    }
  }

  return (
    <section className="workspace-stack" aria-labelledby="transactions-workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Nguồn dữ liệu kế toán</p>
          <h2 id="transactions-workspace-title">Giao dịch semantic</h2>
          <p>Mỗi giao dịch POSTED sinh Accounting Effects; giao dịch đã ghi chỉ sửa bằng reversal.</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => setShowForm((value) => !value)}>
          {showForm ? 'Đóng form' : 'Thêm giao dịch'}
        </button>
      </div>

      {!profile?.taxProfileConfigured ? (
        <p className="form-alert warning">Hồ sơ thuế TT58 chưa cấu hình đầy đủ. Giao dịch tiền vẫn có thể ghi, nhưng sổ thuế sẽ giữ trạng thái chưa sẵn sàng.</p>
      ) : null}

      {showForm ? (
        <form className="workspace-card transaction-form" onSubmit={submit}>
          <div className="form-grid two-columns">
            <label>
              <span>Loại giao dịch</span>
              <select value={draft.type} onChange={(event) => patch({ type: event.target.value as TransactionTypeValue, partnerId: '' })}>
                {UI_TRANSACTION_TYPES.map((type) => <option key={type} value={type}>{TRANSACTION_TYPE_LABELS[type]}</option>)}
              </select>
            </label>
            <label>
              <span>Ngày</span>
              <input type="date" value={draft.date} onChange={(event) => patch({ date: event.target.value })} />
            </label>
          </div>

          <label>
            <span>Số tiền (VND)</span>
            <input inputMode="numeric" value={draft.amount} onChange={(event) => patch({ amount: event.target.value })} placeholder={draft.type === TransactionType.TAX_ASSESSMENT ? 'Có thể bằng 0' : 'VD: 1100000'} />
          </label>

          <div className="form-grid two-columns">
            {requirements.sourceAccount ? (
              <label>
                <span>Tài khoản nguồn/chi</span>
                <select value={draft.sourceAccountId} onChange={(event) => patch({ sourceAccountId: event.target.value })}>
                  <option value="">Chọn tài khoản</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            ) : null}
            {requirements.destinationAccount ? (
              <label>
                <span>Tài khoản đích/thu</span>
                <select value={draft.destinationAccountId} onChange={(event) => patch({ destinationAccountId: event.target.value })}>
                  <option value="">Chọn tài khoản</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>

          {requirements.partner ? (
            <label>
              <span>Khách hàng / nhà cung cấp</span>
              <select value={draft.partnerId} onChange={(event) => patch({ partnerId: event.target.value })}>
                <option value="">Chọn partner</option>
                {partnerOptions.map((partner) => <option key={partner.id} value={partner.id}>{partner.code} · {partner.name}</option>)}
              </select>
              <small>{partnerOptions.length === 0 ? 'Chưa có partner phù hợp. Hãy tạo trong Cài đặt.' : 'Engine kiểm tra lại partner tồn tại, active và đúng vai trò khi POST.'}</small>
            </label>
          ) : null}

          {requirements.vatInvoice ? (
            <fieldset className="inline-fieldset">
              <legend>Thông tin VAT trên hóa đơn</legend>
              <div className="form-grid three-columns">
                <label><span>Trước VAT</span><input inputMode="numeric" value={draft.amountBeforeVat} onChange={(event) => patch({ amountBeforeVat: event.target.value })} /></label>
                <label><span>Tiền VAT</span><input inputMode="numeric" value={draft.vatAmount} onChange={(event) => patch({ vatAmount: event.target.value })} /></label>
                <label><span>Thuế suất %</span><input inputMode="decimal" value={draft.vatRate} onChange={(event) => patch({ vatRate: event.target.value })} /></label>
              </div>
            </fieldset>
          ) : null}

          {requirements.revenueTaxMetadata ? (
            <fieldset className="inline-fieldset">
              <legend>Metadata sổ doanh thu TT58</legend>
              <label><span>Nhóm/ngành hoạt động</span><input value={draft.taxActivityLabel} onChange={(event) => patch({ taxActivityLabel: event.target.value })} /></label>
              <div className="form-grid three-columns">
                <label><span>Doanh thu tính thuế</span><input inputMode="numeric" value={draft.taxRevenueAmount} onChange={(event) => patch({ taxRevenueAmount: event.target.value })} /></label>
                <label><span>Tỷ lệ VAT % DT</span><input inputMode="decimal" value={draft.vatRevenueRate} onChange={(event) => patch({ vatRevenueRate: event.target.value })} /></label>
                <label><span>Tỷ lệ thuế thu nhập % DT</span><input inputMode="decimal" value={draft.incomeTaxRevenueRate} onChange={(event) => patch({ incomeTaxRevenueRate: event.target.value })} /></label>
              </div>
              <small>Doanh thu tính thuế được nhập riêng; app không lấy gross/net hóa đơn để tự suy ra.</small>
            </fieldset>
          ) : null}

          {requirements.expenseMetadata ? (
            <fieldset className="inline-fieldset">
              <legend>Phân loại chi phí TT58</legend>
              <label>
                <span>Nhóm chi phí S2b</span>
                <select value={draft.tt58ExpenseCategory} onChange={(event) => patch({ tt58ExpenseCategory: event.target.value })}>
                  <option value="">Chưa chọn</option>
                  {Object.values(Tt58ExpenseCategory).map((category) => <option key={category} value={category}>{EXPENSE_LABELS[category]}</option>)}
                </select>
              </label>
              <label>
                <span>VAT đầu vào được khấu trừ?</span>
                <select value={draft.vatDeductible} onChange={(event) => patch({ vatDeductible: event.target.value as TransactionFormDraft['vatDeductible'] })}>
                  <option value="">Chưa xác nhận</option>
                  <option value="true">Có</option>
                  <option value="false">Không</option>
                </select>
              </label>
            </fieldset>
          ) : null}

          {requirements.taxType ? (
            <label>
              <span>Loại thuế</span>
              <select value={draft.type === TransactionType.TAX_REFUND ? TaxType.VAT : draft.taxType} disabled={draft.type === TransactionType.TAX_REFUND} onChange={(event) => patch({ taxType: event.target.value as TransactionFormDraft['taxType'] })}>
                <option value="">Chọn loại thuế</option>
                <option value={TaxType.VAT}>VAT</option>
                <option value={TaxType.INCOME_TAX}>Thuế thu nhập</option>
              </select>
            </label>
          ) : null}

          {requirements.assessmentPeriod ? (
            <label>
              <span>Kỳ TNDN được xác nhận</span>
              <input type="month" value={draft.taxPeriodMonth} onChange={(event) => patch({ taxPeriodMonth: event.target.value })} />
              <small>Assessment phải trùng chính xác kỳ báo cáo để S2b được COMPLETE.</small>
            </label>
          ) : null}

          <div className="form-grid two-columns">
            <label><span>Số chứng từ</span><input value={draft.documentNumber} onChange={(event) => patch({ documentNumber: event.target.value })} /></label>
            <label><span>Số hóa đơn</span><input value={draft.invoiceNumber} onChange={(event) => patch({ invoiceNumber: event.target.value })} /></label>
          </div>
          <label><span>Diễn giải</span><input value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></label>

          {error ? <p className="form-alert error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={saving} type="submit">{saving ? 'Đang ghi…' : 'Ghi giao dịch POSTED'}</button>
        </form>
      ) : error ? <p className="form-alert error" role="alert">{error}</p> : null}

      {message ? <p className="form-alert success" role="status">{message}</p> : null}

      <div className="workspace-card">
        <div className="section-heading"><h2>Lịch sử</h2><span className="muted-count">{transactions.length} giao dịch</span></div>
        {transactions.length === 0 ? <p className="empty-copy">Chưa có giao dịch.</p> : (
          <div className="transaction-list">
            {transactions.map((tx) => {
              const tone = transactionTone(tx);
              const legacy = LEGACY_TYPES.has(tx.type);
              return (
                <div className="transaction-row transaction-row--static" key={tx.id}>
                  <span className={`transaction-marker ${tone}`} aria-hidden="true"></span>
                  <span className="transaction-copy">
                    <strong>{TRANSACTION_TYPE_LABELS[tx.type]}</strong>
                    <small>{new Date(tx.date).toLocaleDateString('vi-VN')} · {tx.documentNumber ?? tx.invoiceNumber ?? tx.id.slice(0, 8)} · {tx.status}</small>
                  </span>
                  <span className={`transaction-amount ${tone}`}>{signedAmount(tx)}</span>
                  {tx.status === 'POSTED' && tx.type !== TransactionType.REVERSAL && !legacy ? (
                    <button className="text-danger-button" type="button" onClick={() => void reverse(tx)}>Đảo</button>
                  ) : <span></span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

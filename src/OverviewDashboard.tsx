import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountingProjectionService } from './accountingProjectionService';
import { db } from './db';
import { AccountingEngine } from './engine';
import { AccountKind, TransactionType } from './models';
import type { Account, Transaction, TransactionType as TransactionTypeValue } from './models';
import {
  TRANSACTION_TYPE_LABELS,
  currentMonthInput,
  formatVnd,
  monthInputToPeriod,
} from './uiAccounting';

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

function tone(tx: Transaction): 'positive' | 'negative' | 'neutral' {
  if (POSITIVE_TYPES.has(tx.type)) return 'positive';
  if (NEGATIVE_TYPES.has(tx.type)) return 'negative';
  return 'neutral';
}

export function OverviewDashboard({
  onQuickTransaction,
  onOpenTransactions,
}: {
  onQuickTransaction: (type: TransactionTypeValue) => void;
  onOpenTransactions: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<ReadonlyMap<string, number>>(new Map());
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [expense, setExpense] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const storedAccounts = await db.accounts.orderBy('name').toArray();
      setAccounts(storedAccounts);

      // Do not create the global cutover marker on a pristine install. This keeps
      // the first-account workflow able to capture an explicit legacy opening balance.
      if (storedAccounts.length === 0) {
        setBalances(new Map());
        setRecent([]);
        setRevenue(0);
        setExpense(0);
        setError(null);
        return;
      }

      const month = monthInputToPeriod(currentMonthInput());
      const [derivedBalances, storedTransactions, projection] = await Promise.all([
        AccountingEngine.getBalances(),
        db.transactions.orderBy('date').reverse().limit(5).toArray(),
        accountingProjectionService.project({ start: month.start, end: month.end }),
      ]);
      setBalances(derivedBalances);
      setRecent(storedTransactions);
      setRevenue(projection.totals.revenue);
      setExpense(projection.totals.expense);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể đọc dữ liệu tổng quan.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let cash = 0;
    let bank = 0;
    for (const account of accounts) {
      const balance = balances.get(account.id) ?? 0;
      if (account.kind === AccountKind.DEMAND_DEPOSIT) bank += balance;
      else cash += balance;
    }
    return { cash, bank, total: cash + bank };
  }, [accounts, balances]);

  return (
    <>
      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      <section className="balance-card" aria-labelledby="balance-title">
        <div className="balance-card__topline">
          <p id="balance-title">Tổng tiền hiện có</p>
          <span className="status-pill">Derived</span>
        </div>
        <p className="balance-amount">{formatVnd(totals.total)}</p>
        <div className="balance-breakdown">
          <div><span>Tiền mặt</span><strong>{formatVnd(totals.cash)}</strong></div>
          <div><span>Ngân hàng</span><strong>{formatVnd(totals.bank)}</strong></div>
        </div>
      </section>

      <section className="summary-grid" aria-label="Tóm tắt tháng">
        <article className="summary-card">
          <div><span>Doanh thu tháng</span><strong>{formatVnd(revenue)}</strong><small>Từ REVENUE effects, không phải dòng tiền thu</small></div>
        </article>
        <article className="summary-card">
          <div><span>Chi phí tháng</span><strong>{formatVnd(expense)}</strong><small>Từ EXPENSE effects, không phải dòng tiền chi</small></div>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading"><h2>Thao tác nhanh</h2></div>
        <div className="quick-actions">
          <button type="button" className="quick-action" onClick={() => onQuickTransaction(TransactionType.CASH_SALE)}><span className="quick-action__icon positive">＋</span><span>Bán thu tiền</span></button>
          <button type="button" className="quick-action" onClick={() => onQuickTransaction(TransactionType.CASH_PURCHASE)}><span className="quick-action__icon negative">−</span><span>Mua/chi</span></button>
          <button type="button" className="quick-action" onClick={() => onQuickTransaction(TransactionType.TRANSFER)}><span className="quick-action__icon primary">↔</span><span>Chuyển tiền</span></button>
        </div>
      </section>

      <section className="section-block recent-section">
        <div className="section-heading"><h2>Giao dịch gần đây</h2><button type="button" onClick={onOpenTransactions}>Xem tất cả</button></div>
        {recent.length === 0 ? <div className="workspace-card"><p className="empty-copy">Chưa có giao dịch. Hãy tạo tài khoản trong Cài đặt rồi ghi giao dịch đầu tiên.</p></div> : (
          <div className="transaction-list">
            {recent.map((tx) => {
              const txTone = tone(tx);
              return (
                <button className="transaction-row" type="button" key={tx.id} onClick={onOpenTransactions}>
                  <span className={`transaction-marker ${txTone}`} aria-hidden="true"></span>
                  <span className="transaction-copy"><strong>{TRANSACTION_TYPE_LABELS[tx.type]}</strong><small>{new Date(tx.date).toLocaleDateString('vi-VN')} · {tx.status}</small></span>
                  <span className={`transaction-amount ${txTone}`}>{formatVnd(tx.amount)}</span>
                  <span aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

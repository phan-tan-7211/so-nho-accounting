import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { TransactionType } from './models';
import type { TransactionType as TransactionTypeValue } from './models';
import { PwaStatus } from './PwaStatus';
import './App.css';
import './Workspace.css';

const AccountingSettings = lazy(() => import('./AccountingSettings').then((module) => ({ default: module.AccountingSettings })));
const BooksWorkspace = lazy(() => import('./BooksWorkspace').then((module) => ({ default: module.BooksWorkspace })));
const OverviewDashboard = lazy(() => import('./OverviewDashboard').then((module) => ({ default: module.OverviewDashboard })));
const TransactionWorkspace = lazy(() => import('./TransactionWorkspace').then((module) => ({ default: module.TransactionWorkspace })));

type NavKey = 'overview' | 'transactions' | 'books' | 'settings';

type IconName = 'home' | 'transactions' | 'plus' | 'books' | 'settings' | 'income' | 'expense' | 'transfer' | 'chevron';

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></>,
    transactions: <><path d="M7 7h11"/><path d="m15 4 3 3-3 3"/><path d="M17 17H6"/><path d="m9 14-3 3 3 3"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    books: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M8 4v16"/><path d="M11 8h5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.34.7.64.96.3.27.68.42 1.08.44H21v4h-.1a1.7 1.7 0 0 0-1.5.6Z"/></>,
    income: <><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></>,
    expense: <><path d="M12 21V8"/><path d="m7 13 5-5 5 5"/><path d="M5 3h14"/></>,
    transfer: <><path d="M4 8h13"/><path d="m14 5 3 3-3 3"/><path d="M20 16H7"/><path d="m10 13-3 3 3 3"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function WorkspaceFallback() {
  return (
    <section className="workspace-card" role="status" aria-live="polite">
      <p className="empty-copy">Đang mở dữ liệu…</p>
    </section>
  );
}

function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('overview');
  const [quickOpen, setQuickOpen] = useState(false);
  const [requestedType, setRequestedType] = useState<TransactionTypeValue | undefined>();
  const [requestToken, setRequestToken] = useState(0);
  const firstQuickActionRef = useRef<HTMLButtonElement | null>(null);

  const title = useMemo(() => ({
    overview: 'Tổng quan',
    transactions: 'Giao dịch',
    books: 'Sổ sách',
    settings: 'Cài đặt',
  }[activeNav]), [activeNav]);

  useEffect(() => {
    if (!quickOpen) return;
    const focusTimer = window.setTimeout(() => firstQuickActionRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuickOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [quickOpen]);

  function openTransaction(type: TransactionTypeValue) {
    setRequestedType(type);
    setRequestToken((value) => value + 1);
    setActiveNav('transactions');
    setQuickOpen(false);
  }

  return (
    <div className="app-shell">
      <PwaStatus />
      <header className="topbar">
        <div>
          <p className="eyebrow">Sổ nhỏ · TT58</p>
          <h1>{title}</h1>
        </div>
        {activeNav === 'overview' ? <span className="period-chip">Tháng này</span> : null}
      </header>

      <main className="main-content" id="main-content">
        <Suspense fallback={<WorkspaceFallback />}>
          {activeNav === 'overview' ? (
            <OverviewDashboard
              onQuickTransaction={openTransaction}
              onOpenTransactions={() => setActiveNav('transactions')}
            />
          ) : activeNav === 'transactions' ? (
            <TransactionWorkspace requestedType={requestedType} requestToken={requestToken} />
          ) : activeNav === 'books' ? (
            <BooksWorkspace />
          ) : (
            <AccountingSettings />
          )}
        </Suspense>
      </main>

      {quickOpen ? (
        <div id="quick-transaction-sheet" className="quick-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-sheet-title">
          <button className="quick-sheet__scrim" type="button" aria-label="Đóng menu thao tác" onClick={() => setQuickOpen(false)}></button>
          <div className="quick-sheet__panel">
            <div className="quick-sheet__handle" aria-hidden="true"></div>
            <h2 id="quick-sheet-title">Thêm giao dịch</h2>
            <div className="quick-sheet__actions">
              <button ref={firstQuickActionRef} type="button" onClick={() => openTransaction(TransactionType.CASH_SALE)}><span className="quick-action__icon positive"><Icon name="income" /></span><span><strong>Bán thu tiền</strong><small>CASH_SALE</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.CASH_PURCHASE)}><span className="quick-action__icon negative"><Icon name="expense" /></span><span><strong>Mua / chi</strong><small>CASH_PURCHASE</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.TRANSFER)}><span className="quick-action__icon primary"><Icon name="transfer" /></span><span><strong>Chuyển tiền</strong><small>Giữa các tài khoản</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.TAX_PAYMENT)}><span className="quick-action__icon negative"><Icon name="expense" /></span><span><strong>Nộp thuế</strong><small>VAT / thuế thu nhập</small></span><Icon name="chevron" size={18}/></button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        <button type="button" className={activeNav === 'overview' ? 'active' : ''} aria-current={activeNav === 'overview' ? 'page' : undefined} onClick={() => setActiveNav('overview')}><Icon name="home"/><span>Tổng quan</span></button>
        <button type="button" className={activeNav === 'transactions' ? 'active' : ''} aria-current={activeNav === 'transactions' ? 'page' : undefined} onClick={() => setActiveNav('transactions')}><Icon name="transactions"/><span>Giao dịch</span></button>
        <button type="button" className="fab" aria-label="Thêm giao dịch" aria-expanded={quickOpen} aria-controls="quick-transaction-sheet" onClick={() => setQuickOpen(true)}><Icon name="plus" size={28}/></button>
        <button type="button" className={activeNav === 'books' ? 'active' : ''} aria-current={activeNav === 'books' ? 'page' : undefined} onClick={() => setActiveNav('books')}><Icon name="books"/><span>Sổ sách</span></button>
        <button type="button" className={activeNav === 'settings' ? 'active' : ''} aria-current={activeNav === 'settings' ? 'page' : undefined} onClick={() => setActiveNav('settings')}><Icon name="settings"/><span>Cài đặt</span></button>
      </nav>
    </div>
  );
}

export default App;
import { useMemo, useState } from 'react';
import { AccountingSettings } from './AccountingSettings';
import { BooksWorkspace } from './BooksWorkspace';
import { OverviewDashboard } from './OverviewDashboard';
import { TransactionWorkspace } from './TransactionWorkspace';
import { TransactionType } from './models';
import type { TransactionType as TransactionTypeValue } from './models';
import './App.css';

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

function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('overview');
  const [quickOpen, setQuickOpen] = useState(false);
  const [requestedType, setRequestedType] = useState<TransactionTypeValue | undefined>();
  const [requestToken, setRequestToken] = useState(0);

  const title = useMemo(() => ({
    overview: 'Tổng quan',
    transactions: 'Giao dịch',
    books: 'Sổ sách',
    settings: 'Cài đặt',
  }[activeNav]), [activeNav]);

  function openTransaction(type: TransactionTypeValue) {
    setRequestedType(type);
    setRequestToken((value) => value + 1);
    setActiveNav('transactions');
    setQuickOpen(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sổ nhỏ · TT58</p>
          <h1>{title}</h1>
        </div>
        {activeNav === 'overview' ? <span className="period-chip">Tháng này</span> : null}
      </header>

      <main className="main-content" id="main-content">
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
      </main>

      {quickOpen ? (
        <div className="quick-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-sheet-title">
          <button className="quick-sheet__scrim" type="button" aria-label="Đóng menu thao tác" onClick={() => setQuickOpen(false)}></button>
          <div className="quick-sheet__panel">
            <div className="quick-sheet__handle" aria-hidden="true"></div>
            <h2 id="quick-sheet-title">Thêm giao dịch</h2>
            <div className="quick-sheet__actions">
              <button type="button" onClick={() => openTransaction(TransactionType.CASH_SALE)}><span className="quick-action__icon positive"><Icon name="income" /></span><span><strong>Bán thu tiền</strong><small>CASH_SALE</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.CASH_PURCHASE)}><span className="quick-action__icon negative"><Icon name="expense" /></span><span><strong>Mua / chi</strong><small>CASH_PURCHASE</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.TRANSFER)}><span className="quick-action__icon primary"><Icon name="transfer" /></span><span><strong>Chuyển tiền</strong><small>Giữa các tài khoản</small></span><Icon name="chevron" size={18}/></button>
              <button type="button" onClick={() => openTransaction(TransactionType.TAX_PAYMENT)}><span className="quick-action__icon negative"><Icon name="expense" /></span><span><strong>Nộp thuế</strong><small>VAT / thuế thu nhập</small></span><Icon name="chevron" size={18}/></button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        <button type="button" className={activeNav === 'overview' ? 'active' : ''} onClick={() => setActiveNav('overview')}><Icon name="home"/><span>Tổng quan</span></button>
        <button type="button" className={activeNav === 'transactions' ? 'active' : ''} onClick={() => setActiveNav('transactions')}><Icon name="transactions"/><span>Giao dịch</span></button>
        <button type="button" className="fab" aria-label="Thêm giao dịch" onClick={() => setQuickOpen(true)}><Icon name="plus" size={28}/></button>
        <button type="button" className={activeNav === 'books' ? 'active' : ''} onClick={() => setActiveNav('books')}><Icon name="books"/><span>Sổ sách</span></button>
        <button type="button" className={activeNav === 'settings' ? 'active' : ''} onClick={() => setActiveNav('settings')}><Icon name="settings"/><span>Cài đặt</span></button>
      </nav>
    </div>
  );
}

export default App;

import { useMemo, useState } from 'react'
import { AccountingSettings } from './AccountingSettings'
import './App.css'

type NavKey = 'overview' | 'transactions' | 'books' | 'settings'

type IconName = 'home' | 'transactions' | 'plus' | 'books' | 'settings' | 'income' | 'expense' | 'transfer' | 'chevron'

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
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

const transactions = [
  { title: 'Thu bán hàng', meta: 'Tiền mặt · Hôm nay', amount: '+2.450.000 ₫', tone: 'positive' },
  { title: 'Chi mua vật tư', meta: 'Ngân hàng · Hôm qua', amount: '-780.000 ₫', tone: 'negative' },
  { title: 'Chuyển tiền', meta: 'Tiền mặt → Ngân hàng', amount: '1.500.000 ₫', tone: 'neutral' },
]

function App() {
  const [activeNav, setActiveNav] = useState<NavKey>('overview')
  const [quickOpen, setQuickOpen] = useState(false)

  const title = useMemo(() => ({
    overview: 'Tổng quan',
    transactions: 'Giao dịch',
    books: 'Sổ sách',
    settings: 'Cài đặt',
  }[activeNav]), [activeNav])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sổ nhỏ</p>
          <h1>{title}</h1>
        </div>
        {activeNav !== 'settings' ? (
          <button className="period-chip" type="button" aria-label="Chọn kỳ báo cáo">Tháng này</button>
        ) : null}
      </header>

      <main className="main-content" id="main-content">
        {activeNav === 'overview' ? (
          <>
            <section className="balance-card" aria-labelledby="balance-title">
              <div className="balance-card__topline">
                <p id="balance-title">Tổng tiền hiện có</p>
                <span className="status-pill">Đã cập nhật</span>
              </div>
              <p className="balance-amount">28.640.000 ₫</p>
              <div className="balance-breakdown">
                <div><span>Tiền mặt</span><strong>8.240.000 ₫</strong></div>
                <div><span>Ngân hàng</span><strong>20.400.000 ₫</strong></div>
              </div>
            </section>

            <section className="summary-grid" aria-label="Tóm tắt tháng">
              <article className="summary-card">
                <div className="summary-icon summary-icon--positive"><Icon name="income" size={20}/></div>
                <div><span>Thu tháng này</span><strong>18.250.000 ₫</strong><small>Doanh thu & khoản thu</small></div>
              </article>
              <article className="summary-card">
                <div className="summary-icon summary-icon--negative"><Icon name="expense" size={20}/></div>
                <div><span>Chi tháng này</span><strong>9.870.000 ₫</strong><small>Chi phí & khoản chi</small></div>
              </article>
            </section>

            <section className="section-block">
              <div className="section-heading"><h2>Thao tác nhanh</h2></div>
              <div className="quick-actions">
                <button type="button" className="quick-action"><span className="quick-action__icon positive"><Icon name="income" /></span><span>Thu</span></button>
                <button type="button" className="quick-action"><span className="quick-action__icon negative"><Icon name="expense" /></span><span>Chi</span></button>
                <button type="button" className="quick-action"><span className="quick-action__icon primary"><Icon name="transfer" /></span><span>Chuyển tiền</span></button>
              </div>
            </section>

            <section className="section-block recent-section">
              <div className="section-heading"><h2>Giao dịch gần đây</h2><button type="button" onClick={() => setActiveNav('transactions')}>Xem tất cả</button></div>
              <div className="transaction-list">
                {transactions.map((tx) => (
                  <button className="transaction-row" type="button" key={tx.title + tx.meta}>
                    <span className={`transaction-marker ${tx.tone}`} aria-hidden="true"></span>
                    <span className="transaction-copy"><strong>{tx.title}</strong><small>{tx.meta}</small></span>
                    <span className={`transaction-amount ${tx.tone}`}>{tx.amount}</span>
                    <Icon name="chevron" size={18}/>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : activeNav === 'settings' ? (
          <AccountingSettings />
        ) : (
          <section className="placeholder-card">
            <p className="eyebrow">Đang xây dựng</p>
            <h2>{title}</h2>
            <p>Khung điều hướng đã sẵn sàng. Nội dung nghiệp vụ sẽ được kết nối với dữ liệu Dexie ở phase tiếp theo.</p>
          </section>
        )}
      </main>

      {quickOpen && (
        <div className="quick-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-sheet-title">
          <button className="quick-sheet__scrim" type="button" aria-label="Đóng menu thao tác" onClick={() => setQuickOpen(false)}></button>
          <div className="quick-sheet__panel">
            <div className="quick-sheet__handle" aria-hidden="true"></div>
            <h2 id="quick-sheet-title">Thêm giao dịch</h2>
            <div className="quick-sheet__actions">
              <button type="button"><span className="quick-action__icon positive"><Icon name="income" /></span><span><strong>Thu</strong><small>Ghi nhận tiền vào</small></span><Icon name="chevron" size={18}/></button>
              <button type="button"><span className="quick-action__icon negative"><Icon name="expense" /></span><span><strong>Chi</strong><small>Ghi nhận tiền ra</small></span><Icon name="chevron" size={18}/></button>
              <button type="button"><span className="quick-action__icon primary"><Icon name="transfer" /></span><span><strong>Chuyển tiền</strong><small>Giữa các tài khoản</small></span><Icon name="chevron" size={18}/></button>
            </div>
          </div>
        </div>
      )}

      <nav className="bottom-nav" aria-label="Điều hướng chính">
        <button type="button" className={activeNav === 'overview' ? 'active' : ''} onClick={() => setActiveNav('overview')}><Icon name="home"/><span>Tổng quan</span></button>
        <button type="button" className={activeNav === 'transactions' ? 'active' : ''} onClick={() => setActiveNav('transactions')}><Icon name="transactions"/><span>Giao dịch</span></button>
        <button type="button" className="fab" aria-label="Thêm giao dịch" onClick={() => setQuickOpen(true)}><Icon name="plus" size={28}/></button>
        <button type="button" className={activeNav === 'books' ? 'active' : ''} onClick={() => setActiveNav('books')}><Icon name="books"/><span>Sổ sách</span></button>
        <button type="button" className={activeNav === 'settings' ? 'active' : ''} onClick={() => setActiveNav('settings')}><Icon name="settings"/><span>Cài đặt</span></button>
      </nav>
    </div>
  )
}

export default App

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { LEGACY_OPENING_BALANCE_MIGRATION_ID } from './accountingCutoverPersistence';
import { db } from './db';
import { AccountingEngine } from './engine';
import { AccountKind } from './models';
import type { Account, AccountKind as AccountKindValue } from './models';
import { formatVnd } from './uiAccounting';

function parseOpeningBalance(value: string): number {
  const normalized = value.replace(/[.,\s₫]/g, '');
  if (!/^-?\d+$/.test(normalized)) throw new Error('Số dư ban đầu phải là số nguyên VND.');
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount)) throw new Error('Số dư ban đầu vượt phạm vi VND an toàn.');
  return amount;
}

export function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<ReadonlyMap<string, number>>(new Map());
  const [cutoverApplied, setCutoverApplied] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKindValue>(AccountKind.CASH);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [storedAccounts, marker] = await Promise.all([
      db.accounts.orderBy('name').toArray(),
      db.migrationStates.get(LEGACY_OPENING_BALANCE_MIGRATION_ID),
    ]);
    setAccounts(storedAccounts);
    const applied = Boolean(marker);
    setCutoverApplied(applied);
    if (applied) {
      setBalances(await AccountingEngine.getBalances());
    } else {
      setBalances(new Map(storedAccounts.map((account) => [account.id, account.balance])));
    }
  }, []);

  useEffect(() => {
    void reload().catch(() => setError('Không thể đọc danh sách tài khoản.'));
  }, [reload]);

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Tên tài khoản là bắt buộc.');
      return;
    }

    try {
      const initialBalance = parseOpeningBalance(openingBalance || '0');
      if (cutoverApplied && initialBalance !== 0) {
        throw new Error('Sau khi cutover, tài khoản mới phải bắt đầu từ 0; hãy dùng giao dịch góp vốn/chuyển tiền để hình thành số dư.');
      }
      const account: Account = {
        id: crypto.randomUUID(),
        name: trimmedName,
        balance: initialBalance,
        kind,
        createdAt: Date.now(),
      };
      await db.accounts.add(account);
      setName('');
      setOpeningBalance('0');
      setMessage(cutoverApplied
        ? 'Đã thêm tài khoản mới với số dư 0.'
        : 'Đã thêm tài khoản. Số dư ban đầu sẽ được cutover thành opening cash khi engine chạy lần đầu.');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể thêm tài khoản.');
    }
  }

  async function updateKind(account: Account, nextKind: AccountKindValue) {
    setMessage(null);
    setError(null);
    try {
      await db.accounts.update(account.id, { kind: nextKind });
      await reload();
      setMessage(`Đã cập nhật loại tài khoản “${account.name}”.`);
    } catch {
      setError('Không thể cập nhật loại tài khoản.');
    }
  }

  return (
    <section className="settings-card operational-card" aria-labelledby="account-manager-title">
      <div className="workspace-heading">
        <div>
          <span className="regime-kicker">Tài khoản tiền</span>
          <strong id="account-manager-title">Tiền mặt & tiền gửi</strong>
        </div>
        <span className={`runtime-badge ${cutoverApplied ? 'ready' : 'pending'}`}>
          {cutoverApplied ? 'Đã cutover' : 'Chưa cutover'}
        </span>
      </div>

      <div className="account-list">
        {accounts.length === 0 ? <p className="empty-copy">Chưa có tài khoản. Tạo ít nhất một tài khoản để ghi giao dịch tiền.</p> : null}
        {accounts.map((account) => (
          <div className="account-row" key={account.id}>
            <div>
              <strong>{account.name}</strong>
              <small>{formatVnd(balances.get(account.id) ?? 0)}</small>
            </div>
            <select
              aria-label={`Loại tài khoản ${account.name}`}
              value={account.kind ?? ''}
              onChange={(event) => void updateKind(account, event.target.value as AccountKindValue)}
            >
              <option value="" disabled>Chọn loại</option>
              <option value={AccountKind.CASH}>Tiền mặt</option>
              <option value={AccountKind.DEMAND_DEPOSIT}>Tiền gửi không kỳ hạn</option>
            </select>
          </div>
        ))}
      </div>

      <form className="compact-form" onSubmit={addAccount}>
        <label>
          <span>Tên tài khoản</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="VD: Tiền mặt cửa hàng" />
        </label>
        <label>
          <span>Loại</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as AccountKindValue)}>
            <option value={AccountKind.CASH}>Tiền mặt</option>
            <option value={AccountKind.DEMAND_DEPOSIT}>Tiền gửi không kỳ hạn</option>
          </select>
        </label>
        <label>
          <span>Số dư ban đầu</span>
          <input
            inputMode="numeric"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.target.value)}
            disabled={cutoverApplied}
          />
          <small>{cutoverApplied ? 'Tài khoản tạo sau cutover luôn bắt đầu từ 0.' : 'Có thể âm; đây chỉ là số dư legacy trước cutover lần đầu.'}</small>
        </label>
        <button className="secondary-button" type="submit">Thêm tài khoản</button>
      </form>

      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
    </section>
  );
}

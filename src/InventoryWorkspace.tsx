import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { db } from './db';
import {
  InventoryDirection,
  formatInventoryQuantity,
  inventoryLineValueVnd,
  inventoryService,
  parseInventoryQuantityToMilli,
} from './inventory';
import type { InventoryItem, InventoryMovement } from './inventory';
import { TransactionType } from './models';
import type { Transaction } from './models';
import { formatVnd } from './uiAccounting';

function dateInput(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timestampFromDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Ngày tồn kho không hợp lệ.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error('Ngày tồn kho không tồn tại trên lịch.');
  }
  return date.getTime();
}

function parseVnd(value: string): number {
  const normalized = value.replace(/[.,\s₫]/g, '');
  if (!/^\d+$/.test(normalized)) throw new Error('Đơn giá phải là số nguyên VND không âm.');
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount)) throw new Error('Đơn giá vượt phạm vi VND an toàn.');
  return amount;
}

const IN_LINK_TYPES = new Set<Transaction['type']>([
  TransactionType.CASH_PURCHASE,
  TransactionType.CREDIT_PURCHASE,
  TransactionType.CUSTOMER_REFUND,
]);
const OUT_LINK_TYPES = new Set<Transaction['type']>([
  TransactionType.CASH_SALE,
  TransactionType.CREDIT_SALE,
  TransactionType.SUPPLIER_REFUND,
]);

export function InventoryWorkspace({
  periodStart,
  locked,
  onChanged,
}: {
  periodStart: number;
  locked: boolean;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [unit, setUnit] = useState('cái');
  const [openingDate, setOpeningDate] = useState(() => dateInput(periodStart));
  const [openingQuantity, setOpeningQuantity] = useState('0');
  const [openingUnitCost, setOpeningUnitCost] = useState('0');
  const [movementItemId, setMovementItemId] = useState('');
  const [direction, setDirection] = useState<typeof InventoryDirection[keyof typeof InventoryDirection]>(InventoryDirection.IN);
  const [movementDate, setMovementDate] = useState(() => dateInput(Date.now()));
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [documentNumber, setDocumentNumber] = useState('');
  const [linkedTransactionId, setLinkedTransactionId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [storedItems, storedMovements, storedTransactions] = await Promise.all([
      db.inventoryItems.orderBy('code').toArray(),
      db.inventoryMovements.orderBy('date').reverse().toArray(),
      db.transactions.orderBy('date').reverse().toArray(),
    ]);
    setItems(storedItems);
    setMovements(storedMovements);
    setTransactions(storedTransactions);
    if (!movementItemId && storedItems[0]) setMovementItemId(storedItems[0].id);
  }, [movementItemId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch(() => setError('Không thể đọc dữ liệu tồn kho.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const linkCandidates = useMemo(() => {
    const allowed = direction === InventoryDirection.IN ? IN_LINK_TYPES : OUT_LINK_TYPES;
    return transactions.filter((tx) => tx.status === 'POSTED' && allowed.has(tx.type));
  }, [direction, transactions]);

  async function refreshAfterWrite(): Promise<void> {
    await reload();
    await onChanged();
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setError(null); setMessage(null); setSaving(true);
    try {
      await inventoryService.createItem({
        code: itemCode.trim(), name: itemName.trim(), unit: unit.trim(),
        openingEffectiveDate: timestampFromDate(openingDate),
        openingQuantityMilli: parseInventoryQuantityToMilli(openingQuantity),
        openingUnitCostVnd: parseVnd(openingUnitCost),
      });
      setItemCode(''); setItemName(''); setOpeningQuantity('0'); setOpeningUnitCost('0');
      setMessage('Đã tạo mặt hàng và ghi tồn đầu kỳ.');
      await refreshAfterWrite();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tạo mặt hàng tồn kho.');
    } finally { setSaving(false); }
  }

  async function postMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setError(null); setMessage(null); setSaving(true);
    try {
      if (!movementItemId) throw new Error('Hãy chọn mặt hàng.');
      const quantityMilli = parseInventoryQuantityToMilli(quantity);
      if (quantityMilli <= 0) throw new Error('Số lượng nhập/xuất phải lớn hơn 0.');
      await inventoryService.postMovement({
        itemId: movementItemId,
        date: timestampFromDate(movementDate),
        direction,
        quantityMilli,
        unitCostVnd: direction === InventoryDirection.IN ? parseVnd(unitCost) : undefined,
        transactionId: linkedTransactionId || undefined,
        documentNumber: documentNumber.trim() || undefined,
        description: description.trim() || undefined,
      });
      setQuantity('1'); setUnitCost('0'); setDocumentNumber(''); setLinkedTransactionId(''); setDescription('');
      setMessage(direction === InventoryDirection.IN
        ? 'Đã ghi nhập kho với đơn giá thực tế; S2c đã được cập nhật.'
        : 'Đã ghi xuất kho; đơn giá và thành tiền S2c được tính theo bình quân kỳ TT58.');
      await refreshAfterWrite();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể ghi dòng nhập/xuất kho.');
    } finally { setSaving(false); }
  }

  async function reverseMovement(movement: InventoryMovement) {
    if (locked || !window.confirm('Đảo dòng nhập/xuất kho này? Dòng gốc vẫn được giữ lại để đối chiếu.')) return;
    setError(null); setMessage(null);
    try {
      await inventoryService.reverseMovement(movement.id);
      setMessage('Đã tạo dòng đảo trong cùng tháng; dòng gốc không bị xóa.');
      await refreshAfterWrite();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể đảo dòng nhập/xuất kho.');
    }
  }

  return (
    <section className="workspace-card inventory-workspace" aria-labelledby="inventory-title">
      <div className="workspace-heading compact-heading">
        <div>
          <strong id="inventory-title">Tồn kho · S2c-DNSN</strong>
          <small>Nhập kho dùng đơn giá thực tế. Xuất kho được định giá theo bình quân kỳ TT58 từ tồn đầu kỳ + nhập trong kỳ.</small>
        </div>
        <span className={`runtime-badge ${locked ? 'ready' : 'pending'}`}>{locked ? 'LOCKED' : 'TT58 AVG'}</span>
      </div>
      {locked ? <p className="form-alert warning">Kỳ đang khóa. Không thể thay đổi tồn kho trong kỳ cho đến khi mở khóa.</p> : null}

      <fieldset className="inventory-fieldset" disabled={locked || saving}>
        <form className="compact-form inventory-subform" onSubmit={createItem}>
          <strong>Tạo mặt hàng + tồn đầu kỳ</strong>
          <div className="form-grid three-columns">
            <label><span>Mã hàng</span><input value={itemCode} onChange={(event) => setItemCode(event.target.value)} required /></label>
            <label><span>Tên hàng</span><input value={itemName} onChange={(event) => setItemName(event.target.value)} required /></label>
            <label><span>Đơn vị</span><input value={unit} onChange={(event) => setUnit(event.target.value)} required /></label>
          </div>
          <div className="form-grid three-columns">
            <label><span>Ngày tồn đầu</span><input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} required /></label>
            <label><span>SL tồn đầu</span><input inputMode="decimal" value={openingQuantity} onChange={(event) => setOpeningQuantity(event.target.value)} /></label>
            <label><span>Đơn giá tồn đầu</span><input inputMode="numeric" value={openingUnitCost} onChange={(event) => setOpeningUnitCost(event.target.value)} /></label>
          </div>
          <button className="secondary-button" type="submit">Tạo mặt hàng</button>
        </form>

        <form className="compact-form inventory-subform" onSubmit={postMovement}>
          <strong>Ghi nhập / xuất</strong>
          <div className="form-grid three-columns">
            <label><span>Mặt hàng</span><select value={movementItemId} onChange={(event) => setMovementItemId(event.target.value)} required><option value="">Chọn mặt hàng</option>{items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
            <label><span>Hướng</span><select value={direction} onChange={(event) => { setDirection(event.target.value as typeof direction); setLinkedTransactionId(''); }}><option value={InventoryDirection.IN}>Nhập</option><option value={InventoryDirection.OUT}>Xuất</option></select></label>
            <label><span>Ngày</span><input type="date" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} required /></label>
          </div>
          <div className="form-grid three-columns">
            <label><span>Số lượng</span><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <label>
              <span>{direction === InventoryDirection.IN ? 'Đơn giá nhập VND' : 'Đơn giá xuất VND'}</span>
              <input
                inputMode="numeric"
                value={direction === InventoryDirection.IN ? unitCost : 'Tự tính bình quân kỳ'}
                disabled={direction === InventoryDirection.OUT}
                onChange={(event) => setUnitCost(event.target.value)}
              />
            </label>
            <label><span>Số chứng từ</span><input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} /></label>
          </div>
          <label><span>Liên kết giao dịch mua/bán/hoàn tiền</span><select value={linkedTransactionId} onChange={(event) => setLinkedTransactionId(event.target.value)}><option value="">Không liên kết</option>{linkCandidates.map((tx) => <option key={tx.id} value={tx.id}>{tx.documentNumber ?? tx.invoiceNumber ?? tx.id.slice(0, 8)} · {tx.type}</option>)}</select><small>Liên kết chỉ phục vụ đối chiếu; nhập/xuất kho không tự thay đổi Accounting Effects.</small></label>
          <label><span>Diễn giải</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="secondary-button" type="submit" disabled={items.length === 0}>Ghi nhập / xuất</button>
        </form>
      </fieldset>

      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
      <div className="inventory-list">{items.length === 0 ? <p className="empty-copy">Chưa có mặt hàng tồn kho.</p> : items.map((item) => <div className="inventory-item-row" key={item.id}><strong>{item.code} · {item.name}</strong><small>{item.unit}</small></div>)}</div>
      {movements.length > 0 ? <div className="inventory-movement-list">{movements.slice(0, 20).map((movement) => (
        <div className="inventory-movement-row" key={movement.id}>
          <div><strong>{movement.direction === InventoryDirection.IN ? 'Nhập' : 'Xuất'} {formatInventoryQuantity(movement.quantityMilli)}</strong><small>{movement.documentNumber ?? movement.id.slice(0, 8)} · {movement.status}</small></div>
          <span>{movement.direction === InventoryDirection.IN ? formatVnd(inventoryLineValueVnd(movement.quantityMilli, movement.unitCostVnd)) : 'Bình quân kỳ'}</span>
          {movement.status === 'POSTED' && !movement.reversalOfMovementId ? <button className="text-danger-button" disabled={locked} type="button" onClick={() => void reverseMovement(movement)}>Đảo</button> : null}
        </div>
      ))}</div> : null}
    </section>
  );
}
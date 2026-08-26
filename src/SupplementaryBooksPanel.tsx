import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { db } from './db';
import { periodLockService } from './periodLock';
import {
  DebtSubjectKind,
  EquityCategory,
  Tt58SupplementaryService,
} from './tt58Supplementary';
import type {
  FixedAsset,
  OtherTaxEntry,
  SupplementaryDebtEntry,
  SupplementaryEquityEntry,
} from './tt58Supplementary';
import { currentDateInput, currentMonthInput, dateInputToTimestamp, formatVnd, monthInputToPeriod } from './uiAccounting';

function signedVnd(value: string, label: string): number {
  const normalized = value.replace(/[.,\s₫]/g, '');
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} phải là số nguyên VND.`);
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount)) throw new Error(`${label} vượt phạm vi VND an toàn.`);
  return amount;
}
function nonNegativeVnd(value: string, label: string): number {
  const amount = signedVnd(value, label);
  if (amount < 0) throw new Error(`${label} không được âm.`);
  return amount;
}
function rate(value: string, label: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`${label} phải là tỷ lệ từ 0–100%.`);
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error(`${label} phải nằm trong 0–100%.`);
  return amount;
}
function quantityMilli(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) throw new Error('Số lượng tính thuế tối đa 3 chữ số thập phân.');
  const amount = Math.round(Number(normalized) * 1000);
  if (!Number.isSafeInteger(amount)) throw new Error('Số lượng tính thuế vượt phạm vi an toàn.');
  return amount;
}

const DEBT_LABELS: Record<string, string> = {
  LOAN: 'Khoản vay', ADVANCE: 'Tạm ứng', EMPLOYEE: 'Người lao động', DEPOSIT: 'Ký quỹ/đặt cọc', OTHER_TAX: 'Nghĩa vụ thuế khác', OTHER: 'Công nợ khác',
};
const EQUITY_LABELS: Record<string, string> = {
  OWNER_CONTRIBUTION: 'Vốn góp', RETAINED_EARNINGS: 'Lợi nhuận chưa phân phối', EQUITY_FUND: 'Quỹ thuộc vốn CSH', OTHER: 'Vốn khác',
};

export function SupplementaryBooksPanel() {
  const service = useMemo(() => new Tt58SupplementaryService(db), []);
  const [month, setMonth] = useState(currentMonthInput());
  const period = useMemo(() => monthInputToPeriod(month), [month]);
  const [locked, setLocked] = useState(false);
  const [debtEntries, setDebtEntries] = useState<SupplementaryDebtEntry[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [taxEntries, setTaxEntries] = useState<OtherTaxEntry[]>([]);
  const [equityEntries, setEquityEntries] = useState<SupplementaryEquityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [debtKind, setDebtKind] = useState<string>(DebtSubjectKind.LOAN);
  const [debtCode, setDebtCode] = useState(''); const [debtName, setDebtName] = useState('');
  const [debtDate, setDebtDate] = useState(currentDateInput()); const [debtDoc, setDebtDoc] = useState(''); const [debtDesc, setDebtDesc] = useState('');
  const [rInc, setRInc] = useState('0'); const [rPaid, setRPaid] = useState('0'); const [pInc, setPInc] = useState('0'); const [pPaid, setPPaid] = useState('0');

  const [assetCode, setAssetCode] = useState(''); const [assetCategory, setAssetCategory] = useState('Máy móc, thiết bị'); const [assetName, setAssetName] = useState('');
  const [assetDoc, setAssetDoc] = useState(''); const [assetDate, setAssetDate] = useState(currentDateInput()); const [useMonth, setUseMonth] = useState(currentMonthInput());
  const [originalCost, setOriginalCost] = useState('0'); const [depRate, setDepRate] = useState('0'); const [depYear, setDepYear] = useState('0'); const [depAccum, setDepAccum] = useState('0');
  const [decreaseAssetId, setDecreaseAssetId] = useState(''); const [decreaseDoc, setDecreaseDoc] = useState(''); const [decreaseDate, setDecreaseDate] = useState(currentDateInput()); const [decreaseReason, setDecreaseReason] = useState('');

  const [taxCode, setTaxCode] = useState(''); const [taxName, setTaxName] = useState(''); const [taxDate, setTaxDate] = useState(currentDateInput()); const [taxDesc, setTaxDesc] = useState('');
  const [taxQty, setTaxQty] = useState('0'); const [taxAbsRate, setTaxAbsRate] = useState('0'); const [taxUnitPrice, setTaxUnitPrice] = useState('0'); const [taxPct, setTaxPct] = useState('0');
  const [taxProp, setTaxProp] = useState('0'); const [taxAbs, setTaxAbs] = useState('0'); const [taxXnk, setTaxXnk] = useState('0'); const [taxEnv, setTaxEnv] = useState('0'); const [taxResource, setTaxResource] = useState('0'); const [taxLand, setTaxLand] = useState('0'); const [taxOther, setTaxOther] = useState('0');

  const [equityCategory, setEquityCategory] = useState<string>(EquityCategory.RETAINED_EARNINGS); const [equityCode, setEquityCode] = useState('LNCPP'); const [equityName, setEquityName] = useState('Lợi nhuận chưa phân phối');
  const [equityDate, setEquityDate] = useState(currentDateInput()); const [equityDoc, setEquityDoc] = useState(''); const [equityDesc, setEquityDesc] = useState('');
  const [equityOpening, setEquityOpening] = useState('0'); const [equityIncrease, setEquityIncrease] = useState('0'); const [equityDecrease, setEquityDecrease] = useState('0');

  const load = useCallback(async () => {
    const [lock, debts, fixed, taxes, equity] = await Promise.all([
      periodLockService.getPeriodLock(period),
      db.supplementaryDebtEntries.orderBy('date').reverse().toArray(),
      db.fixedAssets.orderBy('code').toArray(),
      db.otherTaxEntries.orderBy('date').reverse().toArray(),
      db.supplementaryEquityEntries.orderBy('date').reverse().toArray(),
    ]);
    setLocked(lock?.status === 'LOCKED'); setDebtEntries(debts); setAssets(fixed); setTaxEntries(taxes); setEquityEntries(equity);
  }, [period]);

  useEffect(() => { const timer = window.setTimeout(() => { void load().catch(() => setError('Không thể đọc dữ liệu sổ S4.')); }, 0); return () => window.clearTimeout(timer); }, [load]);

  function inSelectedPeriod(timestamp: number): number {
    if (timestamp < period.start || timestamp > period.end) throw new Error(`Ngày phải thuộc kỳ ${month}.`);
    return timestamp;
  }
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể cập nhật sổ S4.'); } finally { setBusy(false); }
  }

  async function addDebt(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await service.addDebtEntry({
        subjectCode: debtCode.trim(), subjectName: debtName.trim(), subjectKind: debtKind as keyof typeof DebtSubjectKind,
        date: inSelectedPeriod(dateInputToTimestamp(debtDate)), documentNumber: debtDoc.trim() || undefined, description: debtDesc.trim() || undefined,
        receivableIncreaseVnd: signedVnd(rInc, 'Phải thu phát sinh'), receivableCollectedVnd: signedVnd(rPaid, 'Đã thu'),
        payableIncreaseVnd: signedVnd(pInc, 'Phải trả phát sinh'), payablePaidVnd: signedVnd(pPaid, 'Đã trả'),
      });
      setDebtDoc(''); setDebtDesc(''); setRInc('0'); setRPaid('0'); setPInc('0'); setPPaid('0');
    }, 'Đã ghi công nợ bổ sung S4a.');
  }

  async function addAsset(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await service.addFixedAsset({
        code: assetCode.trim(), category: assetCategory.trim(), name: assetName.trim(), increaseDocumentNumber: assetDoc.trim(),
        increaseDate: inSelectedPeriod(dateInputToTimestamp(assetDate)), putIntoUseMonth: useMonth,
        originalCostVnd: nonNegativeVnd(originalCost, 'Nguyên giá'), annualDepreciationRatePct: rate(depRate, 'Tỷ lệ khấu hao'),
        depreciationVndForYear: nonNegativeVnd(depYear, 'Khấu hao năm'), accumulatedDepreciationVnd: nonNegativeVnd(depAccum, 'Khấu hao lũy kế'),
      });
      setAssetCode(''); setAssetName(''); setAssetDoc(''); setOriginalCost('0'); setDepRate('0'); setDepYear('0'); setDepAccum('0');
    }, 'Đã thêm tài sản cố định vào S4b.');
  }

  async function decreaseAsset(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!decreaseAssetId) throw new Error('Hãy chọn tài sản cần ghi giảm.');
      await service.recordFixedAssetDecrease(decreaseAssetId, {
        decreaseDocumentNumber: decreaseDoc.trim(), decreaseDate: inSelectedPeriod(dateInputToTimestamp(decreaseDate)), decreaseReason: decreaseReason.trim(),
      });
      setDecreaseAssetId(''); setDecreaseDoc(''); setDecreaseReason('');
    }, 'Đã ghi giảm tài sản S4b.');
  }

  async function addTax(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await service.addOtherTaxEntry({
        taxCode: taxCode.trim(), taxName: taxName.trim(), date: inSelectedPeriod(dateInputToTimestamp(taxDate)), description: taxDesc.trim(),
        taxableQuantityMilli: quantityMilli(taxQty), absoluteTaxRateVnd: signedVnd(taxAbsRate, 'Mức thuế tuyệt đối'), taxableUnitPriceVnd: signedVnd(taxUnitPrice, 'Đơn giá tính thuế'),
        taxRatePct: rate(taxPct, 'Thuế suất'), proportionalTaxVnd: signedVnd(taxProp, 'Thuế tỷ lệ'), absoluteTaxVnd: signedVnd(taxAbs, 'Thuế tuyệt đối'),
        exportImportExcisePayableVnd: signedVnd(taxXnk, 'Thuế XNK/TTĐB'), environmentalProtectionTaxVnd: signedVnd(taxEnv, 'Thuế BVMT'),
        resourceTaxVnd: signedVnd(taxResource, 'Thuế tài nguyên'), landUseTaxVnd: signedVnd(taxLand, 'Thuế sử dụng đất'), otherTaxVnd: signedVnd(taxOther, 'Thuế khác'),
      });
      setTaxDesc(''); setTaxQty('0'); setTaxAbsRate('0'); setTaxUnitPrice('0'); setTaxPct('0'); setTaxProp('0'); setTaxAbs('0'); setTaxXnk('0'); setTaxEnv('0'); setTaxResource('0'); setTaxLand('0'); setTaxOther('0');
    }, 'Đã ghi nghĩa vụ thuế khác S4c.');
  }

  async function addEquity(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await service.addEquityEntry({
        accountCode: equityCode.trim(), accountName: equityName.trim(), category: equityCategory as keyof typeof EquityCategory,
        date: inSelectedPeriod(dateInputToTimestamp(equityDate)), documentNumber: equityDoc.trim() || undefined, description: equityDesc.trim(),
        openingBalanceVnd: signedVnd(equityOpening, 'Số dư đầu kỳ'), increaseVnd: signedVnd(equityIncrease, 'Vốn tăng'), decreaseVnd: signedVnd(equityDecrease, 'Vốn giảm'),
      });
      setEquityDoc(''); setEquityDesc(''); setEquityOpening('0'); setEquityIncrease('0'); setEquityDecrease('0');
    }, 'Đã ghi biến động vốn S4d.');
  }

  const currentDebts = debtEntries.filter((row) => row.date >= period.start && row.date <= period.end);
  const currentTaxes = taxEntries.filter((row) => row.date >= period.start && row.date <= period.end);
  const currentEquity = equityEntries.filter((row) => row.date >= period.start && row.date <= period.end);

  return (
    <section className="settings-card form-section" aria-labelledby="s4-workspace-title">
      <div className="workspace-heading">
        <div><strong id="s4-workspace-title">Sổ chi tiết bổ sung S4a–S4d</strong><p>Điều 9 TT58. Chỉ nhập các nghiệp vụ thực tế phát sinh; công nợ mua/bán và góp vốn semantic đã được tự đưa vào projection.</p></div>
        <span className={`runtime-badge ${locked ? 'ready' : 'pending'}`}>{locked ? 'LOCKED' : 'EDITABLE'}</span>
      </div>
      <label><span>Kỳ đang thao tác</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      {locked ? <p className="form-alert warning">Kỳ đang khóa. Các form S4 bị vô hiệu; snapshot đã khóa giữ nguyên.</p> : null}

      <details open>
        <summary><strong>S4a · Công nợ bổ sung</strong></summary>
        <p className="field-help">Không nhập lại công nợ khách hàng/nhà cung cấp từ CREDIT_SALE, CUSTOMER_PAYMENT, CREDIT_PURCHASE, SUPPLIER_PAYMENT.</p>
        <form className="compact-form" onSubmit={(event) => void addDebt(event)}>
          <div className="form-grid three-columns">
            <label><span>Loại đối tượng</span><select disabled={locked || busy} value={debtKind} onChange={(e) => setDebtKind(e.target.value)}>{Object.values(DebtSubjectKind).map((value) => <option key={value} value={value}>{DEBT_LABELS[value]}</option>)}</select></label>
            <label><span>Mã đối tượng</span><input disabled={locked || busy} required value={debtCode} onChange={(e) => setDebtCode(e.target.value)} /></label>
            <label><span>Tên đối tượng</span><input disabled={locked || busy} required value={debtName} onChange={(e) => setDebtName(e.target.value)} /></label>
          </div>
          <div className="form-grid three-columns"><label><span>Ngày</span><input disabled={locked || busy} type="date" value={debtDate} onChange={(e) => setDebtDate(e.target.value)} /></label><label><span>Số chứng từ</span><input disabled={locked || busy} value={debtDoc} onChange={(e) => setDebtDoc(e.target.value)} /></label><label><span>Diễn giải</span><input disabled={locked || busy} value={debtDesc} onChange={(e) => setDebtDesc(e.target.value)} /></label></div>
          <div className="form-grid two-columns"><label><span>Phải thu phát sinh</span><input disabled={locked || busy} inputMode="numeric" value={rInc} onChange={(e) => setRInc(e.target.value)} /></label><label><span>Đã thu</span><input disabled={locked || busy} inputMode="numeric" value={rPaid} onChange={(e) => setRPaid(e.target.value)} /></label><label><span>Phải trả phát sinh</span><input disabled={locked || busy} inputMode="numeric" value={pInc} onChange={(e) => setPInc(e.target.value)} /></label><label><span>Đã trả</span><input disabled={locked || busy} inputMode="numeric" value={pPaid} onChange={(e) => setPPaid(e.target.value)} /></label></div>
          <button className="secondary-button" disabled={locked || busy} type="submit">Ghi S4a</button>
        </form>
        <small>{currentDebts.length} dòng bổ sung trong kỳ. Correction được ghi bằng dòng âm hoặc bút toán đảo, không xóa lịch sử.</small>
      </details>

      <details>
        <summary><strong>S4b · Tài sản cố định</strong></summary>
        <form className="compact-form" onSubmit={(event) => void addAsset(event)}>
          <div className="form-grid three-columns"><label><span>Mã TSCĐ</span><input disabled={locked || busy} required value={assetCode} onChange={(e) => setAssetCode(e.target.value)} /></label><label><span>Nhóm</span><input disabled={locked || busy} required value={assetCategory} onChange={(e) => setAssetCategory(e.target.value)} /></label><label><span>Tên/đặc điểm</span><input disabled={locked || busy} required value={assetName} onChange={(e) => setAssetName(e.target.value)} /></label></div>
          <div className="form-grid three-columns"><label><span>CT tăng</span><input disabled={locked || busy} required value={assetDoc} onChange={(e) => setAssetDoc(e.target.value)} /></label><label><span>Ngày tăng</span><input disabled={locked || busy} type="date" value={assetDate} onChange={(e) => setAssetDate(e.target.value)} /></label><label><span>Tháng đưa vào dùng</span><input disabled={locked || busy} type="month" value={useMonth} onChange={(e) => setUseMonth(e.target.value)} /></label></div>
          <div className="form-grid two-columns"><label><span>Nguyên giá</span><input disabled={locked || busy} inputMode="numeric" value={originalCost} onChange={(e) => setOriginalCost(e.target.value)} /></label><label><span>Tỷ lệ KH năm %</span><input disabled={locked || busy} inputMode="decimal" value={depRate} onChange={(e) => setDepRate(e.target.value)} /></label><label><span>Khấu hao năm</span><input disabled={locked || busy} inputMode="numeric" value={depYear} onChange={(e) => setDepYear(e.target.value)} /></label><label><span>Khấu hao lũy kế</span><input disabled={locked || busy} inputMode="numeric" value={depAccum} onChange={(e) => setDepAccum(e.target.value)} /></label></div>
          <small>Khấu hao là dữ liệu explicit. App không tự chọn thời gian/tỷ lệ khấu hao.</small>
          <button className="secondary-button" disabled={locked || busy} type="submit">Thêm TSCĐ</button>
        </form>
        <form className="compact-form" onSubmit={(event) => void decreaseAsset(event)}>
          <strong>Ghi giảm TSCĐ</strong>
          <div className="form-grid three-columns"><label><span>Tài sản</span><select disabled={locked || busy} value={decreaseAssetId} onChange={(e) => setDecreaseAssetId(e.target.value)}><option value="">Chọn tài sản</option>{assets.filter((a) => a.decreaseDate === undefined).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label><span>CT giảm</span><input disabled={locked || busy} value={decreaseDoc} onChange={(e) => setDecreaseDoc(e.target.value)} /></label><label><span>Ngày giảm</span><input disabled={locked || busy} type="date" value={decreaseDate} onChange={(e) => setDecreaseDate(e.target.value)} /></label></div>
          <label><span>Lý do giảm</span><input disabled={locked || busy} value={decreaseReason} onChange={(e) => setDecreaseReason(e.target.value)} /></label>
          <button className="secondary-button" disabled={locked || busy || !decreaseAssetId} type="submit">Ghi giảm</button>
        </form>
        <small>{assets.length} tài sản đang lưu.</small>
      </details>

      <details>
        <summary><strong>S4c · Nghĩa vụ thuế khác</strong></summary>
        <form className="compact-form" onSubmit={(event) => void addTax(event)}>
          <div className="form-grid three-columns"><label><span>Mã thuế</span><input disabled={locked || busy} required value={taxCode} onChange={(e) => setTaxCode(e.target.value)} /></label><label><span>Tên loại thuế</span><input disabled={locked || busy} required value={taxName} onChange={(e) => setTaxName(e.target.value)} /></label><label><span>Ngày</span><input disabled={locked || busy} type="date" value={taxDate} onChange={(e) => setTaxDate(e.target.value)} /></label></div>
          <label><span>Diễn giải</span><input disabled={locked || busy} required value={taxDesc} onChange={(e) => setTaxDesc(e.target.value)} /></label>
          <div className="form-grid three-columns"><label><span>SL tính thuế</span><input disabled={locked || busy} inputMode="decimal" value={taxQty} onChange={(e) => setTaxQty(e.target.value)} /></label><label><span>Mức thuế tuyệt đối</span><input disabled={locked || busy} inputMode="numeric" value={taxAbsRate} onChange={(e) => setTaxAbsRate(e.target.value)} /></label><label><span>Đơn giá tính thuế</span><input disabled={locked || busy} inputMode="numeric" value={taxUnitPrice} onChange={(e) => setTaxUnitPrice(e.target.value)} /></label><label><span>Thuế suất %</span><input disabled={locked || busy} inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} /></label><label><span>Thuế tỷ lệ</span><input disabled={locked || busy} inputMode="numeric" value={taxProp} onChange={(e) => setTaxProp(e.target.value)} /></label><label><span>Thuế tuyệt đối</span><input disabled={locked || busy} inputMode="numeric" value={taxAbs} onChange={(e) => setTaxAbs(e.target.value)} /></label></div>
          <div className="form-grid three-columns"><label><span>XNK/TTĐB</span><input disabled={locked || busy} inputMode="numeric" value={taxXnk} onChange={(e) => setTaxXnk(e.target.value)} /></label><label><span>BVMT</span><input disabled={locked || busy} inputMode="numeric" value={taxEnv} onChange={(e) => setTaxEnv(e.target.value)} /></label><label><span>Tài nguyên</span><input disabled={locked || busy} inputMode="numeric" value={taxResource} onChange={(e) => setTaxResource(e.target.value)} /></label><label><span>Sử dụng đất</span><input disabled={locked || busy} inputMode="numeric" value={taxLand} onChange={(e) => setTaxLand(e.target.value)} /></label><label><span>Thuế khác</span><input disabled={locked || busy} inputMode="numeric" value={taxOther} onChange={(e) => setTaxOther(e.target.value)} /></label></div>
          <button className="secondary-button" disabled={locked || busy} type="submit">Ghi S4c</button>
        </form>
        <small>{currentTaxes.length} dòng nghĩa vụ thuế khác trong kỳ.</small>
      </details>

      <details>
        <summary><strong>S4d · Vốn chủ sở hữu</strong></summary>
        <p className="field-help">Góp vốn bằng giao dịch CAPITAL_CONTRIBUTION được tự đưa vào S4d; form này dùng cho lợi nhuận chưa phân phối, quỹ, giảm vốn và khoản vốn khác.</p>
        <form className="compact-form" onSubmit={(event) => void addEquity(event)}>
          <div className="form-grid three-columns"><label><span>Loại khoản mục</span><select disabled={locked || busy} value={equityCategory} onChange={(e) => setEquityCategory(e.target.value)}>{Object.values(EquityCategory).map((value) => <option key={value} value={value}>{EQUITY_LABELS[value]}</option>)}</select></label><label><span>Mã khoản mục</span><input disabled={locked || busy} required value={equityCode} onChange={(e) => setEquityCode(e.target.value)} /></label><label><span>Tên khoản mục</span><input disabled={locked || busy} required value={equityName} onChange={(e) => setEquityName(e.target.value)} /></label></div>
          <div className="form-grid three-columns"><label><span>Ngày</span><input disabled={locked || busy} type="date" value={equityDate} onChange={(e) => setEquityDate(e.target.value)} /></label><label><span>Chứng từ</span><input disabled={locked || busy} value={equityDoc} onChange={(e) => setEquityDoc(e.target.value)} /></label><label><span>Diễn giải</span><input disabled={locked || busy} required value={equityDesc} onChange={(e) => setEquityDesc(e.target.value)} /></label></div>
          <div className="form-grid three-columns"><label><span>Số dư đầu kỳ</span><input disabled={locked || busy} inputMode="numeric" value={equityOpening} onChange={(e) => setEquityOpening(e.target.value)} /></label><label><span>Tăng</span><input disabled={locked || busy} inputMode="numeric" value={equityIncrease} onChange={(e) => setEquityIncrease(e.target.value)} /></label><label><span>Giảm</span><input disabled={locked || busy} inputMode="numeric" value={equityDecrease} onChange={(e) => setEquityDecrease(e.target.value)} /></label></div>
          <button className="secondary-button" disabled={locked || busy} type="submit">Ghi S4d</button>
        </form>
        <small>{currentEquity.length} dòng vốn bổ sung trong kỳ.</small>
      </details>

      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
      <p className="field-help">Tổng nhanh: S4a {currentDebts.reduce((sum, row) => sum + row.receivableIncreaseVnd + row.payableIncreaseVnd, 0).toLocaleString('vi-VN')} · S4b nguyên giá {formatVnd(assets.reduce((sum, row) => sum + row.originalCostVnd, 0))} · S4c {currentTaxes.length} dòng · S4d {currentEquity.length} dòng.</p>
    </section>
  );
}

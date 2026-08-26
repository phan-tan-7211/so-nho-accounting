import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { accountingProjectionService } from './accountingProjectionService';
import { db } from './db';
import { InventoryWorkspace } from './InventoryWorkspace';
import { formatInventoryQuantity } from './inventory';
import { TaxType } from './models';
import { periodLockService } from './periodLock';
import type { PeriodLockRecord } from './periodLock';
import { TaxOpeningPositionSchema, taxOpeningPositionId } from './taxOpeningPosition';
import type { TaxOpeningPosition } from './taxOpeningPosition';
import {
  buildTt58ReportBundle,
  canonicalReportJson,
  parseTt58ReportBundle,
  reportTableToCsv,
} from './tt58ReportExport';
import type { Tt58ReportBundle } from './tt58ReportExport';
import { buildTt58Xlsx, tt58XlsxFilename } from './tt58Xlsx';
import { assertLockedTt58XlsxCompatibility } from './tt58XlsxPolicy';
import { currentMonthInput, formatVnd, monthInputToPeriod } from './uiAccounting';

type ProjectionResult = Awaited<ReturnType<typeof accountingProjectionService.buildTt58Projection>>;

function parseSignedVnd(value: string, label: string): number {
  const normalized = value.replace(/[.,\s₫]/g, '');
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} phải là số nguyên VND, có thể âm.`);
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount)) throw new Error(`${label} vượt phạm vi VND an toàn.`);
  return amount;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'IMPLEMENTED' || status === 'COMPLETE' || status === 'LOCKED'
    ? 'ready'
    : status === 'PLANNED'
      ? 'planned'
      : 'pending';
  return <span className={`runtime-badge ${tone}`}>{status}</span>;
}

function TaxSummary({ label, summary }: { label: string; summary: ProjectionResult['taxSettlements']['vat'] }) {
  if (!summary) return null;
  return (
    <article className="tax-summary-card">
      <div className="workspace-heading compact-heading">
        <strong>{label}</strong>
        <StatusBadge status={summary.status} />
      </div>
      <div className="metric-grid">
        <div><span>Đầu kỳ phải nộp</span><strong>{formatVnd(summary.openingPayable)}</strong></div>
        <div><span>Đầu kỳ được khấu trừ/hoàn</span><strong>{formatVnd(summary.openingCredit)}</strong></div>
        <div><span>Phát sinh thuế</span><strong>{formatVnd(summary.periodNetTaxChange)}</strong></div>
        <div><span>Đã nộp</span><strong>{formatVnd(summary.paid)}</strong></div>
        <div><span>Đã hoàn</span><strong>{formatVnd(summary.refunded)}</strong></div>
        <div><span>Cuối kỳ</span><strong>{formatVnd(summary.closingNetPosition)}</strong></div>
      </div>
      {summary.issues.length > 0 ? (
        <ul className="blocker-list">{summary.issues.map((issue) => <li key={`${issue.code}-${issue.transactionId ?? ''}`}>{issue.message}</li>)}</ul>
      ) : null}
    </article>
  );
}

function BookDetails({ result }: { result: ProjectionResult }) {
  const books = result.materializedBooks;

  return (
    <div className="book-detail-stack">
      {books.s1 ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S1-DNSN · Doanh thu và thuế % doanh thu</strong><StatusBadge status={books.s1.status} /></div>
          {books.s1.groups.map((group) => (
            <div className="book-group" key={`${group.activityLabel}-${group.vatRevenueRate}-${group.incomeTaxRevenueRate}`}>
              <strong>{group.activityLabel}</strong>
              <span>Doanh thu {formatVnd(group.totalRevenue)}</span>
              <small>VAT: {group.vatTaxDue === undefined ? '—' : formatVnd(group.vatTaxDue)} · Thuế thu nhập: {group.incomeTaxDue === undefined ? '—' : formatVnd(group.incomeTaxDue)}</small>
            </div>
          ))}
        </article>
      ) : null}

      {books.s2a ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S2a-DNSN · VAT % doanh thu</strong><StatusBadge status={books.s2a.status} /></div>
          <p className="book-total">Doanh thu tính thuế: <strong>{formatVnd(books.s2a.totalRevenue)}</strong> · VAT phát sinh: <strong>{formatVnd(books.s2a.totalVatTaxDue ?? 0)}</strong></p>
        </article>
      ) : null}

      {books.s3a ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S3a-DNSN · Thuế thu nhập % doanh thu</strong><StatusBadge status={books.s3a.status} /></div>
          <p className="book-total">Doanh thu tính thuế: <strong>{formatVnd(books.s3a.totalRevenue)}</strong> · Thuế phát sinh: <strong>{formatVnd(books.s3a.totalIncomeTaxDue ?? 0)}</strong></p>
        </article>
      ) : null}

      {books.s2b ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S2b-DNSN · Doanh thu, chi phí, nghĩa vụ TNDN</strong><StatusBadge status={books.s2b.status} /></div>
          <div className="metric-grid">
            <div><span>Doanh thu</span><strong>{formatVnd(books.s2b.revenueTotal)}</strong></div>
            <div><span>Chi phí</span><strong>{formatVnd(books.s2b.expenseTotal)}</strong></div>
            <div><span>TNDN đầu kỳ</span><strong>{formatVnd(books.s2b.taxSettlement?.openingNetPosition ?? 0)}</strong></div>
            <div><span>TNDN cuối kỳ</span><strong>{formatVnd(books.s2b.taxSettlement?.closingNetPosition ?? 0)}</strong></div>
          </div>
        </article>
      ) : null}

      {books.s2c ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S2c-DNSN · Vật liệu, dụng cụ, sản phẩm, hàng hóa</strong><StatusBadge status={books.s2c.status} /></div>
          {books.s2c.sections.length === 0 ? <p className="empty-copy">Không có item tồn kho trong kỳ.</p> : books.s2c.sections.map((section) => (
            <div className="money-section" key={section.itemId}>
              <div><strong>{section.itemCode} · {section.itemName}</strong><small>{section.unit}</small></div>
              <span>{formatInventoryQuantity(section.openingQuantityMilli)} → <strong>{formatInventoryQuantity(section.closingQuantityMilli)}</strong></span>
              <small>Giá trị {formatVnd(section.openingValueVnd)} → {formatVnd(section.closingValueVnd)} · Nhập {formatInventoryQuantity(section.inboundQuantityMilli)} · Xuất {formatInventoryQuantity(section.outboundQuantityMilli)}</small>
            </div>
          ))}
        </article>
      ) : null}

      {books.s3b ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S3b-DNSN · VAT khấu trừ</strong><StatusBadge status={books.s3b.status} /></div>
          <div className="metric-grid">
            <div><span>VAT đầu vào được khấu trừ</span><strong>{formatVnd(books.s3b.deductibleVatInputTotal)}</strong></div>
            <div><span>VAT đầu ra</span><strong>{formatVnd(books.s3b.vatOutputTotal)}</strong></div>
            <div><span>Chênh lệch kỳ</span><strong>{formatVnd(books.s3b.periodVatOutputLessDeductibleInput)}</strong></div>
            <div><span>VAT cuối kỳ</span><strong>{formatVnd(books.s3b.taxSettlement?.closingNetPosition ?? 0)}</strong></div>
          </div>
        </article>
      ) : null}

      {books.s2d ? (
        <article className="workspace-card">
          <div className="workspace-heading compact-heading"><strong>S2d-DNSN · Tiền</strong><StatusBadge status={books.s2d.status} /></div>
          {books.s2d.sections.map((section) => (
            <div className="money-section" key={section.accountId}>
              <div><strong>{section.accountName}</strong><small>{section.accountKind}</small></div>
              <span>{formatVnd(section.openingBalance)} → <strong>{formatVnd(section.closingBalance)}</strong></span>
              <small>Thu {formatVnd(section.totalIn)} · Chi {formatVnd(section.totalOut)}</small>
            </div>
          ))}
        </article>
      ) : null}
    </div>
  );
}

function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadBytes(filename: string, content: Uint8Array, mime: string): void {
  const buffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(buffer).set(content);
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function previewReport(result: ProjectionResult | null, period: { start: number; end: number }): Tt58ReportBundle | null {
  if (!result) return null;
  try {
    return buildTt58ReportBundle({
      profile: result.profile,
      capabilities: result.capabilities,
      materializedBooks: result.materializedBooks,
      period,
    });
  } catch {
    return null;
  }
}

export function BooksWorkspace() {
  const [month, setMonth] = useState(currentMonthInput());
  const [result, setResult] = useState<ProjectionResult | null>(null);
  const [periodLock, setPeriodLock] = useState<PeriodLockRecord | null>(null);
  const [lockedReport, setLockedReport] = useState<Tt58ReportBundle | null>(null);
  const [vatOpening, setVatOpening] = useState('0');
  const [incomeOpening, setIncomeOpening] = useState('0');
  const [loading, setLoading] = useState(true);
  const [savingOpening, setSavingOpening] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const period = useMemo(() => monthInputToPeriod(month), [month]);
  const draftReport = useMemo(() => previewReport(result, period), [period, result]);
  const activeExportReport = periodLock?.status === 'LOCKED' ? lockedReport : draftReport;
  const s2cRequired = result?.capabilities.some((capability) => capability.required && capability.code === 'S2c-DNSN') ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projection, vat, income, lock] = await Promise.all([
        accountingProjectionService.buildTt58Projection({ start: period.start, end: period.end }),
        db.taxOpeningPositions.get(taxOpeningPositionId(TaxType.VAT, period.start)),
        db.taxOpeningPositions.get(taxOpeningPositionId(TaxType.INCOME_TAX, period.start)),
        periodLockService.getPeriodLock(period),
      ]);
      setResult(projection);
      setVatOpening(String(vat?.amount ?? 0));
      setIncomeOpening(String(income?.amount ?? 0));
      setPeriodLock(lock ?? null);
      setLockedReport(lock?.status === 'LOCKED' ? parseTt58ReportBundle(lock.reportSnapshotJson) : null);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : 'Không thể dựng sổ TT58 cho kỳ này.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveOpenings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSavingOpening(true);
    try {
      const now = Date.now();
      const values: Array<[typeof TaxType.VAT | typeof TaxType.INCOME_TAX, string]> = [
        [TaxType.VAT, vatOpening], [TaxType.INCOME_TAX, incomeOpening],
      ];
      const records: TaxOpeningPosition[] = [];
      for (const [taxType, raw] of values) {
        const id = taxOpeningPositionId(taxType, period.start);
        const existing = await db.taxOpeningPositions.get(id);
        records.push(TaxOpeningPositionSchema.parse({
          id, taxType, periodStart: period.start,
          amount: parseSignedVnd(raw, taxType === TaxType.VAT ? 'VAT đầu kỳ' : 'Thuế thu nhập đầu kỳ'),
          createdAt: existing?.createdAt ?? now, updatedAt: now,
        }));
      }
      await periodLockService.putTaxOpeningPositions(records);
      setMessage('Đã lưu số dư nghĩa vụ thuế đầu kỳ cho đúng kỳ báo cáo.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu số dư thuế đầu kỳ.');
    } finally { setSavingOpening(false); }
  }

  async function lockCurrentPeriod() {
    setError(null); setMessage(null); setLocking(true);
    try {
      const locked = await periodLockService.lockPeriod(period);
      setMessage(locked.alreadyLocked ? 'Kỳ này đã được khóa; đang dùng snapshot đã lưu.' : `Đã khóa kỳ và tạo snapshot báo cáo revision ${locked.state.revision}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể khóa kỳ.');
    } finally { setLocking(false); }
  }

  async function unlockCurrentPeriod() {
    if (!window.confirm('Mở khóa kỳ sẽ cho phép ghi/đảo giao dịch, tồn kho và sửa opening thuế trong kỳ. Tiếp tục?')) return;
    setError(null); setMessage(null); setLocking(true);
    try {
      await periodLockService.unlockPeriod(period);
      setMessage('Đã mở khóa kỳ. Lịch sử UNLOCK được giữ lại; snapshot khóa cũ không bị xóa.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể mở khóa kỳ.');
    } finally { setLocking(false); }
  }

  function exportJson(report: Tt58ReportBundle) {
    const mode = periodLock?.status === 'LOCKED' ? 'locked' : 'draft';
    downloadText(`tt58-${month}-${mode}.json`, `${canonicalReportJson(report)}\n`, 'application/json;charset=utf-8');
  }

  function exportCsv(table: Tt58ReportBundle['tables'][number]) {
    const mode = periodLock?.status === 'LOCKED' ? 'locked' : 'draft';
    downloadText(`${table.code}-${month}-${mode}.csv`, reportTableToCsv(table), 'text/csv;charset=utf-8');
  }

  function exportXlsx(report: Tt58ReportBundle) {
    setError(null);
    try {
      const locked = periodLock?.status === 'LOCKED';
      if (locked) assertLockedTt58XlsxCompatibility(report);
      const bytes = buildTt58Xlsx(report, { draft: !locked });
      downloadBytes(
        tt58XlsxFilename(month, locked),
        bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tạo file XLSX TT58.');
    }
  }

  return (
    <section className="workspace-stack" aria-labelledby="books-workspace-title">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">TT58 runtime</p>
          <h2 id="books-workspace-title">Sổ sách & readiness</h2>
          <p>Chỉ đánh dấu IMPLEMENTED khi dữ liệu của kỳ đáp ứng đủ điều kiện projection.</p>
        </div>
        <label className="month-control"><span>Kỳ</span><input type="month" value={month} min="2026-07" onChange={(event) => setMonth(event.target.value)} /></label>
      </div>

      <article className="workspace-card lock-card">
        <div className="workspace-heading compact-heading">
          <div><strong>Khóa kỳ & snapshot báo cáo</strong><small>Kỳ chỉ khóa được khi toàn bộ sổ bắt buộc đều IMPLEMENTED.</small></div>
          <StatusBadge status={periodLock?.status ?? 'UNLOCKED'} />
        </div>
        {periodLock?.status === 'LOCKED' ? (
          <p className="lock-copy">Revision {periodLock.revision} · khóa lúc {new Date(periodLock.lockedAt).toLocaleString('vi-VN')}. Export bên dưới luôn dùng snapshot đã khóa, không dùng dữ liệu live.</p>
        ) : draftReport ? (
          <p className="lock-copy">Dữ liệu hiện tại đủ điều kiện tạo report bundle. Có thể xuất bản nháp hoặc khóa kỳ để tạo snapshot.</p>
        ) : (
          <p className="lock-copy">Chưa thể khóa kỳ. Hãy xử lý các blocker của sổ bắt buộc bên dưới.</p>
        )}
        <div className="report-actions">
          {periodLock?.status === 'LOCKED' ? (
            <button className="secondary-button" type="button" disabled={locking} onClick={() => void unlockCurrentPeriod()}>{locking ? 'Đang xử lý…' : 'Mở khóa kỳ'}</button>
          ) : (
            <button className="primary-button compact" type="button" disabled={locking || !draftReport} onClick={() => void lockCurrentPeriod()}>{locking ? 'Đang khóa…' : 'Khóa kỳ'}</button>
          )}
          {activeExportReport ? <button className="secondary-button" type="button" onClick={() => exportJson(activeExportReport)}>Xuất JSON {periodLock?.status === 'LOCKED' ? 'snapshot' : 'nháp'}</button> : null}
          {activeExportReport ? <button className="secondary-button" type="button" onClick={() => exportXlsx(activeExportReport)}>Xuất XLSX TT58 {periodLock?.status === 'LOCKED' ? 'từ snapshot khóa' : 'nháp'}</button> : null}
        </div>
        {periodLock?.status === 'LOCKED' && activeExportReport?.tables.some((table) => table.code === 'S2c-DNSN') ? (
          <p className="lock-copy">S2c locked XLSX được phép khi snapshot ghi nhận TT58_PERIOD_AVERAGE_V1. Snapshot S2c legacy vẫn fail-closed và phải relock tuần tự trước khi phát hành file chính thức.</p>
        ) : null}
        {activeExportReport ? <div className="report-file-list">{activeExportReport.tables.map((table) => (
          <button className="report-file-button" type="button" key={table.code} onClick={() => exportCsv(table)}><strong>{table.code}.csv</strong><span>{table.title}</span></button>
        ))}</div> : null}
      </article>

      <form className="workspace-card" onSubmit={saveOpenings}>
        <div className="workspace-heading compact-heading"><div><strong>Số dư nghĩa vụ thuế đầu kỳ</strong><small>Dương = phải nộp · Âm = được khấu trừ/hoàn</small></div></div>
        <div className="form-grid two-columns">
          <label><span>VAT đầu kỳ</span><input inputMode="numeric" value={vatOpening} disabled={periodLock?.status === 'LOCKED'} onChange={(event) => setVatOpening(event.target.value)} /></label>
          <label><span>Thuế thu nhập đầu kỳ</span><input inputMode="numeric" value={incomeOpening} disabled={periodLock?.status === 'LOCKED'} onChange={(event) => setIncomeOpening(event.target.value)} /></label>
        </div>
        <button className="secondary-button" type="submit" disabled={savingOpening || periodLock?.status === 'LOCKED'}>{savingOpening ? 'Đang lưu…' : 'Lưu opening thuế'}</button>
      </form>

      {s2cRequired ? (
        <InventoryWorkspace
          key={period.start}
          periodStart={period.start}
          locked={periodLock?.status === 'LOCKED'}
          onChanged={load}
        />
      ) : null}

      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
      {loading ? <div className="workspace-card" role="status">Đang dựng sổ từ Accounting Effects…</div> : null}

      {result ? (
        <>
          <div className="capability-grid">
            {result.capabilities.filter((capability) => capability.required).map((capability) => (
              <article className="capability-card" key={capability.code}>
                <div className="workspace-heading compact-heading"><strong>{capability.code}</strong><StatusBadge status={capability.status} /></div>
                <p>{capability.name}</p>
                {capability.blockers.length > 0 ? <ul className="blocker-list">{capability.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <small className="ready-copy">Không còn blocker runtime cho kỳ này.</small>}
              </article>
            ))}
          </div>
          <div className="tax-summary-grid"><TaxSummary label="VAT" summary={result.taxSettlements.vat} /><TaxSummary label="Thuế thu nhập" summary={result.taxSettlements.incomeTax} /></div>
          <BookDetails result={result} />
        </>
      ) : null}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountingProjectionService } from './accountingProjectionService';
import { db } from './db';
import { analyzeHistoricalS2cRelockPlan } from './historicalRelock';
import type { HistoricalRelockPlan } from './historicalRelock';
import { periodLockService } from './periodLock';
import { RELEASE_CHANNEL, RELEASE_DATE, RELEASE_VERSION } from './releaseInfo';
import { buildTt58ReportBundle, parseTt58ReportBundle } from './tt58ReportExport';
import type { Tt58ReportBundle } from './tt58ReportExport';
import { openTt58PrintWindow } from './tt58Print';
import { currentMonthInput, monthInputToPeriod } from './uiAccounting';
import './ReleaseTools.css';

function monthLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', { month: '2-digit', year: 'numeric' }).format(new Date(timestamp));
}

function RelockPlan({ plan }: { plan: HistoricalRelockPlan }) {
  if (plan.items.length === 0) {
    return <p className="empty-copy">Chưa có snapshot lịch sử S2c cần kiểm tra.</p>;
  }
  return (
    <div className="release-relock-list">
      {plan.items.map((item) => (
        <div className="release-relock-row" key={`${item.periodStart}-${item.revision}`}>
          <div>
            <strong>{monthLabel(item.periodStart)} · revision {item.revision}</strong>
            <small>{item.reason}</small>
          </div>
          <span className={`runtime-badge ${item.status === 'COMPLIANT' ? 'ready' : 'pending'}`}>{item.status}</span>
        </div>
      ))}
    </div>
  );
}

export function ReleaseTools() {
  const [month, setMonth] = useState(currentMonthInput());
  const [report, setReport] = useState<Tt58ReportBundle | null>(null);
  const [locked, setLocked] = useState(false);
  const [plan, setPlan] = useState<HistoricalRelockPlan>({ items: [], hasBlockingHistory: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const period = useMemo(() => monthInputToPeriod(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lock, locks] = await Promise.all([
        periodLockService.getPeriodLock(period),
        db.periodLocks.toArray(),
      ]);
      setPlan(analyzeHistoricalS2cRelockPlan(locks));
      if (lock?.status === 'LOCKED') {
        setLocked(true);
        setReport(parseTt58ReportBundle(lock.reportSnapshotJson));
      } else {
        setLocked(false);
        const projection = await accountingProjectionService.buildTt58Projection(period);
        setReport(buildTt58ReportBundle({
          profile: projection.profile,
          capabilities: projection.capabilities,
          materializedBooks: projection.materializedBooks,
          period,
        }));
      }
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : 'Không thể dựng công cụ release cho kỳ này.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [load]);

  function printReport() {
    if (!report) return;
    setError(null);
    try {
      openTt58PrintWindow(report, { draft: !locked });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể mở bản in TT58.');
    }
  }

  const serviceWorkerSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

  return (
    <section className="settings-card release-tools" aria-labelledby="release-tools-title">
      <div className="workspace-heading compact-heading">
        <div>
          <strong id="release-tools-title">Release candidate · đối chiếu & in/PDF</strong>
          <small>{RELEASE_VERSION} · {RELEASE_CHANNEL} · {RELEASE_DATE}. Bản in dùng cùng report bundle với XLSX; kỳ khóa dùng snapshot bất biến.</small>
        </div>
        <span className={`runtime-badge ${online ? 'ready' : 'pending'}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
      </div>

      <label className="field-label" htmlFor="release-period">Kỳ kiểm tra</label>
      <input id="release-period" type="month" value={month} min="2026-07" onChange={(event) => setMonth(event.target.value)} />

      <div className="release-runtime-grid">
        <div><span>Version</span><strong>{RELEASE_VERSION}</strong></div>
        <div><span>Report</span><strong>{loading ? 'Đang kiểm tra…' : report ? (locked ? 'LOCKED SNAPSHOT' : 'DRAFT') : 'BLOCKED'}</strong></div>
        <div><span>Service Worker</span><strong>{serviceWorkerSupported ? 'SUPPORTED' : 'UNAVAILABLE'}</strong></div>
        <div><span>S2c history</span><strong>{plan.hasBlockingHistory ? 'CẦN RELOCK' : 'OK'}</strong></div>
      </div>

      {report ? (
        <button className="secondary-button" type="button" onClick={printReport}>
          {locked ? 'In / Lưu PDF từ snapshot khóa' : 'In / Lưu PDF bản nháp'}
        </button>
      ) : null}
      {error ? <p className="form-alert warning" role="status">{error}</p> : null}

      <div className="release-relock-block">
        <strong>Lịch sử S2c & kế hoạch relock</strong>
        {plan.hasBlockingHistory && plan.earliestRelockPeriodStart !== undefined ? (
          <p className="field-help">Bắt đầu từ {monthLabel(plan.earliestRelockPeriodStart)}, xử lý tuần tự theo thời gian trong màn Sổ sách. Công cụ này chỉ chẩn đoán, không tự mở khóa dữ liệu.</p>
        ) : (
          <p className="field-help">Không phát hiện chuỗi snapshot S2c legacy làm gãy carry-forward TT58_PERIOD_AVERAGE_V1.</p>
        )}
        <RelockPlan plan={plan} />
      </div>
    </section>
  );
}

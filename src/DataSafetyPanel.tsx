import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { dataBackupService } from './dataBackup';
import { releaseReadinessService } from './releaseReadiness';
import type { ReleaseReadinessReport } from './releaseReadiness';

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function backupFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `so-nho-accounting-backup-${stamp}.json`;
}

export function DataSafetyPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ReleaseReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setReport(await releaseReadinessService.scan());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void scan(); }, 0);
    return () => window.clearTimeout(timer);
  }, [scan]);

  async function exportBackup() {
    setBusy(true); setError(null); setMessage(null);
    try {
      downloadText(backupFilename(), await dataBackupService.exportJson());
      setMessage('Đã tạo backup đầy đủ kèm checksum SHA-256.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tạo backup.');
    } finally { setBusy(false); }
  }

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!window.confirm('Restore sẽ thay thế toàn bộ dữ liệu hiện tại bằng file backup sau khi kiểm tra checksum/schema. Tiếp tục?')) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const envelope = await dataBackupService.restoreJson(await file.text());
      setMessage(`Restore thành công backup ${new Date(envelope.createdAt).toLocaleString('vi-VN')}. Ứng dụng sẽ đọc lại dữ liệu đã phục hồi.`);
      await scan();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Restore thất bại; dữ liệu hiện tại được giữ nguyên.');
    } finally { setBusy(false); }
  }

  return (
    <section className="settings-card form-section" aria-labelledby="data-safety-title">
      <div className="book-mapping-card__heading">
        <div><strong id="data-safety-title">An toàn dữ liệu & release readiness</strong><p>Backup local-first cần được tải ra khỏi trình duyệt định kỳ.</p></div>
        <span className={`status-dot ${report?.ready ? 'configured' : ''}`} aria-hidden="true"></span>
      </div>

      <div className="report-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void exportBackup()}>Xuất backup JSON</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Restore backup</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void scan()}>Quét readiness</button>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void restore(event)} />
      </div>

      {report ? (
        <div className="settings-note">
          <strong>{report.ready ? 'READY — không có lỗi integrity' : 'NOT READY — còn lỗi cần xử lý'}</strong>
          <p>{report.counts.accounts} tài khoản · {report.counts.transactions} giao dịch · {report.counts.partners} partner · {report.counts.inventoryItems} item · {report.counts.lockedPeriods} kỳ đang khóa</p>
          {report.diagnostics.length > 0 ? (
            <ul className="blocker-list">{report.diagnostics.map((item, index) => <li key={`${item.code}-${item.recordId ?? index}`}>[{item.severity}] {item.message}</li>)}</ul>
          ) : <small>Không phát hiện orphan reference hoặc snapshot hỏng trong các kiểm tra release hiện tại.</small>}
        </div>
      ) : null}
      {error ? <p className="form-alert error" role="alert">{error}</p> : null}
      {message ? <p className="form-alert success" role="status">{message}</p> : null}
    </section>
  );
}

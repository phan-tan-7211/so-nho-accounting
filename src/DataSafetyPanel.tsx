import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { dataBackupService } from './dataBackup';
import type { BackupPreview } from './dataBackup';
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

interface PendingRestore {
  fileName: string;
  json: string;
  preview: BackupPreview;
}

export function DataSafetyPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ReleaseReadinessReport | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
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

  async function selectRestoreFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(null); setMessage(null); setPendingRestore(null);
    try {
      const json = await file.text();
      const preview = await dataBackupService.previewJson(json);
      setPendingRestore({ fileName: file.name, json, preview });
      setMessage('Backup đã qua kiểm tra checksum và schema. Hãy kiểm tra preview trước khi restore.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xác minh file backup.');
    } finally { setBusy(false); }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    const { preview } = pendingRestore;
    const currentSummary = report
      ? `${report.counts.accounts} tài khoản, ${report.counts.transactions} giao dịch, ${report.counts.partners} partner`
      : 'dữ liệu hiện tại';
    const accepted = window.confirm(
      `Restore sẽ THAY THẾ toàn bộ ${currentSummary} bằng backup có ${preview.counts.accounts} tài khoản, ${preview.counts.transactions} giao dịch, ${preview.counts.partners} partner và ${preview.counts.inventoryItems} item. Tiếp tục?`,
    );
    if (!accepted) return;

    setBusy(true); setError(null); setMessage(null);
    try {
      const envelope = await dataBackupService.restoreJson(pendingRestore.json);
      setPendingRestore(null);
      setMessage(`Restore thành công backup ${new Date(envelope.createdAt).toLocaleString('vi-VN')}. Dữ liệu đã được thay thế atomically.`);
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
        <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>Chọn backup để restore</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void scan()}>Quét readiness</button>
        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void selectRestoreFile(event)} />
      </div>

      {pendingRestore ? (
        <div className="settings-note" role="status" aria-live="polite">
          <strong>PREVIEW — backup đã xác minh</strong>
          <p>{pendingRestore.fileName} · DB v{pendingRestore.preview.databaseVersion} · {new Date(pendingRestore.preview.createdAt).toLocaleString('vi-VN')}</p>
          <p>{pendingRestore.preview.counts.accounts} tài khoản · {pendingRestore.preview.counts.transactions} giao dịch · {pendingRestore.preview.counts.partners} partner · {pendingRestore.preview.counts.inventoryItems} item · {pendingRestore.preview.lockedPeriods} kỳ khóa</p>
          <small>{pendingRestore.preview.totalRecords} records tổng cộng · SHA-256 {pendingRestore.preview.checksumSha256.slice(0, 16)}…</small>
          <div className="report-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void confirmRestore()}>Xác nhận thay thế dữ liệu</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setPendingRestore(null)}>Hủy preview</button>
          </div>
          <p><strong>Lưu ý:</strong> restore là replacement toàn bộ database. Nếu ghi lỗi giữa chừng, transaction rollback và dữ liệu hiện tại được giữ nguyên.</p>
        </div>
      ) : null}

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

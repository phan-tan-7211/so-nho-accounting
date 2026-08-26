import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import './PwaStatus.css';

export function PwaStatus() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    updateRef.current = registerSW({
      immediate: true,
      onOfflineReady() {
        setOfflineReady(true);
      },
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        timer = window.setInterval(() => {
          void registration.update().catch(() => undefined);
        }, 60 * 60 * 1000);
      },
    });
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  if (!offlineReady && !needRefresh) return null;

  return (
    <aside className="pwa-banner" role="status" aria-live="polite">
      <div>
        <strong>{needRefresh ? 'Có phiên bản mới' : 'Đã sẵn sàng dùng offline'}</strong>
        <small>
          {needRefresh
            ? 'Nên tạo backup trước khi cập nhật nếu đang ở giữa kỳ làm việc. Dữ liệu local vẫn nằm trong IndexedDB của trình duyệt.'
            : 'App shell đã được cache. Dữ liệu kế toán vẫn lưu local trên thiết bị này.'}
        </small>
      </div>
      <div className="pwa-banner__actions">
        {needRefresh ? (
          <button
            className="primary-button compact"
            type="button"
            onClick={() => void updateRef.current?.(true)}
          >
            Cập nhật & tải lại
          </button>
        ) : null}
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setOfflineReady(false);
            setNeedRefresh(false);
          }}
        >
          Đóng
        </button>
      </div>
    </aside>
  );
}

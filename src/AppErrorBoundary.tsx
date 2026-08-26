import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Sổ nhỏ UI failure', error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="fatal-error-shell" role="alert" aria-labelledby="fatal-error-title">
        <section className="fatal-error-card">
          <p className="eyebrow">Khôi phục an toàn</p>
          <h1 id="fatal-error-title">Không thể mở màn hình này</h1>
          <p>
            Dữ liệu kế toán local chưa bị xóa. Hãy tải lại ứng dụng; nếu lỗi lặp lại,
            không xóa dữ liệu trình duyệt trước khi kiểm tra bản backup gần nhất.
          </p>
          <button className="primary-button" type="button" onClick={this.reload}>
            Tải lại ứng dụng
          </button>
        </section>
      </main>
    );
  }
}

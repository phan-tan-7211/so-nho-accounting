/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenChild(): never {
  throw new Error('boom');
}

describe('AppErrorBoundary', () => {
  it('replaces a fatal child render with a Vietnamese recovery message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Dữ liệu kế toán local chưa bị xóa');
    expect(screen.getByRole('button', { name: 'Tải lại ứng dụng' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

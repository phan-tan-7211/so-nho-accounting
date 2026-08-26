// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./PwaStatus', () => ({ PwaStatus: () => null }));
vi.mock('./AccountingSettings', () => ({ AccountingSettings: () => <div>Cài đặt test</div> }));
vi.mock('./BooksWorkspace', () => ({ BooksWorkspace: () => <div>Sổ sách test</div> }));
vi.mock('./OverviewDashboard', () => ({
  OverviewDashboard: () => <div>Tổng quan test</div>,
}));
vi.mock('./TransactionWorkspace', () => ({
  TransactionWorkspace: () => <div>Giao dịch test</div>,
}));

import App from './App';

describe('App release stabilization interactions', () => {
  it('focuses the first quick action and closes the sheet with Escape', async () => {
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Thêm giao dịch' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Thêm giao dịch' });
    expect(dialog).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const firstAction = screen.getByRole('button', { name: /Bán thu tiền/ });
    await waitFor(() => expect(firstAction).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Thêm giao dịch' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the active primary navigation item with aria-current', async () => {
    render(<App />);
    await screen.findByText('Tổng quan test');
    expect(screen.getByRole('button', { name: /Tổng quan/ })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: /Sổ sách/ }));
    await screen.findByText('Sổ sách test');
    expect(screen.getByRole('button', { name: /Sổ sách/ })).toHaveAttribute('aria-current', 'page');
  });
});

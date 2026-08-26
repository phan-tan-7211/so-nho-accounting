import { TT58_INVENTORY_VALUATION_METHOD } from './inventory';
import type { Tt58ReportBundle } from './tt58ReportExport';

/**
 * Locked XLSX output must only use an S2c snapshot whose valuation method is
 * explicitly recorded as the TT58 period-average implementation. Legacy locked
 * snapshots remain fail-closed and must be unlocked/relocked sequentially.
 */
export function assertLockedTt58XlsxCompatibility(bundle: Tt58ReportBundle): void {
  const hasS2c = bundle.tables.some((table) => table.code === 'S2c-DNSN');
  if (!hasS2c) return;
  if (bundle.inventoryValuation?.method !== TT58_INVENTORY_VALUATION_METHOD) {
    throw new Error(
      'Chưa thể xuất XLSX S2c từ snapshot khóa cũ: snapshot chưa ghi nhận valuation TT58_PERIOD_AVERAGE_V1. Hãy mở khóa và khóa lại kỳ theo thứ tự thời gian để tái lập S2c bằng bình quân kỳ TT58.',
    );
  }
}

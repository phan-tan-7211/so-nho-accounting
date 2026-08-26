import type { Tt58ReportBundle } from './tt58ReportExport';

/**
 * A locked XLSX is presented as a finalized TT58-formatted accounting output.
 * S2c is intentionally blocked for now: the current inventory subledger stores
 * explicit unit cost per movement, while TT58 S2c prescribes a period-average
 * outbound unit-price formula. We must not silently recalculate or relabel the
 * locked accounting snapshot merely for export.
 */
export function assertLockedTt58XlsxCompatibility(bundle: Tt58ReportBundle): void {
  if (bundle.tables.some((table) => table.code === 'S2c-DNSN')) {
    throw new Error(
      'Chưa thể xuất XLSX S2c từ kỳ đã khóa: TT58 quy định đơn giá xuất kho theo bình quân của tồn đầu kỳ và nhập trong kỳ, trong khi inventory V1 đang lưu đơn giá movement explicit. Hãy dùng XLSX nháp/CSV để đối chiếu; cần nâng valuation domain trước khi phát hành S2c locked XLSX.',
    );
  }
}

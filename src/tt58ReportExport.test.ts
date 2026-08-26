import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import type { AccountingProfile } from './accountingProfile';
import type { Tt58RuntimeBookCapability } from './tt58CapabilityReadiness';
import type { Tt58FinalMaterializedBooks } from './tt58TaxSettledBooks';
import {
  buildTt58ReportBundle,
  canonicalReportJson,
  reportTableToCsv,
} from './tt58ReportExport';

const profile: AccountingProfile = {
  id: 'primary',
  regime: TT58_REGIME,
  entityType: 'MICRO_ENTERPRISE',
  dataStartDate: '2026-07-01',
  taxProfileConfigured: true,
  vatMethod: 'PERCENT_ON_REVENUE',
  incomeTaxMethod: 'PERCENT_ON_REVENUE',
  createdAt: 1,
  updatedAt: 1,
};

const implementedS1: Tt58RuntimeBookCapability = {
  code: 'S1-DNSN',
  name: 'Sổ doanh thu bán hàng hóa, dịch vụ',
  required: true,
  supplementary: false,
  status: 'IMPLEMENTED',
  blockers: [],
};

const s1Books: Tt58FinalMaterializedBooks = {
  s1: {
    code: 'S1-DNSN',
    status: 'IMPLEMENTED',
    issues: [],
    groups: [{
      activityLabel: 'Bán hàng',
      vatRevenueRate: 1,
      incomeTaxRevenueRate: 2,
      rows: [{
        transactionId: 'tx-1',
        date: new Date(2026, 6, 3, 12).getTime(),
        documentNumber: 'HD,01',
        description: 'Bán "A"',
        activityLabel: 'Bán hàng',
        taxRevenueAmount: 1_000_000,
        vatRevenueRate: 1,
        incomeTaxRevenueRate: 2,
      }],
      totalRevenue: 1_000_000,
      vatTaxDue: 10_000,
      incomeTaxDue: 20_000,
    }],
    totalRevenue: 1_000_000,
    totalVatTaxDue: 10_000,
    totalIncomeTaxDue: 20_000,
  },
};

const period = {
  start: new Date(2026, 6, 1, 0).getTime(),
  end: new Date(2026, 7, 1, 0).getTime() - 1,
};

describe('TT58 deterministic report export', () => {
  it('builds the same canonical snapshot for the same implemented books', () => {
    const first = buildTt58ReportBundle({
      profile,
      capabilities: [implementedS1],
      materializedBooks: s1Books,
      period,
    });
    const second = buildTt58ReportBundle({
      profile,
      capabilities: [{ ...implementedS1 }],
      materializedBooks: s1Books,
      period: { ...period },
    });

    expect(canonicalReportJson(first)).toBe(canonicalReportJson(second));
    expect(first.tables).toHaveLength(1);
    expect(first.tables[0]?.code).toBe('S1-DNSN');
    expect(first.tables[0]?.rows.at(-1)).toEqual([
      'TOTAL', '', '', '', '', 1_000_000, 10_000, 20_000,
    ]);
  });

  it('emits UTF-8 BOM CSV and escapes comma/quotes deterministically', () => {
    const report = buildTt58ReportBundle({
      profile,
      capabilities: [implementedS1],
      materializedBooks: s1Books,
      period,
    });
    const csv = reportTableToCsv(report.tables[0]!);
    expect(csv.startsWith('\uFEFFrowType,date')).toBe(true);
    expect(csv).toContain('"HD,01"');
    expect(csv).toContain('"Bán ""A"""');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('refuses to finalize a required book that is still partial or planned', () => {
    const partial: Tt58RuntimeBookCapability = {
      ...implementedS1,
      status: 'PARTIAL',
      blockers: ['Thiếu dữ liệu'],
    };
    expect(() => buildTt58ReportBundle({
      profile,
      capabilities: [partial],
      materializedBooks: s1Books,
      period,
    })).toThrow(/S1-DNSN is PARTIAL/);

    const planned: Tt58RuntimeBookCapability = {
      code: 'S2c-DNSN',
      name: 'Tồn kho',
      required: true,
      supplementary: false,
      status: 'PLANNED',
      blockers: ['Cần inventory domain'],
    };
    expect(() => buildTt58ReportBundle({
      profile: { ...profile, incomeTaxMethod: 'TAXABLE_INCOME' },
      capabilities: [planned],
      materializedBooks: {},
      period,
    })).toThrow(/S2c-DNSN is PLANNED/);
  });
});

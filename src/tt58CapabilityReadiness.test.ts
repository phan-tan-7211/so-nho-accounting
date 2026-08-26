import { describe, expect, it } from 'vitest';
import { TT58_REGIME } from './accountingProfile';
import { getTt58BookCapabilities } from './tt58BookProjections';
import { applyMaterializedBookReadiness } from './tt58CapabilityReadiness';
import type { AccountingProfile } from './accountingProfile';
import type { Tt58MaterializedBooks } from './tt58MaterializedBooks';

function profile(): AccountingProfile {
  return {
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
}

describe('TT58 capability readiness', () => {
  it('upgrades S1 to IMPLEMENTED only when the materialized S1 book is implemented', () => {
    const books: Tt58MaterializedBooks = {
      s1: {
        code: 'S1-DNSN',
        status: 'IMPLEMENTED',
        issues: [],
        groups: [],
        totalRevenue: 0,
        totalVatTaxDue: 0,
        totalIncomeTaxDue: 0,
      },
    };

    const capabilities = applyMaterializedBookReadiness(
      getTt58BookCapabilities(profile()),
      books,
    );
    const s1 = capabilities.find((book) => book.code === 'S1-DNSN');

    expect(s1).toMatchObject({
      required: true,
      status: 'IMPLEMENTED',
      blockers: [],
    });
  });

  it('uses concrete materialization issues as blockers instead of stale generic blockers', () => {
    const books: Tt58MaterializedBooks = {
      s1: {
        code: 'S1-DNSN',
        status: 'PARTIAL',
        issues: [{
          code: 'MISSING_TAX_REVENUE_AMOUNT',
          message: 'Explicit tax revenue base is missing',
          transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }],
        groups: [],
        totalRevenue: 0,
        totalVatTaxDue: 0,
        totalIncomeTaxDue: 0,
      },
    };

    const capabilities = applyMaterializedBookReadiness(
      getTt58BookCapabilities(profile()),
      books,
    );
    const s1 = capabilities.find((book) => book.code === 'S1-DNSN');

    expect(s1?.status).toBe('PARTIAL');
    expect(s1?.blockers).toEqual(['Explicit tax revenue base is missing']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AccountingProfileSchema,
  getRequiredTt58Books,
  getTt58ApplicationBasis,
} from './accountingProfile';

const now = Date.now();

const base = {
  id: 'primary' as const,
  regime: 'TT58_2026_MICRO' as const,
  taxProfileConfigured: false,
  vatMethod: 'UNCONFIGURED' as const,
  incomeTaxMethod: 'UNCONFIGURED' as const,
  createdAt: now,
  updatedAt: now,
};

describe('AccountingProfileSchema — TT58 only', () => {
  it.each([
    'MICRO_ENTERPRISE',
    'HOUSEHOLD_BUSINESS',
    'INDIVIDUAL_BUSINESS',
  ] as const)('accepts supported entity type %s from 2026-07-01', (entityType) => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      entityType,
      dataStartDate: '2026-07-01',
    });

    expect(result.success).toBe(true);
  });

  it('rejects TT58 data starting before 2026-07-01', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-06-30',
    });

    expect(result.success).toBe(false);
  });

  it('rejects legacy or out-of-scope accounting regimes', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT133_2016_SME',
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-07-01',
    });

    expect(result.success).toBe(false);
  });

  it('keeps tax methods explicitly unconfigured until both are confirmed', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-07-01',
      vatMethod: 'DEDUCTION',
    });

    expect(result.success).toBe(false);
  });

  it('requires both tax methods when tax profile is configured', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-07-01',
      taxProfileConfigured: true,
      vatMethod: 'DEDUCTION',
    });

    expect(result.success).toBe(false);
  });
});

describe('TT58 application basis', () => {
  it('treats micro enterprise as direct TT58 scope', () => {
    expect(getTt58ApplicationBasis('MICRO_ENTERPRISE')).toBe('DIRECT_SCOPE');
  });

  it.each(['HOUSEHOLD_BUSINESS', 'INDIVIDUAL_BUSINESS'] as const)(
    'treats %s as voluntary TT58 election',
    (entityType) => {
      expect(getTt58ApplicationBasis(entityType)).toBe('VOLUNTARY_ELECTION');
    },
  );
});

describe('TT58 required book mapping', () => {
  it('returns no books while tax profile is unconfigured', () => {
    expect(getRequiredTt58Books(base)).toEqual([]);
  });

  it('maps percent VAT + percent income tax to S1-DNSN', () => {
    expect(getRequiredTt58Books({
      taxProfileConfigured: true,
      vatMethod: 'PERCENT_ON_REVENUE',
      incomeTaxMethod: 'PERCENT_ON_REVENUE',
    })).toEqual(['S1-DNSN']);
  });

  it('maps percent VAT + taxable income to S2a-S2d', () => {
    expect(getRequiredTt58Books({
      taxProfileConfigured: true,
      vatMethod: 'PERCENT_ON_REVENUE',
      incomeTaxMethod: 'TAXABLE_INCOME',
    })).toEqual(['S2a-DNSN', 'S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN']);
  });

  it('maps deduction VAT + percent income tax to S3a-S3b', () => {
    expect(getRequiredTt58Books({
      taxProfileConfigured: true,
      vatMethod: 'DEDUCTION',
      incomeTaxMethod: 'PERCENT_ON_REVENUE',
    })).toEqual(['S3a-DNSN', 'S3b-DNSN']);
  });

  it('maps deduction VAT + taxable income to S2b/S2c/S2d/S3b', () => {
    expect(getRequiredTt58Books({
      taxProfileConfigured: true,
      vatMethod: 'DEDUCTION',
      incomeTaxMethod: 'TAXABLE_INCOME',
    })).toEqual(['S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN', 'S3b-DNSN']);
  });
});

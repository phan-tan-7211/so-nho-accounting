import { describe, expect, it } from 'vitest';
import { AccountingProfileSchema } from './accountingProfile';

const now = Date.now();

const base = {
  id: 'primary' as const,
  taxProfileConfigured: false,
  vatMethod: 'UNCONFIGURED' as const,
  incomeTaxMethod: 'UNCONFIGURED' as const,
  createdAt: now,
  updatedAt: now,
};

describe('AccountingProfileSchema', () => {
  it('accepts TT152 for household business from 2026-01-01', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT152_2025_HKD',
      entityType: 'HOUSEHOLD_BUSINESS',
      dataStartDate: '2026-01-01',
    });

    expect(result.success).toBe(true);
  });

  it('rejects TT152 for an enterprise entity', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT152_2025_HKD',
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-01-01',
    });

    expect(result.success).toBe(false);
  });

  it('accepts voluntary TT58 selection for household business from 2026-07-01', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT58_2026_MICRO',
      entityType: 'HOUSEHOLD_BUSINESS',
      dataStartDate: '2026-07-01',
    });

    expect(result.success).toBe(true);
  });

  it('rejects TT58 data starting before 2026-07-01', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT58_2026_MICRO',
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-06-30',
    });

    expect(result.success).toBe(false);
  });

  it('accepts TT133 for small enterprise', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT133_2016_SME',
      entityType: 'SMALL_ENTERPRISE',
      dataStartDate: '2026-01-01',
    });

    expect(result.success).toBe(true);
  });

  it('keeps tax methods explicitly unconfigured until user confirms them', () => {
    const result = AccountingProfileSchema.safeParse({
      ...base,
      regime: 'TT58_2026_MICRO',
      entityType: 'MICRO_ENTERPRISE',
      dataStartDate: '2026-07-01',
      vatMethod: 'DEDUCTION',
    });

    expect(result.success).toBe(false);
  });
});

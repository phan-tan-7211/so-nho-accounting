import { z } from 'zod';

export const TT58_REGIME = 'TT58_2026_MICRO' as const;
export const TT58_EFFECTIVE_FROM = '2026-07-01' as const;

export const AccountingRegimeSchema = z.literal(TT58_REGIME);
export type AccountingRegime = z.infer<typeof AccountingRegimeSchema>;

export const EntityTypeSchema = z.enum([
  'HOUSEHOLD_BUSINESS',
  'INDIVIDUAL_BUSINESS',
  'MICRO_ENTERPRISE',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const VatMethodSchema = z.enum([
  'UNCONFIGURED',
  'PERCENT_ON_REVENUE',
  'DEDUCTION',
]);
export type VatMethod = z.infer<typeof VatMethodSchema>;

export const IncomeTaxMethodSchema = z.enum([
  'UNCONFIGURED',
  'PERCENT_ON_REVENUE',
  'TAXABLE_INCOME',
]);
export type IncomeTaxMethod = z.infer<typeof IncomeTaxMethodSchema>;

export const Tt58BookCodeSchema = z.enum([
  'S1-DNSN',
  'S2a-DNSN',
  'S2b-DNSN',
  'S2c-DNSN',
  'S2d-DNSN',
  'S3a-DNSN',
  'S3b-DNSN',
]);
export type Tt58BookCode = z.infer<typeof Tt58BookCodeSchema>;

export type Tt58ApplicationBasis = 'DIRECT_SCOPE' | 'VOLUNTARY_ELECTION';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const AccountingProfileSchema = z.object({
  id: z.literal('primary'),
  regime: AccountingRegimeSchema,
  entityType: EntityTypeSchema,
  dataStartDate: z.string().regex(DATE_ONLY, 'Ngày bắt đầu phải có định dạng YYYY-MM-DD'),
  taxProfileConfigured: z.boolean().default(false),
  vatMethod: VatMethodSchema.default('UNCONFIGURED'),
  incomeTaxMethod: IncomeTaxMethodSchema.default('UNCONFIGURED'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((profile, ctx) => {
  if (profile.dataStartDate < TT58_EFFECTIVE_FROM) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataStartDate'],
      message: `TT58 được cấu hình cho dữ liệu bắt đầu từ ${TT58_EFFECTIVE_FROM} trở đi`,
    });
  }

  const vatConfigured = profile.vatMethod !== 'UNCONFIGURED';
  const incomeTaxConfigured = profile.incomeTaxMethod !== 'UNCONFIGURED';

  if (!profile.taxProfileConfigured) {
    if (vatConfigured || incomeTaxConfigured) {
      ctx.addIssue({
        code: 'custom',
        path: ['taxProfileConfigured'],
        message: 'Khi hồ sơ thuế chưa xác nhận, cả hai phương pháp thuế phải ở trạng thái chưa cấu hình',
      });
    }
  } else if (!vatConfigured || !incomeTaxConfigured) {
    ctx.addIssue({
      code: 'custom',
      path: ['taxProfileConfigured'],
      message: 'Cần chọn đầy đủ phương pháp thuế GTGT và thuế thu nhập trước khi xác nhận hồ sơ thuế',
    });
  }
});

export type AccountingProfile = z.infer<typeof AccountingProfileSchema>;

export const ACCOUNTING_REGIME_INFO = {
  shortLabel: 'TT58/2026',
  title: 'Chế độ kế toán TT58/2026',
  description: 'Dành cho doanh nghiệp siêu nhỏ; hộ kinh doanh và cá nhân kinh doanh có nhu cầu có thể lựa chọn áp dụng.',
  effectiveFrom: TT58_EFFECTIVE_FROM,
} as const;

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  HOUSEHOLD_BUSINESS: 'Hộ kinh doanh',
  INDIVIDUAL_BUSINESS: 'Cá nhân kinh doanh',
  MICRO_ENTERPRISE: 'Doanh nghiệp siêu nhỏ',
};

export const VAT_METHOD_LABELS: Record<VatMethod, string> = {
  UNCONFIGURED: 'Chưa cấu hình',
  PERCENT_ON_REVENUE: 'Tỷ lệ % trên doanh thu',
  DEDUCTION: 'Khấu trừ',
};

export const INCOME_TAX_METHOD_LABELS: Record<IncomeTaxMethod, string> = {
  UNCONFIGURED: 'Chưa cấu hình',
  PERCENT_ON_REVENUE: 'Tỷ lệ % trên doanh thu',
  TAXABLE_INCOME: 'Thu nhập tính thuế',
};

export function getAllowedEntityTypes(): readonly EntityType[] {
  return EntityTypeSchema.options;
}

export function getTt58ApplicationBasis(entityType: EntityType): Tt58ApplicationBasis {
  return entityType === 'MICRO_ENTERPRISE' ? 'DIRECT_SCOPE' : 'VOLUNTARY_ELECTION';
}

export function getRequiredTt58Books(
  profile: Pick<AccountingProfile, 'taxProfileConfigured' | 'vatMethod' | 'incomeTaxMethod'>,
): readonly Tt58BookCode[] {
  if (!profile.taxProfileConfigured) return [];

  if (profile.vatMethod === 'PERCENT_ON_REVENUE') {
    if (profile.incomeTaxMethod === 'PERCENT_ON_REVENUE') {
      return ['S1-DNSN'];
    }

    if (profile.incomeTaxMethod === 'TAXABLE_INCOME') {
      return ['S2a-DNSN', 'S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN'];
    }
  }

  if (profile.vatMethod === 'DEDUCTION') {
    if (profile.incomeTaxMethod === 'PERCENT_ON_REVENUE') {
      return ['S3a-DNSN', 'S3b-DNSN'];
    }

    if (profile.incomeTaxMethod === 'TAXABLE_INCOME') {
      return ['S2b-DNSN', 'S2c-DNSN', 'S2d-DNSN', 'S3b-DNSN'];
    }
  }

  return [];
}

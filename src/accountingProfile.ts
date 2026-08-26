import { z } from 'zod';

export const AccountingRegimeSchema = z.enum([
  'TT152_2025_HKD',
  'TT58_2026_MICRO',
  'TT133_2016_SME',
]);
export type AccountingRegime = z.infer<typeof AccountingRegimeSchema>;

export const EntityTypeSchema = z.enum([
  'HOUSEHOLD_BUSINESS',
  'INDIVIDUAL_BUSINESS',
  'MICRO_ENTERPRISE',
  'SMALL_ENTERPRISE',
  'MEDIUM_ENTERPRISE',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const VatMethodSchema = z.enum([
  'UNCONFIGURED',
  'NOT_APPLICABLE',
  'PERCENT_ON_REVENUE',
  'DEDUCTION',
]);
export type VatMethod = z.infer<typeof VatMethodSchema>;

export const IncomeTaxMethodSchema = z.enum([
  'UNCONFIGURED',
  'NOT_APPLICABLE',
  'PERCENT_ON_REVENUE',
  'TAXABLE_INCOME',
]);
export type IncomeTaxMethod = z.infer<typeof IncomeTaxMethodSchema>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const regimeEffectiveFrom: Record<AccountingRegime, string> = {
  TT152_2025_HKD: '2026-01-01',
  TT58_2026_MICRO: '2026-07-01',
  TT133_2016_SME: '2017-01-01',
};

const regimeEntityTypes: Record<AccountingRegime, readonly EntityType[]> = {
  TT152_2025_HKD: ['HOUSEHOLD_BUSINESS', 'INDIVIDUAL_BUSINESS'],
  TT58_2026_MICRO: ['HOUSEHOLD_BUSINESS', 'INDIVIDUAL_BUSINESS', 'MICRO_ENTERPRISE'],
  TT133_2016_SME: ['MICRO_ENTERPRISE', 'SMALL_ENTERPRISE', 'MEDIUM_ENTERPRISE'],
};

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
  if (!regimeEntityTypes[profile.regime].includes(profile.entityType)) {
    ctx.addIssue({
      code: 'custom',
      path: ['entityType'],
      message: 'Loại hình đơn vị không phù hợp với chế độ kế toán đã chọn',
    });
  }

  if (profile.dataStartDate < regimeEffectiveFrom[profile.regime]) {
    ctx.addIssue({
      code: 'custom',
      path: ['dataStartDate'],
      message: `Chế độ này áp dụng cho dữ liệu bắt đầu từ ${regimeEffectiveFrom[profile.regime]} trở đi`,
    });
  }

  if (!profile.taxProfileConfigured) {
    if (profile.vatMethod !== 'UNCONFIGURED' || profile.incomeTaxMethod !== 'UNCONFIGURED') {
      ctx.addIssue({
        code: 'custom',
        path: ['taxProfileConfigured'],
        message: 'Không lưu phương pháp thuế khi hồ sơ thuế chưa được xác nhận',
      });
    }
  } else if (profile.vatMethod === 'UNCONFIGURED' || profile.incomeTaxMethod === 'UNCONFIGURED') {
    ctx.addIssue({
      code: 'custom',
      path: ['taxProfileConfigured'],
      message: 'Cần chọn đầy đủ phương pháp thuế trước khi đánh dấu đã cấu hình',
    });
  }
});

export type AccountingProfile = z.infer<typeof AccountingProfileSchema>;

export const ACCOUNTING_REGIME_INFO: Record<AccountingRegime, {
  shortLabel: string;
  title: string;
  description: string;
  effectiveFrom: string;
  implementation: 'FOUNDATION' | 'PLANNED';
}> = {
  TT152_2025_HKD: {
    shortLabel: 'TT152/2025',
    title: 'Hộ / cá nhân kinh doanh',
    description: 'Chế độ kế toán mặc định cho HKD, CNKD từ 01/01/2026.',
    effectiveFrom: regimeEffectiveFrom.TT152_2025_HKD,
    implementation: 'FOUNDATION',
  },
  TT58_2026_MICRO: {
    shortLabel: 'TT58/2026',
    title: 'Doanh nghiệp siêu nhỏ',
    description: 'DNSN; HKD/CNKD có nhu cầu có thể lựa chọn áp dụng.',
    effectiveFrom: regimeEffectiveFrom.TT58_2026_MICRO,
    implementation: 'FOUNDATION',
  },
  TT133_2016_SME: {
    shortLabel: 'TT133/2016',
    title: 'Doanh nghiệp nhỏ và vừa',
    description: 'Chế độ kế toán cho DNNVV, bao gồm phạm vi nghiệp vụ/BCTC rộng hơn V1.',
    effectiveFrom: regimeEffectiveFrom.TT133_2016_SME,
    implementation: 'PLANNED',
  },
};

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  HOUSEHOLD_BUSINESS: 'Hộ kinh doanh',
  INDIVIDUAL_BUSINESS: 'Cá nhân kinh doanh',
  MICRO_ENTERPRISE: 'Doanh nghiệp siêu nhỏ',
  SMALL_ENTERPRISE: 'Doanh nghiệp nhỏ',
  MEDIUM_ENTERPRISE: 'Doanh nghiệp vừa',
};

export function getAllowedEntityTypes(regime: AccountingRegime): readonly EntityType[] {
  return regimeEntityTypes[regime];
}

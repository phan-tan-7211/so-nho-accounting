import { z } from 'zod';
import { TaxTypeSchema } from './models';
import type { TaxType } from './models';

export interface TaxOpeningPosition {
  id: string;
  taxType: TaxType;
  periodStart: number;
  amount: number;
  createdAt: number;
  updatedAt: number;
}

export const TaxOpeningPositionSchema = z.object({
  id: z.string().min(1),
  taxType: TaxTypeSchema,
  periodStart: z.number().finite(),
  // Signed net position: positive = tax payable; negative = tax credit/refundable.
  amount: z.number().int().refine(Number.isSafeInteger, 'Tax opening amount must be a safe VND integer'),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.id !== taxOpeningPositionId(value.taxType, value.periodStart)) {
    ctx.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'Tax opening position id must be deterministic for tax type and period start',
    });
  }
});

export function taxOpeningPositionId(taxType: TaxType, periodStart: number): string {
  if (!Number.isFinite(periodStart)) throw new Error('periodStart must be finite');
  return `${taxType}:${periodStart}`;
}

export function createTaxOpeningPosition(input: {
  taxType: TaxType;
  periodStart: number;
  amount: number;
  now: number;
}): TaxOpeningPosition {
  const record: TaxOpeningPosition = {
    id: taxOpeningPositionId(input.taxType, input.periodStart),
    taxType: input.taxType,
    periodStart: input.periodStart,
    amount: input.amount,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return TaxOpeningPositionSchema.parse(record);
}

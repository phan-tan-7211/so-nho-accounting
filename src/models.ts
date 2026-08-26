import { z } from 'zod';

export const TransactionType = {
  // V1 semantic transaction types. New accounting code should use these values.
  CASH_SALE: 'CASH_SALE',
  CREDIT_SALE: 'CREDIT_SALE',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  CASH_PURCHASE: 'CASH_PURCHASE',
  CREDIT_PURCHASE: 'CREDIT_PURCHASE',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  TRANSFER: 'TRANSFER',
  CAPITAL_CONTRIBUTION: 'CAPITAL_CONTRIBUTION',
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',
  SUPPLIER_REFUND: 'SUPPLIER_REFUND',
  REVERSAL: 'REVERSAL',

  // Legacy values remain readable so existing IndexedDB records are preserved.
  // They must not be silently reinterpreted by the new accounting-effects core.
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  REFUND: 'REFUND',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  balance: z.number().default(0), // Legacy cached balance; not the future source of truth.
  createdAt: z.number(),
});
export type Account = z.infer<typeof AccountSchema>;

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  date: z.number(), // Timestamp
  amount: z.number().min(0),
  type: z.nativeEnum(TransactionType),

  // Relationships
  sourceAccountId: z.string().uuid().optional(),
  destinationAccountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
  reversalOfTransactionId: z.string().uuid().optional(),

  description: z.string().optional(),
  notes: z.string().optional(),

  // VAT. `amount` is the gross amount for semantic sale/purchase/refund events.
  amountBeforeVat: z.number().optional(),
  vatRate: z.number().optional(),
  vatAmount: z.number().optional(),
  invoiceNumber: z.string().optional(),

  status: z.enum(['DRAFT', 'POSTED', 'REVERSED']).default('POSTED'),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  action: z.enum(['CREATE', 'UPDATE', 'REVERSE']),
  timestamp: z.number(),
  details: z.string(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// Need simpler models for settings, period_locks, etc.

import { z } from 'zod';

export const TransactionType = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  TRANSFER: 'TRANSFER',
  CAPITAL_CONTRIBUTION: 'CAPITAL_CONTRIBUTION',
  REFUND: 'REFUND',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;
export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

export const AccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  balance: z.number().default(0), // Cached balance
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
  
  description: z.string().optional(),
  notes: z.string().optional(),
  
  // VAT
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

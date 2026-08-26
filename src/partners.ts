import { z } from 'zod';
import type { AccountingDB } from './db';
import { db } from './db';
import { TransactionType } from './models';
import type { TransactionType as TransactionTypeValue } from './models';

export const PartnerKind = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
  BOTH: 'BOTH',
} as const;
export type PartnerKind = typeof PartnerKind[keyof typeof PartnerKind];

export const PartnerSchema = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.nativeEnum(PartnerKind),
  taxCode: z.string().trim().min(1).optional(),
  active: z.boolean().default(true),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type Partner = z.infer<typeof PartnerSchema>;

export interface CreatePartnerInput {
  code: string;
  name: string;
  kind: PartnerKind;
  taxCode?: string;
}

const CUSTOMER_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CREDIT_SALE,
  TransactionType.CUSTOMER_PAYMENT,
  TransactionType.CUSTOMER_REFUND,
]);
const SUPPLIER_TYPES = new Set<TransactionTypeValue>([
  TransactionType.CREDIT_PURCHASE,
  TransactionType.SUPPLIER_PAYMENT,
  TransactionType.SUPPLIER_REFUND,
]);

export function requiredPartnerRole(type: TransactionTypeValue): Exclude<PartnerKind, 'BOTH'> | undefined {
  if (CUSTOMER_TYPES.has(type)) return PartnerKind.CUSTOMER;
  if (SUPPLIER_TYPES.has(type)) return PartnerKind.SUPPLIER;
  return undefined;
}

export function partnerSupportsTransaction(partner: Partner, type: TransactionTypeValue): boolean {
  const required = requiredPartnerRole(type);
  if (!required) return true;
  return partner.kind === PartnerKind.BOTH || partner.kind === required;
}

export class PartnerService {
  private readonly database: AccountingDB;

  constructor(database: AccountingDB) {
    this.database = database;
  }

  async create(input: CreatePartnerInput): Promise<Partner> {
    const now = Date.now();
    const partner = PartnerSchema.parse({
      id: crypto.randomUUID(),
      code: input.code,
      name: input.name,
      kind: input.kind,
      taxCode: input.taxCode?.trim() || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return this.database.transaction('rw', this.database.partners, async () => {
      if (await this.database.partners.where('code').equals(partner.code).first()) {
        throw new Error(`Partner code ${partner.code} already exists`);
      }
      await this.database.partners.add(partner);
      return partner;
    });
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const partner = await this.database.partners.get(id);
    if (!partner) throw new Error(`Partner ${id} not found`);
    await this.database.partners.update(id, { active, updatedAt: Date.now() });
  }

  async assertUsableForTransaction(partnerId: string, type: TransactionTypeValue): Promise<Partner> {
    const partner = await this.database.partners.get(partnerId);
    if (!partner) throw new Error(`Partner ${partnerId} not found`);
    if (!partner.active) throw new Error(`Partner ${partner.code} is inactive`);
    if (!partnerSupportsTransaction(partner, type)) {
      throw new Error(`Partner ${partner.code} is incompatible with transaction ${type}`);
    }
    return partner;
  }
}

export const partnerService = new PartnerService(db);

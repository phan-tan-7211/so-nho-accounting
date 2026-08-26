import { describe, expect, it } from 'vitest';
import { TransactionType } from './models';
import { PartnerKind, partnerSupportsTransaction, requiredPartnerRole } from './partners';
import type { Partner } from './partners';

const base: Partner = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'P-01',
  name: 'Đối tác',
  kind: PartnerKind.CUSTOMER,
  active: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('partner transaction roles', () => {
  it('maps customer and supplier debt events explicitly', () => {
    expect(requiredPartnerRole(TransactionType.CREDIT_SALE)).toBe(PartnerKind.CUSTOMER);
    expect(requiredPartnerRole(TransactionType.CUSTOMER_PAYMENT)).toBe(PartnerKind.CUSTOMER);
    expect(requiredPartnerRole(TransactionType.CREDIT_PURCHASE)).toBe(PartnerKind.SUPPLIER);
    expect(requiredPartnerRole(TransactionType.SUPPLIER_PAYMENT)).toBe(PartnerKind.SUPPLIER);
    expect(requiredPartnerRole(TransactionType.TRANSFER)).toBeUndefined();
  });

  it('allows BOTH while rejecting a role mismatch', () => {
    expect(partnerSupportsTransaction(base, TransactionType.CREDIT_SALE)).toBe(true);
    expect(partnerSupportsTransaction(base, TransactionType.CREDIT_PURCHASE)).toBe(false);
    expect(partnerSupportsTransaction({ ...base, kind: PartnerKind.BOTH }, TransactionType.CREDIT_PURCHASE)).toBe(true);
  });
});

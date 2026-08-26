# Corrected Architecture Plan — TT58 Upgrade

## 1. Current Unauthorized Changes

The previous agent made several unauthorized changes that must be reverted or cleaned up before proceeding.
- **Modified files:**
  - `src/models.ts` (added new schemas and extended types directly)
  - `src/db.ts` (implemented Dexie v2 upgrade directly)
  - `tsconfig.app.json` (modified strictness settings, e.g. `"strict": false`, `"noImplicitAny": false`)
  - `vite.config.ts` (added PWA plugin directly)
  - `package.json` / `package-lock.json`
- **Created files:**
  - `src/accounting/balance.ts`
  - `src/accounting/balance.test.ts`
- **Created artifacts (in brain):**
  - `architecture_review.md`
  - `task.md`

**Action:** We must reset the git state to undo these changes (`git checkout .`, `git clean -fd`) before starting Phase 1 properly.

---

## 2. Problems Found in Current Implementation

- **Hard-coded transaction effects in `engine.ts`**: The legacy engine manually checks `newTx.type === 'INCOME'` and mutates `account.balance`. It doesn't handle `REFUND` or `ADJUSTMENT`.
- **Negative Opening Balance Bug**: The previous agent's `balance.ts` assumed that an overdraft (negative opening balance) would be set on `sourceAccountId` for an `OPENING_BALANCE` transaction. This is a hack.
- **Inflexible Balance Calculation**: The attempt to use `POSITIVE_DEST_TYPES` and `NEGATIVE_SRC_TYPES` is rigid and cannot represent complex double-entry effects (like credit sales where revenue increases, receivable increases, but cash does not).
- **Missing Effect Layer**: Transactions do not generate deterministic accounting effects.

---

## 3. Minimal Transaction Model

We need a stable enum for `TransactionType`. Instead of just adding a bunch of types, we need a core set that covers the TT58 requirements.

```typescript
type TransactionType =
  // Cash / Bank
  | 'OPENING_BALANCE'
  | 'CAPITAL_CONTRIBUTION'
  | 'SALE_CASH'       // Bán hàng thu ngay (Legacy INCOME maps here)
  | 'PURCHASE_CASH'   // Mua hàng trả ngay (Legacy EXPENSE maps here)
  | 'TRANSFER'
  // Receivables / Payables (Credit)
  | 'SALE_CREDIT'     // Bán chịu
  | 'CUSTOMER_PAYMENT'// Thu nợ
  | 'PURCHASE_CREDIT' // Mua chịu
  | 'SUPPLIER_PAYMENT'// Trả nợ
  // Adjustments & Refunds
  | 'CUSTOMER_REFUND' // Hoàn tiền cho khách (cash out)
  | 'SUPPLIER_REFUND' // Nhà cung cấp hoàn tiền (cash in)
  | 'ADJUSTMENT'
  | 'REVERSAL'
```

---

## 4. AccountingEffect Model

An accounting effect represents a specific economic impact derived from a transaction.

```typescript
type EffectType =
  | 'CASH'
  | 'REVENUE'
  | 'EXPENSE'
  | 'VAT_INPUT'
  | 'VAT_OUTPUT'
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'EQUITY'

interface AccountingEffect {
  type: EffectType;
  amount: number; // Positive increases the conceptual balance, negative decreases it
  accountId?: string; // Required for CASH
  partnerId?: string; // Required for RECEIVABLE / PAYABLE
}
```

---

## 5. `deriveAccountingEffects()` Design

Instead of mapping types to `source/dest`, we define a pure function that takes a transaction and returns an array of effects.

```typescript
function deriveAccountingEffects(tx: Transaction): AccountingEffect[] {
  const effects: AccountingEffect[] = [];
  const base = tx.amountBeforeVat ?? tx.amount;
  const vat = tx.vatAmount ?? 0;

  switch (tx.type) {
    case 'SALE_CASH':
      effects.push({ type: 'CASH', amount: tx.amount, accountId: tx.destinationAccountId });
      effects.push({ type: 'REVENUE', amount: base });
      if (vat > 0) effects.push({ type: 'VAT_OUTPUT', amount: vat });
      break;

    case 'SALE_CREDIT':
      effects.push({ type: 'RECEIVABLE', amount: tx.amount, partnerId: tx.partnerId });
      effects.push({ type: 'REVENUE', amount: base });
      if (vat > 0) effects.push({ type: 'VAT_OUTPUT', amount: vat });
      break;

    case 'CUSTOMER_PAYMENT':
      effects.push({ type: 'CASH', amount: tx.amount, accountId: tx.destinationAccountId });
      effects.push({ type: 'RECEIVABLE', amount: -tx.amount, partnerId: tx.partnerId });
      break;

    case 'PURCHASE_CASH':
      effects.push({ type: 'CASH', amount: -tx.amount, accountId: tx.sourceAccountId });
      effects.push({ type: 'EXPENSE', amount: base });
      if (vat > 0 && tx.vatDeductible) effects.push({ type: 'VAT_INPUT', amount: vat });
      break;

    case 'TRANSFER':
      effects.push({ type: 'CASH', amount: -tx.amount, accountId: tx.sourceAccountId });
      effects.push({ type: 'CASH', amount: tx.amount, accountId: tx.destinationAccountId });
      break;

    case 'OPENING_BALANCE':
      effects.push({ type: 'CASH', amount: tx.amount, accountId: tx.destinationAccountId });
      effects.push({ type: 'EQUITY', amount: tx.amount });
      break;

    case 'REVERSAL':
      // The engine will fetch the original transaction and negate its effects
      break;
      
    // ... handling other types
  }
  return effects;
}
```

---

## 6. Derive vs Persist Decision

**Decision: DERIVE EFFECTS AT RUNTIME.**

**Reasons:**
1. **Correctness & Determinism:** The `deriveAccountingEffects` function is pure. Given a transaction, its effects are always calculated consistently. If rules change (e.g., bug fix), the reports update instantly.
2. **Stale Data:** Persisting effects creates a synchronization risk. If a transaction is modified or deleted directly (which shouldn't happen, but just in case), persisted effects might drift.
3. **Performance:** For a local PWA with SQLite/IndexedDB, processing a few thousand transactions in memory to derive balances is extremely fast (milliseconds). There is no need for materialized views in this V1.

Reports and balances will be calculated by fetching all `POSTED` transactions and reducing their `deriveAccountingEffects()`.

---

## 7. Legacy Migration Algorithm

The old engine mutated `account.balance` directly for `INCOME`, `EXPENSE`, `TRANSFER`, and `CAPITAL_CONTRIBUTION`. It completely ignored `REFUND` and `ADJUSTMENT`.

To migrate accurately without double-counting:

1. **Calculate Legacy Derived Delta:**
   Re-run the exact old logic over existing transactions to see what they contributed to the balance.
   ```typescript
   let delta = 0;
   if (['INCOME', 'CAPITAL_CONTRIBUTION'].includes(tx.type)) delta += dest;
   if (tx.type === 'EXPENSE') delta -= src;
   if (tx.type === 'TRANSFER') { delta += dest; delta -= src; }
   ```

2. **Determine Opening Balance Snapshot:**
   ```typescript
   openingBalance = stored_account.balance - legacyDerivedDelta
   ```

3. **Generate Snapshot Effect:**
   If `openingBalance != 0`, create an `OPENING_BALANCE` transaction dated `account.createdAt - 1`.
   If `openingBalance < 0`, the transaction still represents `OPENING_BALANCE` but the amount is negative (representing an overdraft). The derived effect logic for `OPENING_BALANCE` will naturally apply this negative amount to the `CASH` effect.

**Warning Policy:** If migration encounters transactions without source/destination where required by legacy logic, log a warning but do not silently delete.

---

## 8. Reversal Algorithm

A `REVERSAL` transaction MUST link to the original transaction via `reversalOfTransactionId`.

When `deriveAccountingEffects` encounters a `REVERSAL` transaction:
1. It fetches the original transaction from the DB.
2. It calls `deriveAccountingEffects(originalTx)`.
3. It multiplies all `amount` values in the resulting effects by `-1`.

This ensures exact inverse accounting without guessing fields.

---

## 9. Period Lock Policy

- A `PeriodLock` object stores `yearMonth` (e.g., `"2026-08"`).
- **Rule 1:** A new transaction cannot be created with a `postingDate` in a locked period.
- **Rule 2:** A `POSTED` transaction cannot be modified or reversed if its `postingDate` is in a locked period.
- **Rule 3:** To correct a mistake in a locked period, a `REVERSAL` transaction must be created with a `postingDate` in the *current (open)* period.

---

## 10. Master-Data Archive/Delete Policy

- **Account:** Cannot be hard-deleted if it is referenced in ANY transaction (Draft, Posted, or Reversed).
- If referenced, it is marked with `active = false` (or `archivedAt = timestamp`).
- Archived accounts do not appear in selection dropdowns but remain visible in historical reports and ledgers.
- The same policy applies to Categories and Partners.

---

## 11. Required Tests

Before merging any accounting engine updates, these exact tests must pass:

- **Transfer:** `CASH` source -X, `CASH` dest +X. Total cash unchanged. Revenue/Expense unchanged.
- **Capital Contribution:** `CASH` +X, `EQUITY` +X. Revenue unchanged.
- **Sale Paid Immediately:** `CASH` +gross, `REVENUE` +net, `VAT_OUTPUT` +vat.
- **Credit Sale:** `RECEIVABLE` +gross, `REVENUE` +net, `VAT_OUTPUT` +vat. `CASH` unchanged.
- **Customer Payment:** `CASH` +X, `RECEIVABLE` -X. Revenue unchanged.
- **Purchase Credit:** `PAYABLE` increases, `CASH` unchanged.
- **Supplier Payment:** `CASH` decreases, `PAYABLE` decreases, `EXPENSE` not duplicated.
- **Customer Refund:** Correct cash-out semantics.
- **Supplier Refund:** Correct cash-in semantics, not revenue by default.
- **Reversal:** Effects equal exact negative of original effects.
- **Period Lock:** Locked posting rejected.
- **Opening Balance Migration:** Legacy final balance preserved exactly.
- **Migration Idempotency:** Running migration twice does not duplicate opening values.

---

## 12. Implementation Plan

**Phase 1: Migration & Data Foundation**
- Run `git restore .` and `git clean -fd` to remove unauthorized changes.
- Define `TransactionType` V2 and Zod schemas (including `TaxProfile`, `PeriodLock`).
- Implement the exact legacy balance migration algorithm described above.
- *Test Gate:* Migration idempotency and exact legacy balance preservation tests.

**Phase 2: Accounting Core**
- Implement `deriveAccountingEffects()` for V1 types.
- Update `engine.ts` to block hard deletes of `POSTED` transactions and enforce archive policies on Accounts.
- Implement central `calculateVat()` logic enforcing integers.
- *Test Gate:* Core transaction invariants (Transfer, Sale Cash, Capital, Reversal).

**Phase 3: Book Projections**
- Implement `deriveBalances()` using the effects engine.
- Generate S2b, S2d, S3b, S4d dynamically from derived effects.
- Ensure unsupported TT58 books are clearly marked.
- *Test Gate:* Book generation correctness based on specific transaction sequences.

**Phase 4: Credit & UI**
- Add `SALE_CREDIT`, `CUSTOMER_PAYMENT`, `PURCHASE_CREDIT`, `SUPPLIER_PAYMENT`.
- Update forms to support these transaction types.
- Ensure Tax Profile can be configured in UI.
- *Test Gate:* Credit invariant tests (Phase 4 section).

**Phase 5: QA & Delivery**
- Final PWA audit (offline caching).
- Mobile-first CSS verification (360-430px).
- Audit backup/restore flows for Zod schema validation and safety.
- *Test Gate:* 100% pass on all `npm test` suites and successful `npm run build`.

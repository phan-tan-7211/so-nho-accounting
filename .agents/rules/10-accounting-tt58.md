---
trigger: always_on
---

# Accounting & TT58 Rules

Mục tiêu project là tiến tới hỗ trợ Thông tư 58/2026/TT-BTC cho doanh nghiệp siêu nhỏ.

Không claim full TT58 compliance nếu coverage chưa được kiểm chứng.

## Tax Profile

VAT method:

- `DEDUCTION`
- `PERCENT_ON_REVENUE`

CIT method:

- `TAXABLE_INCOME`
- `PERCENT_ON_REVENUE`

Legacy database không được tự động nhận một TaxProfile do AI đoán.

Phải có explicit unconfigured state cho đến khi user tự chọn.

Ví dụ:

```ts
taxProfileConfigured: false
```

hoặc model tương đương.

## TT58 Book Mapping

### VAT PERCENT_ON_REVENUE + CIT PERCENT_ON_REVENUE

Required:

- S1-DNSN

### VAT PERCENT_ON_REVENUE + CIT TAXABLE_INCOME

Required:

- S2a-DNSN
- S2b-DNSN
- S2c-DNSN
- S2d-DNSN

### VAT DEDUCTION + CIT PERCENT_ON_REVENUE

Required:

- S3a-DNSN
- S3b-DNSN

### VAT DEDUCTION + CIT TAXABLE_INCOME

Required:

- S2b-DNSN
- S2c-DNSN
- S2d-DNSN
- S3b-DNSN

## Supplementary Books

Tùy hoạt động và nhu cầu quản lý có thể có:

- S4a-DNSN: receivables/payables
- S4b-DNSN: fixed assets
- S4c-DNSN: other tax obligations
- S4d-DNSN: owner's equity

Không claim một book đã được implement nếu domain data cần thiết chưa tồn tại.

## Accounting Architecture

Transaction là economic event.

Luồng V1 ưu tiên:

```text
Transaction
    ↓
deriveAccountingEffects()
    ↓
Balances / Books / VAT / Receivables / Payables / Equity
```

Accounting effects nên được derive deterministic ở runtime trong V1.

Không persist `transactionEffects` table nếu chưa có lý do rõ ràng về performance/audit.

## Core Accounting Effects

Core effects:

- CASH
- REVENUE
- EXPENSE
- VAT_INPUT
- VAT_OUTPUT
- RECEIVABLE
- PAYABLE
- EQUITY
- TAX

Future extension:

- INVENTORY
- FIXED_ASSET

## Cash Is Not Revenue

Không được suy luận:

```text
cash in = revenue
cash out = expense
```

Ví dụ:

- capital contribution làm tăng cash nhưng không phải revenue
- customer payment làm tăng cash nhưng không tạo revenue lần hai
- internal transfer thay đổi account cash nhưng không tạo revenue/expense
- supplier payment giảm cash nhưng không tạo expense lần hai

## Transfer

Internal transfer:

```text
source CASH      -X
destination CASH +X
```

Invariant:

- total cash unchanged
- revenue unchanged
- expense unchanged

Bank fee nếu có phải là một separate expense/business effect.

Không gộp bank fee vào transfer amount theo cách làm sai revenue/expense.

## Capital Contribution

```text
CASH   +X
EQUITY +X
```

Invariant:

```text
REVENUE unchanged
```

## Sale Paid Immediately

Ví dụ gross = net + VAT:

```text
CASH       +gross
REVENUE    +net
VAT_OUTPUT +vat
```

VAT_OUTPUT không phải revenue.

## Credit Sale

Bán chịu:

```text
RECEIVABLE +gross
REVENUE    +net
VAT_OUTPUT +vat
CASH        0
```

Khi khách trả tiền:

```text
CASH       +X
RECEIVABLE -X
REVENUE     0
VAT_OUTPUT  0
```

Không được ghi revenue lần hai khi thu công nợ.

## Purchase Paid Immediately

Nếu là khoản expense hợp lệ:

```text
CASH      -gross
EXPENSE   +appropriate amount
VAT_INPUT +vat when applicable
```

VAT input không mặc định là expense.

## Purchase Credit

Mua chịu:

```text
EXPENSE / ASSET effect
VAT_INPUT when applicable
PAYABLE +gross
CASH     0
```

Không được giảm cash khi `PURCHASE_CREDIT` được post.

## Supplier Payment

Khi trả nhà cung cấp:

```text
CASH    -X
PAYABLE -X
```

Không ghi expense lần hai.

## Refund

Không dùng generic `REFUND` để tự suy luận hướng tiền.

Semantic tối thiểu nên phân biệt:

- `CUSTOMER_REFUND`
- `SUPPLIER_REFUND`

Customer refund thường liên quan cash out.

Supplier refund thường liên quan cash in.

Supplier refund không phải revenue mặc định.

Các effect khác phải phản ánh đúng nghiệp vụ gốc.

## VAT

VAT phải được xử lý riêng khỏi revenue/expense.

Invariant:

```text
VAT_OUTPUT != REVENUE
VAT_INPUT != automatically EXPENSE
```

VAT data tối thiểu có thể gồm:

```ts
{
  rate,
  baseAmount,
  amount,
  kind,
  deductible
}
```

Tất cả amount VND phải là integer.

VAT calculation phải centralized, deterministic và test được.

Không rải `Math.round()` tùy ý trong UI/components.

## Reversal

REVERSAL phải reference original transaction.

Ví dụ field:

```ts
reversalOfTransactionId
```

Reversal effect:

```text
effects(original)
→ multiply every amount by -1
```

Không hard-code REVERSAL thành:

```text
destination +
source -
```

vì reversal phải đảo chính xác transaction gốc.

Database/service layer có thể load original transaction.

Pure accounting function không nên tự fetch IndexedDB.

## Opening Balance

Không dùng `account.balance` làm source of truth sau migration.

Current account balance phải derive từ:

```text
opening effects
+
POSTED accounting effects
```

## Legacy Migration

Nếu legacy engine đã mutate `account.balance`, migration phải tránh double counting.

Strategy chỉ được dùng nếu tái tạo chính xác legacy behavior:

```text
openingBalance =
legacyStoredBalance
-
exactLegacyDerivedDelta
```

`exactLegacyDerivedDelta` phải reproduce đúng old engine.

Phải kiểm tra:

- INCOME
- EXPENSE
- TRANSFER
- CAPITAL_CONTRIBUTION
- REFUND
- ADJUSTMENT
- DRAFT
- POSTED
- REVERSED
- same-account transfer
- missing account reference
- malformed legacy transaction

Không silently delete malformed legacy records.

Nếu không thể migrate deterministic:

- preserve record
- surface warning
- không đoán

Negative opening balance phải được biểu diễn bằng semantic effect rõ ràng, không bằng hack source/destination list.

Không mặc định tuyên bố mọi legacy opening balance là owner's equity nếu dữ liệu cũ không chứng minh điều đó.

## Transaction Lifecycle

Statuses:

- DRAFT
- POSTED
- REVERSED

DRAFT:

- editable
- deletable

POSTED:

- không hard delete
- không silent overwrite

Correction phải thông qua:

- reversal
- adjustment

Phải bảo toàn audit history.

## Period Lock

Không:

- post transaction mới vào kỳ locked
- edit posted transaction trong kỳ locked
- delete posted transaction trong kỳ locked
- post reversal vào kỳ locked

Corrective transaction có thể được post trong kỳ OPEN phù hợp với accounting policy.

## Master Data

Account/category/partner chưa từng được reference:

- có thể hard delete nếu an toàn

Account/category/partner đã được historical transaction reference:

- archive/deactivate
- không hard delete

Historical data phải vẫn hiển thị đúng tên/reference.

Không reversal transaction chỉ vì user muốn xóa một master record.

Không xóa historical transactions chỉ để xóa account/category/partner.

## Reports

Không fabricate B01-DNSN hoặc B02-DNSN.

Chỉ generate report line khi underlying domain data thực sự hỗ trợ.

Phải phân biệt rõ trạng thái:

- implemented
- partial
- planned

Inventory / S2c cần domain inventory thật.

Fixed assets / S4b cần fixed asset domain thật.

Other taxes / S4c cần tax-obligation domain thật.

Không rush các domain này vào accounting core.

## Scope Control

Core foundation ưu tiên:

- TaxProfile
- transaction semantics
- accounting effects
- balance
- VAT
- transfer
- capital
- receivable/payable
- reversal
- period lock
- audit history

Sau đó mới làm book projections.

Không cố implement toàn bộ TT58 trong một phase.

## Required Accounting Invariants

### Transfer

- source cash giảm
- destination cash tăng
- total cash không đổi
- revenue không đổi
- expense không đổi

### Capital Contribution

- cash tăng
- equity tăng
- revenue không đổi

### Sale Paid Immediately

- cash tăng gross
- revenue tăng net
- VAT output tăng VAT

### Credit Sale

- receivable tăng gross
- revenue tăng net
- VAT output tăng VAT
- cash không đổi

### Customer Payment

- cash tăng
- receivable giảm
- revenue không tăng lần hai
- VAT output không tăng lần hai

### Purchase Credit

- payable tăng
- cash không đổi

### Supplier Payment

- cash giảm
- payable giảm
- expense không bị ghi lần hai

### Customer Refund

- cash-out semantics phải đúng

### Supplier Refund

- cash-in semantics phải đúng
- không mặc định là revenue

### Reversal

- effects phải bằng exact negative của original transaction

### Period Lock

- posting vào locked period phải bị reject

### Opening Balance Migration

- legacy final balance phải được preserve chính xác
- migration phải idempotent

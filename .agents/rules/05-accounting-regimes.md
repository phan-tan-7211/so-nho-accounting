---
trigger: always_on
---

# Accounting Regime Boundaries

Project must distinguish accounting regimes explicitly. Do not infer a regime from transaction data.

## 2026 Regime Map

### TT152/2025/TT-BTC

Primary scope:

- Hộ kinh doanh (HKD)
- Cá nhân kinh doanh (CNKD)

Effective for accounting guidance from 2026-01-01.

This is the default 2026 accounting guidance for HKD/CNKD unless another legally permitted regime is explicitly selected.

### TT58/2026/TT-BTC

Primary scope:

- Doanh nghiệp siêu nhỏ (DNSN)

Also permitted by the Circular:

- HKD/CNKD may choose to apply TT58 if they have that need.

Project activation date for new TT58 datasets:

- 2026-07-01 or later

TT58 replaces TT132/2018 for the micro-enterprise accounting regime. Do not label TT132 as the current SME regime.

### TT133/2016/TT-BTC

Scope:

- Doanh nghiệp nhỏ và vừa, including micro enterprises within its applicable scope.

This is a broader enterprise accounting regime than the V1 micro-accounting product scope.

Current implementation status:

- model/catalog awareness: allowed
- full transaction/account/chart/report implementation: PLANNED
- UI must not claim TT133 compliance until implemented and tested

## V1 Product Scope

V1 active configuration supports foundation work for:

- TT152/2025
- TT58/2026

TT133/2016 must remain visible only as roadmap/planned until its accounting model, chart of accounts, books and financial statements are implemented.

## Configuration Rules

Accounting regime selection must be explicit and persisted separately from transactions.

Legacy databases:

- must not be automatically assigned TT152, TT58 or TT133
- remain unconfigured until user explicitly selects a regime

When regime/entity/start-date identity changes:

- previous tax-profile assumptions must not silently carry over
- reset tax profile to UNCONFIGURED and require explicit confirmation again

## Compliance Claims

Never claim "TT152 compliant", "TT58 compliant" or "TT133 compliant" based on regime selection alone.

A regime can be marked fully supported only when required domain data, calculations, books/reports and regression tests for that scope are implemented and verified.

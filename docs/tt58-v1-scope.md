# TT58 V1 Scope

## Product decision

V1 supports only **Thông tư 58/2026/TT-BTC**.

Supported entity types:

- Doanh nghiệp siêu nhỏ (`MICRO_ENTERPRISE`)
- Hộ kinh doanh (`HOUSEHOLD_BUSINESS`) when the user voluntarily elects TT58
- Cá nhân kinh doanh (`INDIVIDUAL_BUSINESS`) when the user voluntarily elects TT58

Explicitly out of V1 scope:

- TT152/2025
- TT133/2016
- TT132/2018
- SME accounting mode

## Legal basis used for product scope

Thông tư 58/2026/TT-BTC was issued on 25/05/2026 and is effective from 01/07/2026. It applies to micro enterprises. Household businesses and individual businesses may choose to apply it if they have a need to do so.

Primary references:

- Official Gazette: https://congbao.chinhphu.vn/van-ban/thong-tu-so-58-2026-tt-btc-469663.htm
- National legal document database: https://vbpl.moj.gov.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=188184

The application must not present TT58 as the default accounting regime for HKD/CNKD. Their use is an explicit voluntary election.

## Effective date guard

`dataStartDate` for a TT58 profile must not be earlier than `2026-07-01`.

No legacy profile is silently converted to TT58. If an older branch/database contains TT152/TT133 settings, the UI asks the user to confirm a new TT58 profile before overwriting that configuration row.

## Tax profile

The app does not infer tax methods.

VAT method:

- `PERCENT_ON_REVENUE`
- `DEDUCTION`

Income-tax method:

- `PERCENT_ON_REVENUE`
- `TAXABLE_INCOME`

The persisted profile may remain explicitly unconfigured. `taxProfileConfigured` becomes true only when both methods are selected.

UI terminology:

- Micro enterprise: income tax is shown as **Thuế TNDN**
- Household/individual business: income tax is shown as **Thuế TNCN**

## TT58 book mapping used by V1

| VAT method | Income-tax method | Required book codes |
| --- | --- | --- |
| % on revenue | % on revenue | S1-DNSN |
| % on revenue | Taxable income | S2a-DNSN, S2b-DNSN, S2c-DNSN, S2d-DNSN |
| Deduction | % on revenue | S3a-DNSN, S3b-DNSN |
| Deduction | Taxable income | S2b-DNSN, S2c-DNSN, S2d-DNSN, S3b-DNSN |

This mapping means **required by the selected profile**, not **implemented in the application**.

## Implementation order

1. TT58 entity/profile configuration
2. Tax profile and required-book mapping
3. Transaction semantics and accounting effects
4. VAT / receivable / payable / equity projections
5. Period lock and reversal
6. Individual TT58 book projections and regression tests
7. Financial statements only after the underlying domains are sufficient

Do not claim full TT58 compliance until each relevant projection and regression test has been completed and verified.

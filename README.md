# Sổ nhỏ · TT58

Local-first accounting PWA for **Thông tư 58/2026/TT-BTC** V1.

Current release candidate: **1.0.0-rc.1**.

## Scope

V1 is intentionally limited to TT58/2026/TT-BTC:

- Doanh nghiệp siêu nhỏ.
- Hộ kinh doanh / cá nhân kinh doanh when voluntarily applying TT58.
- Data start date is not allowed before 2026-07-01.
- TT152, TT133, TT132 and other accounting regimes are outside V1.

The application never guesses tax method, tax rate, deductible VAT eligibility, account kind, tax opening balances or inventory valuation inputs that require explicit user data.

## Accounting architecture

Runtime accounting is derived from semantic transactions and accounting effects rather than a mutable cached balance. The implemented release path includes:

- semantic sale, purchase, payment, transfer, capital, refund, tax and reversal workflows;
- deterministic legacy opening-balance cutover;
- derived cash/bank, revenue, expense, VAT, AR/AP and equity projections;
- TT58 S1, S2a, S2b, S2c, S2d, S3a and S3b materialization according to the configured tax profile;
- TT58 S2c period-average outbound valuation (`TT58_PERIOD_AVERAGE_V1`);
- tax opening / payment / refund / assessment positions;
- immutable period lock snapshots and audit events;
- deterministic JSON, CSV and XLSX output;
- print / browser Save-as-PDF from the same report bundle;
- partner master, backup/restore and release-readiness diagnostics.

Supplementary S4 domains that do not yet have an explicit domain model remain future scope rather than being fabricated.

## Local-first data and backup

Accounting data is stored in **IndexedDB in the current browser profile/device**. There is no server-side accounting database in V1.

Before clearing site/browser data, moving devices, resetting a browser profile or performing risky maintenance, create a full backup from **Cài đặt → Backup/Restore**. Restore verifies backup format, schemas and SHA-256 checksum before replacing local data, and replacement runs atomically.

## PWA / offline behavior

Production builds generate a web app manifest and Service Worker. After one successful online load, the app shell can be available offline. A newer Service Worker is surfaced through an explicit update prompt; the app does not automatically reload over active accounting work.

Offline availability does not change the storage boundary: IndexedDB remains device/browser-local.

## Development

```bash
npm ci
npm test
npm run build
npm run lint
npm run dev
```

CI also installs `fake-indexeddb` as an isolated test harness for IndexedDB integration tests.

## Release process

The exact release acceptance criteria are documented in [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md). A release candidate is not considered deployable until tests, production build, lint, PWA artifacts, backup/restore reproduction and production smoke checks have passed.

## Deployment

`vercel.json` configures the Vite production output and PWA cache headers:

- `/sw.js` and `/manifest.webmanifest`: revalidate on every request;
- hashed `/assets/*`: long-lived immutable cache;
- production output directory: `dist`.

The deployed app requires no accounting backend secrets for V1.

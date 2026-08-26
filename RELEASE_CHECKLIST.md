# Sổ nhỏ TT58 — Release Candidate Checklist

Release: **1.0.0-rc.1**  
Date: **2026-08-26**  
Scope: **TT58/2026/TT-BTC V1 only**

## 1. Accounting correctness gate

- [ ] GitHub Quality Gate passes on the exact release head.
- [ ] All unit and IndexedDB integration tests pass.
- [ ] TypeScript/Vite production build passes.
- [ ] Lint reports 0 warnings / 0 errors.
- [ ] Required TT58 books for the configured tax profile can reach `IMPLEMENTED` with complete real data.
- [ ] Locked report snapshots remain immutable and deterministic.
- [ ] S2c locked snapshots use `TT58_PERIOD_AVERAGE_V1` when S2c is required.

## 2. Data safety gate

- [ ] Full JSON backup can be created.
- [ ] Backup preview validates schema and SHA-256 checksum before restore.
- [ ] Restore into a clean database reproduces locked report output exactly.
- [ ] User-facing release notes state that clearing browser/site data deletes local IndexedDB unless a backup exists.
- [ ] Update flow does not automatically reload over active work.

## 3. PWA / production build gate

- [ ] `manifest.webmanifest` is generated.
- [ ] `sw.js` and Workbox runtime are generated.
- [ ] Service worker update prompt is visible when a newer build exists.
- [ ] `/sw.js` and `/manifest.webmanifest` use revalidation-friendly cache headers.
- [ ] Hashed `/assets/*` files use immutable long-lived cache headers.
- [ ] App shell opens after a successful online load and remains available offline.

## 4. Production smoke test

- [ ] Production root URL returns HTTP 200.
- [ ] App title/navigation renders.
- [ ] `manifest.webmanifest` returns HTTP 200 and valid JSON.
- [ ] `sw.js` returns HTTP 200 with non-stale cache headers.
- [ ] No critical deployment/build errors are present.
- [ ] Install prompt / Add to Home Screen eligibility is checked in a supported browser.
- [ ] Online → offline reload is tested after the first successful load.

## 5. Accounting acceptance scenario

- [ ] Configure TT58 profile and report identity.
- [ ] Create cash/bank account with explicit kind.
- [ ] Create partner when required.
- [ ] Post representative semantic transactions.
- [ ] Enter explicit tax opening/settlement data when required.
- [ ] Enter inventory opening/movements when S2c is required.
- [ ] Confirm all required books are `IMPLEMENTED`.
- [ ] Lock period.
- [ ] Export locked XLSX.
- [ ] Print / Save PDF from locked snapshot.
- [ ] Create full backup.
- [ ] Restore backup into a clean browser/database and confirm locked outputs are reproduced.

## 6. Release boundary

Release candidate does **not** fabricate supplementary S4 domains that are not implemented. Fixed-assets and other-tax supplementary domains remain explicit future scope. This release is local-first: accounting data is stored in browser IndexedDB, not in a server-side database.

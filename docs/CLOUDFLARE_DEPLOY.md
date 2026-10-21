# Sổ nhỏ Accounting — Cloudflare Pages

Application: static React/Vite PWA. Accounting data is local in browser IndexedDB. No Cloudflare database needed in V1.

## Setup
1. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Import an existing Git repository.
2. Connect `phan-tan-7211/so-nho-accounting`; choose production branch `main`.
3. Build command: `npm run build`; output directory: `dist`; root: repository root.
4. Node.js version: 24 (set NODE_VERSION=24 where supported by build system).
5. Do not use GitHub Pages' `/so-nho-accounting/` subpath. Omit `VITE_BASE_PATH` or set `/`.
6. Deploy and verify `/`, `/sw.js`, `/manifest.webmanifest`, offline mode, printed/exported reports, and backup/restore.
7. `public/_headers` is copied into `dist/_headers` during Vite build.

## Accounting data safety
**IndexedDB is origin-specific.** Before changing domain, use Settings → Backup/Restore to export an authoritative full backup on the old site. On the new `*.pages.dev` site, import backup and validate records, balances, periods and reports. Do not erase old site data before validation. Avoid entering transactions on both domains during cutover.

Keep Vercel and GitHub Pages configurations as fallback until cutover passes. Only then remove old deploy integrations.

## Checks
Run `npm ci`, `npm test`, `npm run build`, and `npm run lint` in repository root. If integration tests require `fake-indexeddb`, install the harness as done by current CI. Verify build output contains `dist/_headers`, `dist/sw.js`, and `dist/manifest.webmanifest`.

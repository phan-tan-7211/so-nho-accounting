# Cloudflare Workers Static Assets deployment

This repository is a Vite React SPA/PWA, using IndexedDB for local accounting data.

Cloudflare Workers Git Build settings:
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler versions upload` (optional; if dashboard requires a preview command, use `npx wrangler dev` for local preview only)
- Production branch: `main`
- Node version: 24
- `VITE_BASE_PATH`: `/` (or omit)

`wrangler.jsonc` configures Workers Static Assets to upload `./dist`, including the built PWA and `public/_headers`. The app is static: no Worker handler script, D1 database, or credentials are needed.

After deployment visit `https://so-nho-accounting.phantan7211.workers.dev` and verify actual application UI instead of a hello-world starter.

Before switching domain, back up existing IndexedDB data via Settings > Backup/Restore on the original site, then restore and verify on the new origin. Never remove old accounting records before validating the restored copy.

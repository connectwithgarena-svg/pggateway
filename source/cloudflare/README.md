# FF Shop 1.7 deployment note

Follow **START-HERE-HINDI.md** for the current signed standalone APK, schema0005, BharatPe baseline/timing requirements and Pages update steps. `pages-upload.zip` must be uploaded with files at its root. The deployment checker is `/deployment-check.html`.

The original setup reference below describes the same Cloudflare architecture; use the current upgrade guide instead of recreating existing credentials/databases.

# FFSHOP 1.4 — Payments workspace

Cloudflare Pages advanced-mode Worker, D1, scheduled maintenance Worker and an Android notification relay. No paid gateway credentials are used.

## Features

- Professional responsive dashboard with overview, full paginated/searchable payment history and page CSV export.
- Paytm Business, BharatPe, PhonePe Business, HDFC SmartHub Vyapar routes, opted-in standard/custom notification text capture.
- One receiving account per provider; add/edit/default/enable/disable/remove; destination/removal protection for pending orders, historical snapshots preserved.
- Exact-amount QR/payment links, cancellation, checked merchant-history manual review with transaction-reference deduplication.
- P-256 paired-phone protocol, timestamp/enrollment checks, event replay protection, globally reserved payable amounts.
- Phone health, pairing/revoke, notification diagnostics, API key management and signed durable webhooks with scheduled retries.
- Admin sessions with secure HttpOnly cookies and origin checks. No secrets in source/download package.

Read `START-HERE-HINDI.md` for fresh and existing deployments, one-time SQL upgrade and the release APK signing change. Read `../PROVIDERS.md` for the capture/verification boundary. Synthetic tests cover supported formats; live merchant phone/payment validation is still required.

## Build and checks

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Node ≥22.23.1. Build creates `dist/` Pages assets, `build/jobs.js` and `dist/source.zip`. Tests exercise real workerd/D1, Wrangler Pages asset routing and Java Protocol compatibility (Java17 required for that test). Dependency versions are pinned in the lockfile.

## Local preview

```sh
FFSHOP_PREVIEW_STATE="$HOME/runtime/ffshop-preview" node scripts/preview.mjs
```

Build first. Preview is `https://localhost:8790` using a development certificate. Synthetic persistent D1 and the generated private admin key are in the supplied state directory outside source. The preview applies the one-time upgrade only when its profile columns are absent. It does not contact merchant providers or your live Cloudflare database.

## Deployment

Manual Pages upload: see the Hindi guide. For a fresh CLI-managed project, `npm run setup`, configure Cloudflare secrets/bindings, then `npm run deploy` (explicit remote writes). This applies migrations, deploys maintenance and Pages. Do not combine manually imported SQL with untracked CLI migrations without reconciling migration metadata. Keep all keys and local configurations private.

One default account; each order may specify `profile`. New orders require an enabled, non-removed account. Existing orders can settle after disabling. Removed accounts retain old history; restoring uses the same provider identity.

`POST /api/v1/payments` takes name, whole-rupee amount, optional external_id/profile, Bearer API key and Idempotency-Key. `GET /api/v1/payments/:id` is scoped to that shop key. Webhook signature is HMAC SHA256 over timestamp plus payload; see jobs.ts/tests for exact header/canonical format. Verify before fulfilment.

AGPL-3.0-or-later; LICENSE/NOTICE and full matching source are included.

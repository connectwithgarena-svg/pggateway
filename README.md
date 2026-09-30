# FF Shop 1.7

Private Cloudflare Pages/D1 payment workspace and signed Android notification relay, adapted from the supplied PayGate project. Premium charcoal/emerald dashboard; five opted-in business apps; account lifecycle, QR/payment links, transaction history/export, merchant-history review, phone health, API keys and optional signed callbacks.

- Maintained implementation: `source/cloudflare`, `source/android`.
- Final deployment package: `FFSHOP-complete.zip` (upload only its inner `pages-upload.zip` to Pages).
- Existing/fresh installation and 404 recovery: `source/cloudflare/START-HERE-HINDI.md`.
- Data destinations and privacy limits: `source/PRIVACY.md`.
- Exact business packages and capture/confirmation boundaries: `source/PROVIDERS.md`.

1.7 limits new adjustments to1–99 paise and adds guarded BharatPe timed-list matching, durable row replay protection and diagnostic reasons. Migration0004 preserves existing records and callback settings. Website return URLs are restricted to the admin-configured origin, exposed only after paid status, and supported by a server verification helper/API guide. The unchanged signed Relay1.5 APK is compatible; upgrade the Cloudflare package/database. See the deployment guide for baseline and minute-window requirements.

Original AGPL-3.0-or-later licence and attribution retained. No repository-owner telemetry/callback bundled. Cloudflare and payment providers process normal service data. Real provider/physical phone acceptance tests remain required; no zero-bug or bank settlement guarantee.

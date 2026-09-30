# FF Shop 1.7 — privacy and data destinations

## Repository owner

This distribution has no repository-owner API endpoint, analytics/ad SDK, error-reporting service or automatic update check. Browser scripts, styles, QR generation and the source download are served from your own site. The Android app sends signed evidence only to the HTTPS origin you explicitly pair. It does not follow HTTP redirects. The Worker processes evidence in your Cloudflare account. Original AGPL copyright/attribution remains in source and NOTICE; those text notices do not send data.

The upstream PayGate reference is https://github.com/Phloraxx/payment-api at d8fa14b987eca508b1918c8aef58a7b49fdaf78d. FF Shop is its existing Cloudflare adaptation, with its own Worker/D1 implementation and Android relay. The Go/SQLite server cannot be uploaded directly to Pages. This package preserves your existing FF Shop API and deployment model.

## Data map

| Component | Destination / retained data |
|---|---|
| Dashboard and checkout | Same-origin HTTPS requests; local QR rendering; no CDN fonts, remote logos or tracking pixels. |
| Android relay | Only your paired HTTPS origin receives selected business app title/text/expanded text and notification time, device public key, app/Android version and connection health. No bank login, UPI PIN, contacts, SMS permission, accessibility service or screen scraping. |
| Android private storage | Device private key in Android Keystore. Pending notification bodies in app-private SQLite. Terminal delivery/rejection clears the body; IDs and counts remain for diagnostics/deduplication. Disconnect clears local pairing and queue. |
| Cloudflare D1 | Accounts/UPI destinations, order records, event hashes/package/amount/time/result, relay health, key hashes and callback queue. Raw notification body is parsed in memory, not stored in D1. BharatPe adds persistent row hashes and per-phone baseline hash arrays/times for replay protection; payer names are not stored as plaintext. |
| Website return | Only the HTTPS origin saved by the admin; per-order return URL stored in D1. After paid status, browser navigation adds the payment ID. Website server verifies status using its secret shop API key. No third-party redirect service. |
| Optional callback | Only the HTTPS endpoint an authenticated administrator configures. Signed order status/amount/reference sent. No default destination. Disabling/replacing cancels queued deliveries and clears their saved payload/secret; already in-flight requests cannot be recalled. |
| Source/downloads | Local /source.zip and privacy file. No automatic GitHub request. Source archives exclude private keys, configuration credentials, caches and databases. |

## What privacy does not mean

Cloudflare processes and hosts your traffic/data. Your phone OS, merchant apps, banks and optional callback operator also process their normal service data. Cloudflare may add its own network-error reporting headers. This is not anonymity from your hosting or payment providers. Account collaborators, third-party integrations you install and a compromised server/phone remain outside this source audit.

Use a Cloudflare account controlled by you. Check account members and revoke unknown API tokens, inherited Worker bindings, log drains and webhooks. Do not share admin/API keys or pairing links. Review the actual callback URL in Privacy & setup. Do not connect the app to an origin you do not control. Changing branding alone does not change hosting-account permissions.

Runtime source audits and synthetic network checks are included in validation. Real production account access, physical devices, live merchant transfers and all future dependency versions cannot be guaranteed by a static build. No claim of "zero bugs" or bank settlement certification is made.

## Build tooling

Gradle/SDK and npm download dependencies from their configured public registries during a source build. Those registries see the build machine's requests, not runtime merchant evidence. Wrangler may contact Cloudflare for deployment/authentication; FF Shop's deployment scripts disable Wrangler usage metrics. Build locally in an account/environment you control. Never upload signing keys, .ffshop-admin.txt, live databases or credentials to GitHub.

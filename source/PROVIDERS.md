# FF Shop 1.6 — business notifications

| App | Android package | Profile |
|---|---|---|
| Paytm for Business | `com.paytm.business` | `paytm` |
| PhonePe Business | `com.phonepe.app.business` | `phonepe` |
| HDFC Bank SmartHub Vyapar | `com.hdfc.smarthub` | `hdfc` |
| BharatPe for Business | `com.bharatpe.app` | `bharatpe` |
| Google Pay for Business | `com.google.android.apps.nbu.paisa.merchant` | `gpay` |

All five identifiers were checked against their official Google Play listings on 2026-09-30. This confirms app identity, not live notification formats. Google Pay Business capture is experimental until verified on the merchant phone. Consumer Google Pay/PhonePe packages and arbitrary apps are excluded. Each provider requires explicit phone opt-in; only Paytm is selected initially.

One receiving account per business app. The dashboard stores the QR's receiving UPI destination; it does not log in to merchant accounts. Pending payments protect account removal/UPI changes. Existing orders retain their original provider and destination.

## Capture

The reader captures standard title/text/expanded text, InboxStyle text lines, and visible custom RemoteViews TextViews when standard text is absent. It also handles custom layouts without extras. The local inspector uses the exact same extractor. Limits: 4096 characters per field, 64 inbox lines, 256 custom views/depth20. Negative/repeated amounts remain visible to the parser; malformed or partial fields are discarded. Group summaries and pre-enrollment/old notifications are excluded.

Remote adapter-backed/image-only notifications can have no accessible text even while visibly showing an amount. Android does not expose every app's UI through NotificationListenerService. This app has no Accessibility/screenshot/OCR scraping. Inspect the notification; if text is unavailable, use authenticated merchant-history review.

## Matching

The paired phone signs evidence; the server checks signature, enrollment, time, package, exact adjusted amount and order window. Recognized positive English and strict Hindi receipts are tested using synthetic fixtures for all five providers. Generic amount-only lists, multiple amounts in ordinary receipts, integer-only amounts and negative/ambiguous wording remain unconfirmed. The explicitly supported BharatPe custom list exception is described below.

No physical merchant apps or real bank transfer was available in the sandbox. Before accepting customer orders, send a small generated exact-total payment through every enabled provider, inspect captured fields and check dashboard status. An unrecognized receipt remains pending. A package name or matching amount alone is not bank settlement proof.

For manual review, inspect the receiving merchant's real history, enter exact credited amount and a unique transaction reference, and confirm it belongs to this order. Reference reuse and concurrent callbacks are guarded. Never fulfil based only on a customer screenshot.

## BharatPe custom transaction list (1.6)

The supplied layout is parsed as repeating `hh:mm AM/PM / payer / ₹amount` rows followed by `Close / Refresh`. Only empty standard title/text fields and `com.bharatpe.app` are eligible. Recognized lists are split into individual row results. Displayed times are interpreted in IST. Commas, unfamiliar footers, extra status text, duplicate indistinguishable rows and reordered lists fail closed.

The first snapshot is a baseline, never payment evidence. The next capture must prepend rows while retaining an ordered overlap with the baseline. Baseline must have reached the server before order creation and within the last10 minutes. The event must arrive within90 seconds; a candidate row must be within2 minutes and its **entire displayed minute** inside the order payment window. Pay during the checkout's suggested IST interval, starting next minute. Same-minute order/payment, missing baseline, incomplete overlap, offline delivery or old timestamps require merchant review. Refresh BharatPe's notification with the relay connected before creating an order; check Notification activity for baseline/capture results.

Rows are remembered by hashes of normalized payer, displayed clock minute and amount, globally across relay devices. Inferred date is deliberately excluded so yesterday's refreshed row cannot become today's new credit. This conservative rule can also send a genuine identical payer/time/amount repeat on another day to manual review. Ledger fingerprints are retained indefinitely; do not delete them to free amount slots. Transactions and callbacks commit atomically; event retries, changed event IDs and list refreshes cannot repeat an order transition.

These notifications are signed by your enrolled phone, not the bank. This bounded list matching is inferred from the supplied layout; test it on your actual merchant phone before relying on it. A successful local fixture is not a real bank-transfer certification.

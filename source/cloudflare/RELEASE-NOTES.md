# FF Shop1.7

- Preserves1–99 paise adjustment for ALL five providers and guarded BharatPe row matching from1.6. Live site inspected before this change still ran1.5; these changes require uploading the new Pages bundle and upgrading D1.
- Website HTTPS origin setting, optional per-order return_url and paid-only browser return. Current origin allowlist is rechecked on checkout; query parameters cannot select a redirect target. Disabling/changing the website origin blocks old return URLs.
- Return URL participates in creation idempotency and is stored atomically with the order/reservation. Schema005 adds a separate mapping table; combined004+005 update preserves existing schema3/4/5 data and callbacks.
- Server-only API helper with stable order idempotency, scoped status lookup and strict saved-order/amount/profile verification; raw-body webhook HMAC verification. Website-specific order storage/atomic fulfilment must be connected by its backend implementation.
- Numbered deployment files:02-DATABASE-UPDATE.sql for D1, then01-PAGES-UPLOAD.zip for Pages. Hindi installation and API guides included, with a locally hosted guide linked from Integrations.
- Android Relay1.5 unchanged; retain existing installation/pairing.

Validation uses synthetic local D1/Workerd, server helper fixtures and shared browser. Real merchant acceptance and website deployment require the user's account/phone/site. No claim that a real BharatPe payment has passed until the user tests the deployed build. Notification confirmation is phone evidence, not bank-signed settlement proof.

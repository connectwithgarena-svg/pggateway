# FF Shop Relay 1.5

Android8+ (minSdk26), compile/target35, versionCode6. Java17, Gradle8.9, AGP8.7.3; JUnit4.13.2/Robolectric4.14.1 are test-only dependencies. No runtime third-party SDK.

```
./gradlew :app:testDebugUnitTest :app:lintStandalone :app:assembleStandalone
```

The shared unit fixtures live in src/debug; use the debug unit suite. Standalone is a non-debuggable release variant. Output `app/build/outputs/apk/standalone/app-standalone-unsigned.apk` must be zipaligned and signed with your private key before distribution. Keep that key private and reuse it for updates. Debug builds use another identity.

Distributed package: `in.ffshop.relay.standalone`, versionName `1.5.0-standalone`, launcher **FF Shop Relay**. It can coexist with the original `in.ffshop.relay`, whose private signing key was never supplied. It updates the previously supplied `FFSHOP Relay New` using the retained release certificate. Reconcile old queues, revoke/disable the original relay and pair this app once; never run both relays simultaneously. An existing standalone pairing survives an in-place signed update.

Five opted-in merchant packages, incoming-format boundaries and phone acceptance steps are documented in `../PROVIDERS.md`. Capture and inspector share one bounded extractor for standard/Inbox/custom text. Empty/malformed/oversized text is not invented into a receipt. Dismissed notifications cannot be recovered. No accessibility, contacts, SMS, bank credentials or broad screen capture.

Only the explicitly paired HTTPS server receives evidence/health. Redirects are disabled, TLS verified, P-256 signing keys stay in Android Keystore. Application backups disabled. Terminal notification bodies are cleared, including on opening older local databases; IDs/counts remain for deduplication/diagnostics. Pending bodies remain in app-private storage until delivered/disconnected. See `../PRIVACY.md`.

Allow notification access and unrestricted battery/background use, keep receiving merchant apps logged in, set automatic date/time and tap Start relay. Reopen after reboot or force stop. Delivered evidence does not itself mean payment Paid; the server owns confirmation.

Tests cover package isolation, canonical signing, standard/Inbox/custom layouts, negative/ambiguous text, malformed fields and terminal-body clearing. These synthetic checks do not replace real Android merchant resources/notification validation. AGPL source and original NOTICE retained.

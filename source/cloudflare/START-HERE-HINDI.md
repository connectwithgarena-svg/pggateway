# FF Shop1.7 — bas in steps ko follow karo

Tumhari live site check par **1.5.0 / schema3** thi. Is package ki **02-DATABASE-UPDATE.sql** tumhare existing database ke liye hai; ye1.5/1.6/1.7 (schema3/4/5) par use ho sakti hai. Fresh database create karne ki zaroorat nahi.

## File kahan jayegi?

| File | Kahan / kya karna hai |
|---|---|
| **02-DATABASE-UPDATE.sql** | Cloudflare → D1 → existing bound database → Console; poora content ek saath Execute |
| **01-PAGES-UPLOAD.zip** | Cloudflare → Workers & Pages → **ffshop-255** → Create a new deployment → Production; ZIP upload |
| **03-WEBSITE-INTEGRATION.md** | Guide ko padho; Cloudflare par upload karne ki file nahi |
| **04-START-HERE-HINDI.md** | Yeh step-by-step guide |
| **05-MAINTENANCE-WORKER.js** | Sirf separate scheduled maintenance Worker ke code editor/deployment mein; Pages par nahi |
| **WEBSITE-SERVER-HELPER.zip** | Apni website ke private backend ke developer ke liye; API helper + guide |
| **FF-Shop-Relay-1.5.apk** | Android phone; working1.5 already installed hai to reinstall zaroori nahi |
| source.zip / extras | Source aur fresh/older schema reference; normal update mein upload nahi |

## Step1 — D1 database update (pehle)

1. Cloudflare dashboard kholo. Pages project `ffshop-255` ke Settings → Bindings mein `DB` ke saamne connected database ka naam dekho.
2. D1 mein **usi existing database** ko kholo. Backup/export lo.
3. Console mein `SELECT value FROM settings WHERE key='schema_version';` chalao. Tumhare current setup mein3 aana chahiye;4 ya5 bhi is update ke liye theek hai. Missing/error/other result ho to yahin result inspect karo, database reset mat karo.
4. `02-DATABASE-UPDATE.sql` Notepad mein kholo → Ctrl+A → Ctrl+C.
5. D1 Console ka purana input clear karo → paste → **poora SQL ek saath Execute**. File mein comments nahi hain.
6. Wahi version query dobara chalao: ab **5** aana chahiye. Orders, UPI accounts, API/admin keys aur existing callback settings retain honge.

## Step2 — Pages website update (D1 ke baad)

1. Workers & Pages → **ffshop-255** existing Pages project kholo.
2. **Create a new deployment → Production** choose karo (manual Direct Upload project).
3. **Sirf `01-PAGES-UPLOAD.zip` upload karo.** Outer `FF-Shop-Final-1.7.zip` ko upload mat karo.
4. Agar UI ZIP accept nahi karta, `01-PAGES-UPLOAD.zip` extract karke uske contents upload karo. Root mein `index.html`, `_worker.js`, `app.js` hone chahiye; ek extra parent folder nahi.
5. Deploy complete hone do. Existing `DB`, `PUBLIC_ORIGIN=https://ffshop-255.pages.dev`, `ADMIN_KEY_HASH` preserve karo. Nayi admin key banane ki zaroorat nahi.
6. `https://ffshop-255.pages.dev/deployment-check.html` kholo → Run again. **Version1.7.0 aur schema0005 sahit8 PASS** hone chahiye.
7. Dashboard par Ctrl+Shift+R. Agar header/sidebar1.7 nahi hai, latest Production deployment/domain check karo.

Git-integrated project mein manual Create a new deployment nahi milta to configured Git/Wrangler deployment use hota hai; us screen ka screenshot bhejo. Project delete/recreate mat karo.

## Step3 — Scheduled Worker (agar pehle se configured hai)

Existing maintenance Worker ka same D1 binding `DB` aur cron `*/5 * * * *` rakho. Is release mein scheduled logic change nahi hai; working Worker ko dobara banana zaroori nahi. New setup mein `05-MAINTENANCE-WORKER.js` ko separate Worker deploy karke DB binding aur cron set karo. Yeh expired orders/background webhook retries handle karta hai.

## Step4 — Phone aur BharatPe test

1. Working FF Shop Relay1.5 app rakho. BharatPe business toggle ON, notification access ON, Start relay, internet ON.
2. Apna BharatPe merchant notification **Refresh** karo, phir FF Shop → Notification activity mein **BharatPe baseline saved** / current capture dekho.
3. Ab naya order banao (baseline10 minutes ke andar). **Har provider** mein extra amount sirf₹0.01–₹0.99 hai. Example₹10 → ₹10.01…₹10.99.
4. BharatPe ke liye checkout par shown **next-minute IST time se** exact total pay karo. Example order12:14:20 par bana to12:15 se payment. Shown end time se pehle pay karo.
5. Fresh row ka matched result aana chahiye. Already paid ho aur pending rahe to dobara pay mat karo; merchant history aur notification event ka reason dekho.
6. BharatPe date/seconds/transaction-ID missing hone par old/same-minute/ambiguous row automatic confirm nahi hota. Actual phone test abhi tumhare side par karna hai. Screenshot ya previous payment ko retroactively auto-paid nahi karte.

## Step5 — Apni website par lagao

FF Shop → Integrations mein website HTTPS origin save karo → Shop API key generate karo. `03-WEBSITE-INTEGRATION.md` mein create-order, return_url, server-side status verification, webhook aur duplicate fulfilment protection ka exact contract hai.

API key website ke **server secrets** mein jaati hai, frontend HTML/JS mein nahi. Customer payment confirmed hone par saved website return_url par automatically jayega. Website ka backend same API key se status/amount/order verify karke fulfil karega. Static-only site ko secret rakhne ke liye server/Worker backend chahiye.

## Amount capacity

Ek base amount ke maximum99 payable totals24h ke liye reserve hote hain, sab providers ke across. Paid/cancelled orders bhi reserve rehte hain. Slots full ho to new order error dega; duplicate amount reuse nahi karega. Purane orders ka original amount change nahi hota.

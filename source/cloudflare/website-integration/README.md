# FF Shop1.7 — apni website par payment lagao

Yeh guide kisi bhi server backend (PHP, Node.js, WordPress plugin, Cloudflare Worker) ke liye HTTP API contract hai. Included `website-integration/ffshop-client.mjs` Node22+/Workers ke server-side JavaScript ke liye tested helper hai. Website URL/framework aur order database ki details ke bina automatic installation possible nahi; yeh integration kit hai, finished WordPress plugin nahi.

## 1. FF Shop dashboard mein setup

1. **Integrations → Your website & payment return** kholkar apni website ka HTTPS origin save karo: example `https://your-shop.com`. Sirf domain, koi path nahi. `www` ho to exact `www` domain save karo.
2. **Shop API keys → Generate API key** se website ki key banao. Admin login key aur shop API key alag hain. Shop API key sirf website ke server environment/secrets mein rakho, browser HTML/JS mein nahi.
3. Website server configuration:
   - `FFSHOP_ORIGIN=https://ffshop-255.pages.dev`
   - `FFSHOP_API_KEY=<dashboard se generated shop API key>`
4. Return route apni website par banao: example `/payment/return`. Domain wahi hona chahiye jo step1 mein save kiya.

## 2. Customer Buy/Pay click kare → website SERVER order banaye

Pehle apne database se logged-in customer ka unpaid order aur trusted price load karo. Browser ke bheje price, profile ya return address ko seedha trust mat karo.

```http
POST https://ffshop-255.pages.dev/api/v1/payments
Authorization: Bearer YOUR_SHOP_API_KEY
Content-Type: application/json
Idempotency-Key: SHOP-ORDER-1001

{
  "name": "Order 1001",
  "amount": 100,
  "external_id": "1001",
  "profile": "bharatpe",
  "return_url": "https://your-shop.com/payment/return"
}
```

`amount` base price hai, **whole rupees** mein. `profile`: `paytm`, `bharatpe`, `phonepe`, `hdfc`, `gpay`; omit karne par enabled default account. **Sab profiles mein ₹0.01–₹0.99 add hota hai.** Same shop order ke retries mein same Idempotency-Key aur same body use karo. Key chars letters/numbers/underscore/hyphen, maximum128. Same key with changed price/account/return URL returns409.

Success HTTP201; identical retry HTTP200. Returned JSON includes `id`, `external_id`, `requested_amount`, `payable_amount`, `profile`, `status`, `checkout_url`, `expires_at`.

Website apne DB mein gateway `id`, payable amount (integer paise), requested price, profile, shop order ID save kare. Gateway ID unique rakho. Phir browser ko response ke **checkout_url** par redirect karo. Secret API key checkout link mein mat bhejo.

## 3. Payment hone par automatic return

Phone evidence se order `paid` hone par hosted checkout approximately10-second polling +1.5-second redirect delay ke baad tumhare stored return_url par jayega:

```text
https://your-shop.com/payment/return?ffshop_payment_id=GATEWAY_PAYMENT_ID
```

Return URL create-order request se save hota hai; customer ka checkout query parameter redirect ko override nahi karta. Only currently configured HTTPS origin allowed. Pending, cancelled ya expired payment success-redirect nahi karta. Callback setting disable/domain change karne se old orders ka redirect bhi band ho jata hai. Normal links without return_url remain on checkout.

## 4. Return route par payment VERIFY karo

Query parameter khud payment proof nahi hai. Return route current logged-in customer ka saved shop order lookup kare, `ffshop_payment_id` ko saved gateway ID se compare kare, phir **same shop API key** se server request:

```http
GET https://ffshop-255.pages.dev/api/v1/payments/GATEWAY_PAYMENT_ID
Authorization: Bearer YOUR_SHOP_API_KEY
```

Fulfil tabhi jab saare checks pass:

- `id` == saved gateway payment ID;
- `external_id` == your saved shop order ID;
- `status` == `paid`;
- `requested_amount` == your trusted base price;
- `payable_amount` == saved expected payable amount;
- `profile` == saved receiving provider.

Amounts ko integer paise mein compare karo; floating-point equality avoid karo. API status lookup sirf creation wali API key ke scope mein work karta hai. New separate API key old key ke orders nahi padh sakti; key revoke karne se pehle orders reconcile karo.

Apni DB transaction mein **unpaid → paid** conditional update aur **unique order-ID fulfilment/outbox entry** ek saath commit karo. Browser refresh, webhook retry ya do requests aane par goods/wallet balance sirf ek baar fulfil hon. Existing paid order par success page dikhao, fulfilment dobara mat karo.

## 5. Server JavaScript helper

`website-integration/ffshop-client.mjs` ko website ke private backend source mein rakho. API secrets server environment mein. Public assets/bundle mein module ya key mat rakho.

```js
import { FFShopClient } from './ffshop-client.mjs';
const gateway = new FFShopClient(process.env.FFSHOP_ORIGIN, process.env.FFSHOP_API_KEY);

// order comes from your authenticated server database, not request body price.
const payment = await gateway.createPayment({
  orderId: String(order.id),
  amountRupees: order.amountRupees,
  profile: order.provider,
  returnUrl: 'https://your-shop.com/payment/return'
});
// Persist payment.id, payment.payableAmountPaise and payment.profile on this order.
// Redirect the customer's browser to payment.checkout_url.

// On return/webhook: load saved order and verify its ownership first.
const result = await gateway.verifyPayment(saved.paymentId, {
  paymentId: saved.paymentId,
  orderId: String(saved.id),
  amountRupees: saved.amountRupees,
  payableAmountPaise: saved.payableAmountPaise,
  profile: saved.provider
});
if (result.paid) {
  // Your DB transaction: mark paid only if currently unpaid; enqueue fulfilment
  // with UNIQUE(shop_order_id). Commit before sending a success response.
}
```

`order`, `saved` aur DB transaction tumhari existing website ki implementation hain. Helper ye functions invent nahi karta. PHP/WordPress backend bhi upar wale same HTTP contract ka use karega; framework batao to uske actual routes/plugin code mein adapt kiya ja sakta hai.

## 6. Customer tab band kare: optional signed webhook/background reconciliation

Website par `POST /payment/webhook` banao. FF Shop **Integrations → Payment webhooks** mein apna HTTPS endpoint save karo. Jo signing secret mile usko website server secret `FFSHOP_WEBHOOK_SECRET` mein rakho.

Headers: `X-FFSHOP-Timestamp` (Unix seconds), `X-FFSHOP-Signature` (hex HMAC-SHA256), `X-FFSHOP-Event` (event ID). Signature input = `timestamp + '.' + original raw request body`. Body ko JSON parse/re-serialize karne se pehle original bytes/string se verify karo. Included `verifyWebhook(rawBody,timestamp,signature,secret)` uses a5-minute replay window.

Verified body: `type=payment.paid`, `id=paid_<payment-id>`, `payment.id`, `payment.external_id`, `payment.requested_amount_paise`, `payment.payable_amount_paise`, `payment.status`.

Map event to your saved order, then authenticated GET verification from step4 and the same atomic fulfilment function. Persist unique webhook event ID as well. Unknown order/amount mismatch ko fulfil mat karo. Valid already-processed event par2xx; temporary failure par5xx for retry. Return2xx only after durable processing.

Scheduled maintenance Worker same D1 DB par `*/5 * * * *` cron se retries karta hai; background callback immediate nahi, cron tak delay ho sakta hai. Customer return route GET verification ko cron ka wait nahi karna. Tab close hua aur webhook configured nahi to website ko apni server-side reconciliation/polling chahiye.

## BharatPe acceptance test

Live site pe1.7 deploy, schema5 PASS, receiving BharatPe account configured, relay enabled. Order se pehle notification Refresh karke baseline capture karao; next order10 minutes ke andar create karo. Checkout par shown next-minute IST interval mein exact total pay karo. Same-minute/old/unknown list manual review mein rahegi. Apne merchant transaction history se real credit compare karo. Existing pending orders ke amounts change nahi hote.

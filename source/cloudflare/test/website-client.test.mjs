import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  FFShopClient,
  verifyWebhook,
  amountPaise,
} from "../website-integration/ffshop-client.mjs";
const fixture = {
  id: "payment-17",
  external_id: "ORDER-17",
  status: "pending",
  requested_amount: "10.00",
  payable_amount: "10.99",
  profile: "bharatpe",
  checkout_url: "https://gateway.example/pay/payment-17",
};
test("server helper uses stable idempotency, private authorization and checks trusted order details", async () => {
  const calls = [];
  let payment = fixture;
  const client = new FFShopClient(
    "https://gateway.example",
    "synthetic-key",
    async (url, options) => {
      calls.push({ url, options });
      return Response.json(payment);
    },
  );
  const request = {
    orderId: "ORDER-17",
    amountRupees: 10,
    profile: "bharatpe",
    returnUrl: "https://shop.example/return",
  };
  const first = await client.createPayment(request);
  await client.createPayment(request);
  assert.equal(first.payableAmountPaise, 1099);
  assert.equal(
    calls[0].options.headers["Idempotency-Key"],
    calls[1].options.headers["Idempotency-Key"],
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-key");
  const expected = {
    paymentId: fixture.id,
    orderId: "ORDER-17",
    amountRupees: 10,
    payableAmountPaise: 1099,
    profile: "bharatpe",
  };
  assert.equal((await client.verifyPayment(fixture.id, expected)).paid, false);
  payment = { ...fixture, status: "paid" };
  assert.equal((await client.verifyPayment(fixture.id, expected)).paid, true);
  for (const changed of [
    { orderId: "OTHER" },
    { payableAmountPaise: 1098 },
    { amountRupees: 9 },
    { profile: "paytm" },
    { paymentId: "another" },
  ])
    await assert.rejects(
      client.verifyPayment(fixture.id, { ...expected, ...changed }),
    );
  payment = { ...fixture, checkout_url: "https://evil.example/pay/payment-17" };
  await assert.rejects(client.createPayment(request));
  assert.throws(() => amountPaise("10.999"));
  assert.throws(() => new FFShopClient("http://gateway.example", "key"));
});
test("webhook verification requires original raw body, correct HMAC and recent timestamp", async () => {
  const raw = '{"id":"paid_payment-17","type":"payment.paid"}',
    timestamp = String(Math.floor(Date.now() / 1000)),
    secret = "synthetic";
  const sig = createHmac("sha256", secret)
    .update(timestamp + "." + raw)
    .digest("hex");
  assert.equal(await verifyWebhook(raw, timestamp, sig, secret), true);
  assert.equal(await verifyWebhook(raw + " ", timestamp, sig, secret), false);
  assert.equal(await verifyWebhook(raw, timestamp, sig, "different"), false);
  assert.equal(
    await verifyWebhook(raw, timestamp, sig, secret, Date.now() + 360000),
    false,
  );
  assert.equal(await verifyWebhook(raw, timestamp, "bad", secret), false);
});

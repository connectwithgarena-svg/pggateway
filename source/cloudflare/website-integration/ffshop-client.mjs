// SERVER ONLY. Never bundle this module or its API key into browser JavaScript.
const bytes = new TextEncoder();
const hex = (value) =>
  [...new Uint8Array(value)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export function amountPaise(value) {
  if (typeof value !== "string" || !/^\d{1,8}\.\d{2}$/.test(value))
    throw Error("Invalid gateway amount");
  const [whole, fraction] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(result)) throw Error("Invalid gateway amount");
  return result;
}
export class FFShopClient {
  constructor(origin, apiKey, transport = fetch) {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      typeof apiKey !== "string" ||
      !apiKey
    )
      throw Error("Configure your gateway HTTPS origin and server API key");
    this.origin = url.origin;
    this.apiKey = apiKey;
    this.transport = transport;
  }
  async request(path, body, idempotencyKey) {
    const response = await this.transport(this.origin + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw Error(
        "Gateway request failed (HTTP " +
          response.status +
          "). Retry safely using the same shop order.",
      );
    return response.json();
  }
  async createPayment({ orderId, amountRupees, profile, returnUrl }) {
    if (
      typeof orderId !== "string" ||
      !orderId ||
      orderId.length > 120 ||
      !Number.isSafeInteger(amountRupees) ||
      amountRupees < 1 ||
      amountRupees > 100000
    )
      throw Error(
        "Load a valid order ID and whole-rupee price from your server database",
      );
    const key = hex(
      await crypto.subtle.digest(
        "SHA-256",
        bytes.encode("ffshop-order:" + orderId),
      ),
    );
    const payment = await this.request(
      "/api/v1/payments",
      {
        name: "Order " + orderId.slice(0, 100),
        amount: amountRupees,
        external_id: orderId,
        ...(profile ? { profile } : {}),
        return_url: returnUrl,
      },
      key,
    );
    const checkout = new URL(payment.checkout_url);
    if (
      checkout.origin !== this.origin ||
      checkout.pathname !== "/pay/" + payment.id ||
      checkout.search ||
      checkout.hash ||
      checkout.username ||
      checkout.password ||
      payment.external_id !== orderId ||
      amountPaise(payment.requested_amount) !== amountRupees * 100
    )
      throw Error("Unexpected gateway order response");
    if (
      !["paytm", "phonepe", "hdfc", "bharatpe", "gpay"].includes(
        payment.profile,
      ) ||
      (profile && payment.profile !== profile)
    )
      throw Error("Unexpected receiving account");
    const payable = amountPaise(payment.payable_amount);
    if (payable <= amountRupees * 100 || payable > amountRupees * 100 + 99)
      throw Error(
        "Unexpected payable amount; reconcile an older order before retrying",
      );
    return { ...payment, payableAmountPaise: payable };
  }
  async verifyPayment(paymentId, expected) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId) ||
      paymentId !== expected.paymentId
    )
      throw Error("Order/payment mapping mismatch");
    const payment = await this.request(
      "/api/v1/payments/" + encodeURIComponent(paymentId),
    );
    if (
      payment.id !== expected.paymentId ||
      payment.external_id !== expected.orderId ||
      amountPaise(payment.requested_amount) !== expected.amountRupees * 100 ||
      amountPaise(payment.payable_amount) !== expected.payableAmountPaise ||
      payment.profile !== expected.profile
    )
      throw Error("Payment details do not match your saved order");
    return { paid: payment.status === "paid", payment };
  }
}
export async function verifyWebhook(
  rawBody,
  timestamp,
  signature,
  secret,
  now = Date.now(),
) {
  if (
    typeof rawBody !== "string" ||
    rawBody.length > 65536 ||
    typeof timestamp !== "string" ||
    !/^\d{10}$/.test(timestamp) ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    typeof secret !== "string" ||
    !secret ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    bytes.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../g), (h) => parseInt(h, 16)),
    bytes.encode(timestamp + "." + rawBody),
  );
}

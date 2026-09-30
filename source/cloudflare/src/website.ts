import { Env, fail, one } from "./core";
import { validWebhook } from "./jobs";

export function normalizeReturnURL(value: unknown): string {
  if (typeof value !== "string" || !validWebhook(value))
    fail(
      400,
      "return_url",
      "Use an HTTPS return URL on your configured website",
    );
  return new URL(value as string).href;
}

export async function websiteReturn(env: Env, payment: any) {
  if (payment.status !== "paid") return undefined;
  const target = await one(
    env,
    "SELECT url FROM payment_returns WHERE payment_id=?",
    payment.id,
  );
  const website = await one(
    env,
    "SELECT value FROM settings WHERE key='website_origin'",
  );
  if (!target || !website || !validWebhook(target.url)) return undefined;
  const url = new URL(target.url);
  // Recheck the currently approved origin, including already-created payments.
  if (url.origin !== website.value || url.origin === env.PUBLIC_ORIGIN)
    return undefined;
  url.searchParams.set("ffshop_payment_id", payment.id);
  return url.href;
}

import { Env, sql, one, rows, token, enc, hex } from "./core";
export function validWebhook(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      (!u.port || u.port === "443") &&
      u.hostname.includes(".") &&
      !u.hostname.endsWith(".localhost") &&
      !u.hostname.endsWith(".local") &&
      !u.hostname.endsWith(".internal") &&
      !/^[\d.]+$/.test(u.hostname) &&
      !u.hostname.includes(":") &&
      u.href.length < 2048
    );
  } catch {
    return false;
  }
}
export async function maintenance(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    sql(
      env,
      "UPDATE payments SET status='expired' WHERE status='pending' AND grace<?",
      now,
    ),
    sql(env, "DELETE FROM slots WHERE until<=?", now),
    sql(env, "DELETE FROM sessions WHERE expires<=?", now),
    sql(env, "DELETE FROM limits WHERE expires<=?", now),
    sql(
      env,
      "DELETE FROM pairings WHERE expires<=? AND device_id IS NULL",
      now,
    ),
  ]);
  // Bound work per invocation for the Free plan. Lease each delivery atomically.
  const due = await rows(
    env,
    "SELECT id FROM deliveries WHERE status IN ('pending','retry') AND next_at<=? AND lease_until<=? ORDER BY next_at LIMIT 5",
    now,
    now,
  );
  for (const item of due) {
    const lease = token();
    const d = await one(
      env,
      `UPDATE deliveries SET lease=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status IN ('pending','retry') AND lease_until<=? RETURNING *`,
      lease,
      Date.now() + 30000,
      item.id,
      now,
    );
    if (!d) continue;
    let status = 0;
    // Recheck consent after claiming. Configuration changes cancel queued sends;
    // an HTTP request already in flight cannot be recalled.
    const configured = await one(
      env,
      "SELECT value FROM settings WHERE key='webhook'",
    );
    let active: { endpoint?: string; secret?: string } = {};
    try {
      active = JSON.parse(configured?.value || "{}");
    } catch {
      /* fail closed */
    }
    if (
      !active.endpoint ||
      active.endpoint !== d.endpoint ||
      active.secret !== d.secret
    ) {
      await sql(
        env,
        "UPDATE deliveries SET status='cancelled',endpoint='',secret='',payload='',lease=NULL,lease_until=0 WHERE id=? AND lease=?",
        d.id,
        lease,
      ).run();
      continue;
    }
    if (validWebhook(d.endpoint))
      try {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const key = await crypto.subtle.importKey(
          "raw",
          enc.encode(d.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const signature = hex(
          await crypto.subtle.sign(
            "HMAC",
            key,
            enc.encode(`${timestamp}.${d.payload}`),
          ),
        );
        const response = await fetch(d.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FFSHOP-Event": d.id,
            "X-FFSHOP-Timestamp": timestamp,
            "X-FFSHOP-Signature": signature,
          },
          body: d.payload,
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        status = response.status;
        await response.body?.cancel();
      } catch {
        /* Retry network failures; never include URLs, secrets or response bodies in logs. */
      }
    const delivered = status >= 200 && status < 300;
    await sql(
      env,
      "UPDATE deliveries SET status=?,next_at=?,lease=NULL,lease_until=0,last_status=? WHERE id=? AND lease=?",
      delivered ? "delivered" : d.attempts >= 10 ? "exhausted" : "retry",
      Date.now() + Math.min(3600000, 30000 * 2 ** d.attempts),
      status,
      d.id,
      lease,
    ).run();
  }
}
export default {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(maintenance(env));
  },
  fetch() {
    return new Response("FFSHOP maintenance", { status: 200 });
  },
};

import { normalizeReturnURL, websiteReturn } from "./website";
import {
  Env,
  HttpError,
  fail,
  text,
  sha,
  equal,
  token,
  id,
  sql,
  one,
  rows,
  json,
  readJSON,
  limit,
  providers,
  importPEM,
  authenticateRelay,
  viewPayment,
} from "./core";
import { createPayment, ingest } from "./payments";
import { validWebhook } from "./jobs";
async function admin(req: Request, env: Env) {
  const session = req.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)__Host-ffshop=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (
    !session ||
    !(await one(
      env,
      "SELECT 1 FROM sessions WHERE hash=? AND expires>?",
      await sha(session),
      Date.now(),
    ))
  )
    fail(401, "unauthorized", "Log in to FFSHOP");
}
async function apiAuth(req: Request, env: Env) {
  const key = req.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  const row = await one(
    env,
    "SELECT id FROM api_keys WHERE hash=? AND enabled=1",
    await sha(key),
  );
  if (!row) fail(401, "unauthorized", "Valid shop API key required");
  return row.id;
}
function sameOrigin(req: Request, env: Env) {
  if (req.headers.get("Origin") !== env.PUBLIC_ORIGIN)
    fail(403, "origin", "Request must come from your dashboard");
}
const sessionCookie = (value: string, max: number) =>
  `__Host-ffshop=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${max}`;
async function route(req: Request, env: Env) {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method;
  if (path === "/healthz")
    return json({ ok: true, app: "FF Shop", version: "1.7.0" });
  if (path === "/api/config")
    return json({ source_url: "/source.zip", version: "1.7.0" });
  if (path === "/api/readiness" && method === "GET") {
    const checks = {
      origin: env.PUBLIC_ORIGIN === url.origin && url.protocol === "https:",
      admin_key: /^[a-f0-9]{64}$/.test(env.ADMIN_KEY_HASH || ""),
      database: !!env.DB,
      schema: false,
    };
    try {
      checks.schema =
        !!env.DB &&
        (
          await one(
            env,
            "SELECT value FROM settings WHERE key='schema_version'",
          )
        )?.value === "5";
    } catch {
      /* Public diagnostics never expose database contents or errors. */
    }
    const ok = Object.values(checks).every(Boolean);
    return json({ ok, version: "1.7.0", checks }, ok ? 200 : 503);
  }
  const dynamic = path.startsWith("/admin/") || path.startsWith("/api/");
  if (!dynamic) {
    if (!env.ASSETS) return new Response("Assets unavailable", { status: 404 });
    const assetURL = new URL(req.url);
    // Pages redirects /index.html to /. Fetch the canonical asset path
    // internally so the dashboard and checkout keep their browser URL.
    if (path.startsWith("/pay/")) assetURL.pathname = "/";
    if (path.startsWith("/device/pair/"))
      return new Response(
        "Paste this complete URL in the FFSHOP Android app. Do not share it.",
        {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          },
        },
      );
    return env.ASSETS.fetch(new Request(assetURL, req));
  }
  if (
    !env.DB ||
    !env.PUBLIC_ORIGIN ||
    !/^https:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN) ||
    !/^[a-f0-9]{64}$/.test(env.ADMIN_KEY_HASH || "")
  )
    fail(503, "not_configured", "Complete Cloudflare setup first");
  if (path.startsWith("/admin/") && method !== "GET") sameOrigin(req, env);
  if (path === "/admin/session" && method === "POST") {
    await limit(
      env,
      "login:" + (await sha(req.headers.get("CF-Connecting-IP") || "local")),
      10,
      900000,
    );
    const { value } = await readJSON(req);
    if (
      typeof value.password !== "string" ||
      value.password.length > 256 ||
      !equal(await sha(value.password), env.ADMIN_KEY_HASH)
    )
      fail(401, "unauthorized", "Incorrect admin key");
    const secret = token();
    await sql(
      env,
      "INSERT INTO sessions(hash,expires) VALUES(?,?)",
      await sha(secret),
      Date.now() + 28800000,
    ).run();
    return json({ ok: true }, 200, {
      "Set-Cookie": sessionCookie(secret, 28800),
    });
  }
  if (path.startsWith("/admin/")) await admin(req, env);
  if (path === "/admin/session" && method === "DELETE") {
    const cookie = req.headers
      .get("Cookie")
      ?.match(/__Host-ffshop=([a-f0-9]{64})/)?.[1];
    if (cookie)
      await sql(
        env,
        "DELETE FROM sessions WHERE hash=?",
        await sha(cookie),
      ).run();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }
  if (path === "/admin/state" && method === "GET")
    return json({
      summary: await one(
        env,
        `SELECT COUNT(*) AS orders, SUM(CASE WHEN status='paid' THEN payable ELSE 0 END) AS collected, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN status='pending' AND grace>? THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status='paid' AND paid_at>=? THEN payable ELSE 0 END) AS today_collected FROM payments`,
        Date.now(),
        Math.floor(Date.now() / 86400000) * 86400000,
      ),
      reviews: await rows(
        env,
        "SELECT payment_id,reference,created FROM reviews ORDER BY created DESC LIMIT 30",
      ),
      profiles: await rows(
        env,
        "SELECT p.*, (SELECT COUNT(*) FROM payments WHERE profile=p.id AND status='pending' AND grace>unixepoch('subsec')*1000) AS pending_orders FROM profiles p WHERE removed=0",
      ),
      devices: await rows(
        env,
        "SELECT id,name,epoch,enabled,last_seen,health FROM devices",
      ),
      payments: (
        await rows(
          env,
          "SELECT * FROM payments ORDER BY created DESC LIMIT 100",
        )
      ).map((p) => viewPayment(p, env.PUBLIC_ORIGIN)),
      events: await rows(
        env,
        "SELECT id,package,status,payment_id,received,amount,reason FROM events ORDER BY received DESC LIMIT 50",
      ),
      keys: await rows(env, "SELECT id,label,enabled FROM api_keys"),
      deliveries: await rows(
        env,
        "SELECT id,payment_id,status,attempts,last_status FROM deliveries ORDER BY next_at DESC LIMIT 30",
      ),
      website: await one(
        env,
        "SELECT value AS origin FROM settings WHERE key='website_origin'",
      ),
      webhook: await one(
        env,
        "SELECT json_extract(value,'$.endpoint') AS endpoint FROM settings WHERE key='webhook'",
      ),
    });
  if (path === "/admin/payments" && method === "GET") {
    const page = Math.max(
      1,
      Math.min(100000, Number(url.searchParams.get("page")) || 1),
    );
    if (!Number.isSafeInteger(page)) fail(400, "page", "Invalid page");
    const status = url.searchParams.get("status") || "";
    const profile = url.searchParams.get("profile") || "";
    const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
    if (status && !["paid", "pending", "expired", "cancelled"].includes(status))
      fail(400, "status", "Invalid status");
    if (profile && !Object.values(providers).includes(profile))
      fail(400, "provider", "Invalid provider");
    const clauses: string[] = [],
      args: any[] = [];
    const currentStatus =
      "CASE WHEN status='pending' AND grace<? THEN 'expired' ELSE status END";
    if (status) {
      clauses.push(currentStatus + "=?");
      args.push(Date.now(), status);
    }
    if (profile) {
      clauses.push("profile=?");
      args.push(profile);
    }
    if (search) {
      clauses.push(
        "(name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' OR external_id LIKE ? ESCAPE '\\')",
      );
      const match = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
      args.push(match, match, match);
    }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const count = await one(
      env,
      "SELECT COUNT(*) AS total FROM payments" + where,
      ...args,
    );
    const payments = await rows(
      env,
      "SELECT * FROM payments" +
        where +
        " ORDER BY created DESC,id DESC LIMIT 25 OFFSET ?",
      ...args,
      (page - 1) * 25,
    );
    return json({
      payments: payments.map((p) => viewPayment(p, env.PUBLIC_ORIGIN)),
      total: count.total,
      page,
      pages: Math.max(1, Math.ceil(count.total / 25)),
    });
  }
  const paymentRoute = path.match(/^\/admin\/payments\/([^/]+)$/);
  if (paymentRoute && method === "GET") {
    const payment = await one(
      env,
      "SELECT * FROM payments WHERE id=?",
      paymentRoute[1],
    );
    if (!payment) fail(404, "not_found", "Order not found");
    return json(viewPayment(payment, env.PUBLIC_ORIGIN));
  }
  if (path === "/admin/profiles" && method === "POST") {
    const { value: b } = await readJSON(req);
    if (!Object.values(providers).includes(b.id))
      fail(400, "provider", "Select a supported business app");
    const upi = text(b.upi, 255);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}@[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(
        upi,
      )
    )
      fail(400, "upi", "Enter the UPI ID encoded in your merchant QR");
    const old = await one(env, "SELECT * FROM profiles WHERE id=?", b.id);
    if (
      old &&
      old.upi !== upi &&
      (await one(
        env,
        "SELECT 1 FROM payments WHERE profile=? AND status='pending' AND grace>? LIMIT 1",
        b.id,
        Date.now(),
      ))
    )
      fail(
        409,
        "pending_orders",
        "Wait for this merchant’s pending orders before changing UPI ID",
      );
    const makeDefault = b.active !== false;
    const enabled = makeDefault || !old || old.removed ? 1 : old.enabled;
    await env.DB.batch([
      ...(makeDefault ? [sql(env, "UPDATE profiles SET active=0")] : []),
      sql(
        env,
        "INSERT INTO profiles(id,label,upi,payee,active,enabled,removed) VALUES(?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET label=excluded.label,upi=excluded.upi,payee=excluded.payee,active=CASE WHEN excluded.active=1 THEN 1 ELSE profiles.active END,enabled=excluded.enabled,removed=0",
        b.id,
        text(b.label),
        upi,
        text(b.payee),
        makeDefault ? 1 : 0,
        enabled,
      ),
    ]);
    return json({ ok: true });
  }
  const accountRoute = path.match(
    /^\/admin\/profiles\/(paytm|phonepe|hdfc|bharatpe)(?:\/(default|enabled))?$/,
  );
  if (accountRoute && (method === "POST" || method === "DELETE")) {
    const [, profileId, command] = accountRoute;
    const profile = await one(
      env,
      "SELECT * FROM profiles WHERE id=? AND removed=0",
      profileId,
    );
    if (!profile) fail(404, "not_found", "Business account not found");
    if (method === "DELETE" && !command) {
      if (
        await one(
          env,
          "SELECT 1 FROM payments WHERE profile=? AND status='pending' AND grace>? LIMIT 1",
          profileId,
          Date.now(),
        )
      )
        fail(
          409,
          "pending_orders",
          "Cancel or finish pending orders before removing this account",
        );
      await sql(
        env,
        "UPDATE profiles SET active=0,enabled=0,removed=1 WHERE id=?",
        profileId,
      ).run();
    } else if (method === "POST" && command === "default") {
      if (!profile.enabled)
        fail(409, "account_disabled", "Enable this business account first");
      await env.DB.batch([
        sql(env, "UPDATE profiles SET active=0"),
        sql(
          env,
          "UPDATE profiles SET active=1 WHERE id=? AND enabled=1 AND removed=0",
          profileId,
        ),
      ]);
    } else if (method === "POST" && command === "enabled") {
      const { value: b } = await readJSON(req);
      if (typeof b.enabled !== "boolean")
        fail(400, "invalid_input", "Choose enabled or disabled");
      await sql(
        env,
        "UPDATE profiles SET enabled=?,active=CASE WHEN ?=0 THEN 0 ELSE active END WHERE id=? AND removed=0",
        b.enabled ? 1 : 0,
        b.enabled ? 1 : 0,
        profileId,
      ).run();
    } else fail(404, "not_found", "Account action not found");
    return json({ ok: true });
  }
  const reviewRoute = path.match(/^\/admin\/payments\/([^/]+)\/confirm$/);
  if (reviewRoute && method === "POST") {
    const { value: b } = await readJSON(req);
    const p = await one(
      env,
      "SELECT * FROM payments WHERE id=?",
      reviewRoute[1],
    );
    if (!p) fail(404, "not_found", "Order not found");
    if (!["pending", "expired"].includes(p.status))
      fail(409, "order_closed", "This order is already paid or cancelled");
    if (
      b.checked !== true ||
      !Number.isSafeInteger(b.amount_paise) ||
      b.amount_paise !== p.payable
    )
      fail(
        400,
        "verify_credit",
        "Check the credit in your merchant history and enter the exact payable amount",
      );
    const reference = text(b.reference, 80).toUpperCase();
    if (!/^[A-Z0-9_-]{6,80}$/.test(reference))
      fail(
        400,
        "reference",
        "Enter the transaction reference or UTR (6–80 letters/numbers)",
      );
    if (
      await one(
        env,
        "SELECT 1 FROM reviews WHERE profile=? AND reference=?",
        p.profile,
        reference,
      )
    )
      fail(
        409,
        "reference_used",
        "This transaction reference has already confirmed an order",
      );
    const reviewId = id(),
      now = Date.now();
    try {
      await env.DB.batch([
        sql(
          env,
          "INSERT INTO reviews(id,payment_id,profile,reference,amount,created) SELECT ?,id,profile,?,payable,? FROM payments WHERE id=? AND status IN ('pending','expired')",
          reviewId,
          reference,
          now,
          p.id,
        ),
        sql(
          env,
          "UPDATE payments SET status='paid',paid_at=?,evidence=? WHERE id=? AND status IN ('pending','expired') AND EXISTS(SELECT 1 FROM reviews WHERE id=?)",
          now,
          "manual:" + reviewId,
          p.id,
          reviewId,
        ),
      ]);
    } catch (e) {
      if (String(e).includes("UNIQUE constraint failed: reviews"))
        fail(
          409,
          "review_conflict",
          "This order or transaction reference was already confirmed",
        );
      throw e;
    }
    const result = await one(env, "SELECT * FROM payments WHERE id=?", p.id);
    if (result.evidence !== "manual:" + reviewId)
      fail(
        409,
        "order_closed",
        "Order changed during review; refresh its status",
      );
    return json(viewPayment(result, env.PUBLIC_ORIGIN));
  }
  if (path === "/admin/pair" && method === "POST") {
    const secret = token(),
      expires = Date.now() + 300000;
    await sql(
      env,
      "INSERT INTO pairings(hash,expires) VALUES(?,?)",
      await sha(secret),
      expires,
    ).run();
    return json({
      pairing_url: `${env.PUBLIC_ORIGIN}/device/pair/${secret}`,
      expires_at: new Date(expires).toISOString(),
    });
  }
  if (path.startsWith("/admin/devices/") && method === "DELETE") {
    await sql(
      env,
      "UPDATE devices SET enabled=0 WHERE id=?",
      path.split("/").pop(),
    ).run();
    return json({ ok: true });
  }
  if (path === "/admin/keys" && method === "POST") {
    const { value: b } = await readJSON(req),
      secret = token(),
      keyId = id();
    await sql(
      env,
      "INSERT INTO api_keys(id,label,hash) VALUES(?,?,?)",
      keyId,
      text(b.label),
      await sha(secret),
    ).run();
    return json({ id: keyId, secret });
  }
  if (path.startsWith("/admin/keys/") && method === "DELETE") {
    await sql(
      env,
      "UPDATE api_keys SET enabled=0 WHERE id=?",
      path.split("/").pop(),
    ).run();
    return json({ ok: true });
  }
  if (path === "/admin/website" && method === "POST") {
    const { value: b } = await readJSON(req);
    let origin = "";
    if (b.origin !== "") {
      const url = new URL(normalizeReturnURL(b.origin));
      if (
        url.pathname !== "/" ||
        url.search ||
        url.origin === env.PUBLIC_ORIGIN
      )
        fail(
          400,
          "website_origin",
          "Enter only your website HTTPS origin, for example https://shop.example",
        );
      origin = url.origin;
    }
    await sql(
      env,
      "INSERT INTO settings(key,value) VALUES('website_origin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      origin,
    ).run();
    return json({ origin });
  }
  if (path === "/admin/webhook" && method === "POST") {
    const { value: b } = await readJSON(req);
    if (
      typeof b.endpoint !== "string" ||
      (b.endpoint && !validWebhook(b.endpoint))
    )
      fail(400, "webhook", "Use a public HTTPS URL without credentials");
    const secret = token();
    await env.DB.batch([
      sql(
        env,
        "INSERT INTO settings(key,value) VALUES('webhook',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        JSON.stringify({ endpoint: b.endpoint, secret }),
      ),
      sql(
        env,
        "UPDATE deliveries SET status='cancelled',endpoint='',secret='',payload='',lease=NULL,lease_until=0 WHERE status IN ('pending','retry','exhausted')",
      ),
    ]);
    return json({ secret });
  }
  if (path.startsWith("/admin/deliveries/") && method === "POST") {
    await sql(
      env,
      "UPDATE deliveries SET status='retry',attempts=0,next_at=?,lease=NULL,lease_until=0 WHERE id=? AND status='exhausted'",
      Date.now(),
      path.split("/").pop(),
    ).run();
    return json({ ok: true });
  }
  if (
    (path === "/admin/payments" || path === "/api/v1/payments") &&
    method === "POST"
  ) {
    const scope = path.startsWith("/admin/")
      ? "admin"
      : await apiAuth(req, env);
    await limit(env, "create:" + scope, 120, 60000);
    const { value } = await readJSON(req);
    const result = await createPayment(
      env,
      value,
      req.headers.get("Idempotency-Key"),
      scope,
    );
    return json(result.payment, result.replayed ? 200 : 201);
  }
  if (path.startsWith("/api/v1/payments/") && method === "GET") {
    const scope = await apiAuth(req, env);
    const p = await one(
      env,
      "SELECT * FROM payments WHERE id=? AND scope=?",
      path.split("/").pop(),
      scope,
    );
    if (!p) fail(404, "not_found", "Order not found");
    return json(viewPayment(p, env.PUBLIC_ORIGIN));
  }
  if (path.startsWith("/api/checkout/") && method === "GET") {
    const p = await one(
      env,
      "SELECT * FROM payments WHERE id=?",
      path.split("/").pop(),
    );
    if (!p) fail(404, "not_found", "Order not found");
    const view = viewPayment(p, env.PUBLIC_ORIGIN);
    return json({
      ...view,
      name: "FFSHOP payment",
      external_id: undefined,
      return_url: await websiteReturn(env, p),
    });
  }
  if (path.startsWith("/admin/cancel/") && method === "POST") {
    await sql(
      env,
      "UPDATE payments SET status='cancelled' WHERE id=? AND status='pending'",
      path.split("/").pop(),
    ).run();
    return json({ ok: true });
  }
  if (path === "/api/v4/relay/pair" && method === "POST") {
    await limit(
      env,
      "pair:" + (await sha(req.headers.get("CF-Connecting-IP") || "local")),
      20,
      900000,
    );
    const { value: b } = await readJSON(req),
      hash = await sha(text(b.token, 256)),
      pem = text(b.public_key_pem, 1024);
    await importPEM(pem);
    // The installed Android relay requires a 32-byte lowercase hex device ID.
    const deviceId = token(),
      epoch = Date.now();
    try {
      const result = await sql(
        env,
        "INSERT INTO devices(id,pair_hash,name,pem,epoch) SELECT ?,hash,?,?,? FROM pairings WHERE hash=? AND device_id IS NULL AND expires>?",
        deviceId,
        typeof b.name === "string" ? b.name.slice(0, 120) : "FFSHOP phone",
        pem,
        epoch,
        hash,
        epoch,
      ).run();
      if (!result.meta.changes)
        fail(401, "invalid_pairing", "Pairing link used or expired");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (/UNIQUE/.test(String(e)))
        fail(401, "invalid_pairing", "Pairing link used or expired");
      throw e;
    }
    return json({ device_id: deviceId, enabled: true, enrolled_at_ms: epoch });
  }
  if (path.startsWith("/api/v4/relay/") && method === "POST") {
    if (url.search)
      fail(400, "invalid_request", "Relay query parameters are not allowed");
    const { raw, value: b } = await readJSON(req),
      device = await authenticateRelay(req, env, raw);
    if (path === "/api/v4/relay/events")
      return json(await ingest(env, device, b));
    if (path === "/api/v4/relay/heartbeat") {
      if (b.schema_version !== 1) fail(400, "schema", "Invalid heartbeat");
      await sql(
        env,
        "UPDATE devices SET last_seen=?,health=? WHERE id=? AND enabled=1 AND epoch=?",
        Date.now(),
        JSON.stringify({
          notification_access: b.notification_access === true,
          listener_connected: b.listener_connected === true,
          pending_count: Number.isSafeInteger(b.pending_count)
            ? b.pending_count
            : 0,
          last_client_error:
            typeof b.last_client_error === "string"
              ? b.last_client_error.slice(0, 200)
              : "",
        }),
        device.id,
        device.epoch,
      ).run();
      return json({ received_at: new Date().toISOString() });
    }
  }
  fail(404, "not_found", "Endpoint not found");
}
export default {
  async fetch(req: Request, env: Env) {
    let response: Response;
    try {
      response = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError)
        response = json(
          { error: { code: e.code, message: e.message } },
          e.status,
        );
      else if (String(e).includes("pending_destination_change"))
        response = json(
          {
            error: {
              code: "pending_orders",
              message: "Wait for pending orders before changing this UPI ID",
            },
          },
          409,
        );
      else {
        console.error("FFSHOP request failed");
        response = json(
          {
            error: {
              code: "internal_error",
              message: "Temporary server error; retry with the same order key",
            },
          },
          500,
        );
      }
    }
    response = new Response(response.body, response);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    return response;
  },
};

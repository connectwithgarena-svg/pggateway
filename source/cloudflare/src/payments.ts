import { normalizeReturnURL } from "./website";
import { bharatPeList, ingestBharatPeList } from "./bharatpe";
import {
  Env,
  fail,
  text,
  sha,
  id,
  sql,
  one,
  rows,
  analyzeNotification,
  viewPayment,
} from "./core";
export async function createPayment(
  env: Env,
  body: any,
  key: string | null,
  scope: string,
) {
  if (!key || key.length > 128 || !/^[\w-]+$/.test(key))
    fail(400, "idempotency_required", "Send a unique Idempotency-Key");
  if (
    !Number.isSafeInteger(body.amount) ||
    body.amount < 1 ||
    body.amount > 100000
  )
    fail(
      400,
      "invalid_amount",
      "Amount must be whole rupees between 1 and 100000",
    );
  const name = text(body.name),
    external =
      body.external_id === undefined ? "" : text(body.external_id, 120);
  if (
    body.profile !== undefined &&
    !["paytm", "phonepe", "hdfc", "bharatpe", "gpay"].includes(body.profile)
  )
    fail(400, "provider", "Select a supported business account");
  const returnURL =
    body.return_url === undefined ? "" : normalizeReturnURL(body.return_url);
  const identity: unknown[] =
    body.profile === undefined
      ? [body.amount, name, external]
      : [body.amount, name, external, body.profile];
  if (returnURL) identity.push({ return_url: returnURL });
  const requestHash = await sha(JSON.stringify(identity));
  const existing = await one(
    env,
    "SELECT * FROM payments WHERE scope=? AND idem=?",
    scope,
    key,
  );
  if (existing) {
    if (existing.request_hash !== requestHash)
      fail(409, "idempotency_conflict", "Key already used for another order");
    return {
      payment: viewPayment(existing, env.PUBLIC_ORIGIN),
      replayed: true,
    };
  }
  if (returnURL) {
    const website = await one(
      env,
      "SELECT value FROM settings WHERE key='website_origin'",
    );
    if (
      !website ||
      new URL(returnURL).origin !== website.value ||
      website.value === env.PUBLIC_ORIGIN
    )
      fail(
        400,
        "return_origin",
        "Save your website origin in Integrations before using its return URL",
      );
  }
  const profile = body.profile
    ? await one(
        env,
        "SELECT * FROM profiles WHERE id=? AND enabled=1 AND removed=0",
        body.profile,
      )
    : await one(
        env,
        "SELECT * FROM profiles WHERE active=1 AND enabled=1 AND removed=0",
      );
  if (!profile)
    fail(
      409,
      "no_profile",
      "Save and activate a merchant QR destination first",
    );
  const now = Date.now(),
    paymentId = id(),
    requested = body.amount * 100;
  // Keep the amount reserved for a day, including paid/cancelled orders.
  const expires = now + 300000,
    grace = now + 600000,
    reuse = now + 86400000;
  await sql(env, "DELETE FROM slots WHERE until<=?", now).run();
  const used = new Set(
    (
      await rows(
        env,
        "SELECT amount FROM slots WHERE amount BETWEEN ? AND ?",
        requested + 1,
        requested + 99,
      )
    ).map((r: any) => r.amount),
  );
  const candidates = Array.from({ length: 99 }, (_, i) => i + 1).filter(
    (n) => (requested + n) % 100 !== 0 && !used.has(requested + n),
  );
  const maxAttempts = Math.min(20, candidates.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const offset = candidates.splice(
      crypto.getRandomValues(new Uint32Array(1))[0] % candidates.length,
      1,
    )[0];
    try {
      await env.DB.batch([
        sql(
          env,
          `INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,external_id,created,expires,grace,reuse) SELECT ?,?,?,?,?,?,id,upi,payee,?,?,?,?,?,? FROM profiles WHERE id=? AND enabled=1 AND removed=0 AND (?=1 OR active=1) AND upi=?`,
          paymentId,
          scope,
          key,
          requestHash,
          requested,
          requested + offset,
          name,
          external,
          now,
          expires,
          grace,
          reuse,
          profile.id,
          body.profile ? 1 : 0,
          profile.upi,
        ),
        sql(
          env,
          "INSERT INTO slots(amount,payment_id,until) VALUES(?,?,?)",
          requested + offset,
          paymentId,
          reuse,
        ),
        ...(returnURL
          ? [
              sql(
                env,
                "INSERT INTO payment_returns(payment_id,url) VALUES(?,?)",
                paymentId,
                returnURL,
              ),
            ]
          : []),
      ]);
      return {
        payment: viewPayment(
          await one(env, "SELECT * FROM payments WHERE id=?", paymentId),
          env.PUBLIC_ORIGIN,
        ),
        replayed: false,
      };
    } catch (err) {
      const replay = await one(
        env,
        "SELECT * FROM payments WHERE scope=? AND idem=?",
        scope,
        key,
      );
      if (replay) {
        if (replay.request_hash !== requestHash)
          fail(
            409,
            "idempotency_conflict",
            "Key already used for another order",
          );
        return {
          payment: viewPayment(replay, env.PUBLIC_ORIGIN),
          replayed: true,
        };
      }
      if (!/UNIQUE constraint failed: slots.amount/.test(String(err)))
        throw err;
    }
  }
  fail(
    409,
    "amount_capacity",
    "No unique payable amount available. Try again later.",
  );
}
export async function ingest(env: Env, device: any, event: any) {
  if (
    event.schema_version !== 1 ||
    typeof event.event_id !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(event.event_id) ||
    typeof event.package_name !== "string" ||
    event.package_name.length > 150 ||
    !Number.isSafeInteger(event.posted_at_ms)
  )
    fail(400, "invalid_event", "Invalid event");
  for (const field of ["title", "text", "big_text"])
    if (
      event[field] !== undefined &&
      (typeof event[field] !== "string" || event[field].length > 8192)
    )
      fail(400, "invalid_event", "Notification too long");
  const now = Date.now();
  if (
    event.posted_at_ms < device.epoch ||
    event.posted_at_ms > now + 60000 ||
    event.posted_at_ms < now - 86400000
  )
    fail(400, "invalid_event_time", "Notification outside allowed time window");
  const hash = await sha(
    JSON.stringify([
      event.package_name,
      event.posted_at_ms,
      event.title || "",
      event.text || "",
      event.big_text || "",
    ]),
  );
  const eventId = await sha(device.id + "\n" + event.event_id),
    analysis =
      event.package_name === "com.bharatpe.app" &&
      /^(?:\d{1,2}:\d{2}\s*(?:AM|PM)|Close|Refresh)\s*$/im.test(
        event.big_text || "",
      )
        ? { observation: null, reason: "bharatpe_unrecognized_list" }
        : analyzeNotification(event),
    obs = analysis.observation;
  const list = bharatPeList(event);
  if (list) return ingestBharatPeList(env, device, event, eventId, hash, list);
  // SQL selects the candidate and applies its transition in the same transaction.
  // Device authorization is checked again in SQL to close revocation races.
  const result = await sql(
    env,
    `INSERT OR IGNORE INTO events(id,device_id,source_id,hash,package,profile,amount,posted,received,reason,status,payment_id)
 SELECT ?,?,?,?,?,?,?,?, ?,?,CASE WHEN ? IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=?) THEN 'ignored' ELSE 'unmatched' END,
 (SELECT p.id FROM payments p JOIN slots s ON s.payment_id=p.id WHERE p.profile=? AND s.amount=? AND p.created<=? AND ?<=p.expires AND ?<=p.grace AND s.until>? AND p.status IN ('pending','paid'))
 WHERE EXISTS(SELECT 1 FROM devices WHERE id=? AND enabled=1 AND epoch=?)`,
    eventId,
    device.id,
    event.event_id,
    hash,
    event.package_name,
    obs?.profile ?? null,
    obs?.amount ?? null,
    event.posted_at_ms,
    now,
    obs
      ? "Check business account, exact amount and order time window"
      : analysis.reason,
    obs?.profile ?? null,
    obs?.profile ?? null,
    obs?.profile ?? null,
    obs?.amount ?? null,
    event.posted_at_ms,
    event.posted_at_ms,
    now,
    now,
    device.id,
    device.epoch,
  ).run();
  const stored = await one(env, "SELECT * FROM events WHERE id=?", eventId);
  if (!stored) fail(401, "unknown_relay_device", "Phone has been revoked");
  if (stored.hash !== hash)
    fail(409, "event_conflict", "Event ID reused with different content");
  return {
    event_id: event.event_id,
    relay_event_id: eventId,
    status: stored.status,
    payment_id: stored.payment_id || undefined,
    duplicate: result.meta.changes === 0,
    transitioned: result.meta.changes > 0 && stored.status === "matched",
  };
}

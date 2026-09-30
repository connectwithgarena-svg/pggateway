import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  generateKeyPairSync,
  sign,
  createHash,
  randomUUID,
  createHmac,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
const origin = "https://ffshop-test.pages.dev",
  adminKey = "SYNTHETIC_TEST_ONLY_" + randomUUID();
let mf,
  db,
  worker,
  jobs,
  cookie,
  temp,
  webhookCalls = [],
  webhookStatus = 503;
const hash = (s) => createHash("sha256").update(s).digest("hex");
before(async () => {
  temp = await mkdtemp(join(tmpdir(), "ffshop-cf-test-"));
  await build({
    stdin: {
      contents: `import {maintenance} from './src/jobs'; export default {async fetch(req,env){await maintenance(env);return new Response('done')}}`,
      resolveDir: process.cwd(),
    },
    outfile: join(temp, "jobs.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
  });
  const base = {
    compatibilityDate: "2026-09-29",
    modules: true,
    d1Databases: { DB: "ffshop-test" },
    bindings: { PUBLIC_ORIGIN: origin, ADMIN_KEY_HASH: hash(adminKey) },
  };
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          ...base,
          name: "app",
          script: await readFile("dist/_worker.js", "utf8"),
          outboundService: async () => {
            throw new Error(
              "Unexpected outbound request from application Worker",
            );
          },
        },
        {
          ...base,
          name: "jobs",
          script: await readFile(join(temp, "jobs.mjs"), "utf8"),
          outboundService: async (req) => {
            webhookCalls.push({
              url: req.url,
              headers: Object.fromEntries(req.headers),
              body: await req.text(),
            });
            return new Response("fixture", { status: webhookStatus });
          },
        },
      ],
    }),
  );
  worker = await mf.getWorker("app");
  jobs = await mf.getWorker("jobs");
  db = await mf.getD1Database("DB", "app");
  const schema =
    (await readFile("migrations/0001.sql", "utf8")) +
    "\n" +
    (await readFile("migrations/0002.sql", "utf8")) +
    "\n" +
    (await readFile("migrations/0003.sql", "utf8")) +
    "\n" +
    (await readFile("migrations/0004.sql", "utf8")) +
    "\n" +
    (await readFile("migrations/0005.sql", "utf8"));
  await db.exec(
    schema
      .replace(/CREATE TRIGGER[\s\S]*?END;/g, (m) => m.replace(/\n/g, " "))
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("--"))
      .join("\n"),
  );
});
after(async () => {
  await mf?.dispose();
  if (temp) await rm(temp, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM payment_returns; DELETE FROM bharatpe_snapshots; DELETE FROM bharatpe_rows; DELETE FROM reviews; DELETE FROM deliveries; DELETE FROM events; DELETE FROM slots; DELETE FROM payments; DELETE FROM devices; DELETE FROM pairings; DELETE FROM profiles; DELETE FROM settings; DELETE FROM api_keys; DELETE FROM sessions; DELETE FROM limits; INSERT INTO settings VALUES('schema_version','5');",
  );
  webhookCalls = [];
  webhookStatus = 503;
  cookie = "";
  const r = await call("/admin/session", "POST", { password: adminKey });
  assert.equal(r.status, 200, await r.clone().text());
  cookie = r.headers.get("set-cookie").split(";")[0];
});
async function call(path, method = "GET", body, headers = {}, auth = true) {
  return mf.dispatchFetch(origin + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}
async function data(r) {
  const b = await r.json();
  assert.ok(r.ok, JSON.stringify(b));
  return b;
}
async function profile(provider = "paytm") {
  return data(
    await call("/admin/profiles", "POST", {
      id: provider,
      label: provider,
      upi: provider + "@invalid",
      payee: "SYNTHETIC ONLY",
    }),
  );
}
async function order(amount = 10, key = randomUUID()) {
  return data(
    await call(
      "/admin/payments",
      "POST",
      { name: "Synthetic order", amount },
      { "Idempotency-Key": key },
    ),
  );
}
async function pair() {
  const link = await data(await call("/admin/pair", "POST", {}));
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const body = {
    token: link.pairing_url.split("/").pop(),
    name: "Test phone",
    public_key_pem: keys.publicKey.export({ type: "spki", format: "pem" }),
  };
  const device = await data(
    await call("/api/v4/relay/pair", "POST", body, {}, false),
  );
  return { ...device, ...keys, pairBody: body };
}
function event(p, provider = "paytm", overrides = {}) {
  const packages = {
    paytm: "com.paytm.business",
    phonepe: "com.phonepe.app.business",
    hdfc: "com.hdfc.smarthub",
    bharatpe: "com.bharatpe.app",
    gpay: "com.google.android.apps.nbu.paisa.merchant",
  };
  return {
    schema_version: 1,
    event_id: hash(randomUUID()),
    package_name: packages[provider],
    posted_at_ms: Date.now(),
    title: "Payment received",
    text: "You received INR " + p.payable_amount + " from Test Customer",
    ...overrides,
  };
}
async function signed(d, e, path = "/api/v4/relay/events", opts = {}) {
  const raw = JSON.stringify(e),
    time = String(Date.now()),
    epoch = opts.epoch ?? d.enrolled_at_ms;
  const canonical = `POST\n${path}\n${time}\n${epoch}\n${hash(raw)}`;
  const sig = sign("sha256", Buffer.from(canonical), d.privateKey).toString(
    "base64",
  );
  return call(
    path,
    "POST",
    raw + (opts.tamper ? " " : ""),
    {
      "X-PayGate-Relay-Device": d.device_id,
      "X-PayGate-Relay-Time": time,
      "X-PayGate-Relay-Epoch": String(epoch),
      "X-PayGate-Relay-Signature": sig,
    },
    false,
  );
}
async function status(p) {
  return (await data(await call("/api/checkout/" + p.id))).status;
}
test("admin auth, CSRF and public paid-status bypass rejection", async () => {
  assert.equal(
    (await call("/admin/state", "GET", undefined, {}, false)).status,
    401,
  );
  assert.equal(
    (await call("/admin/pair", "POST", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  await profile();
  const p = await order();
  assert.equal(
    (await call("/api/checkout/" + p.id, "POST", { status: "paid" })).status,
    404,
  );
  assert.equal(await status(p), "pending");
  const pub = await data(await call("/api/checkout/" + p.id));
  assert.equal(pub.external_id, undefined);
  assert.equal(pub.scope, undefined);
  assert.equal(
    (await call("/admin/session", "POST", { password: "wrong" })).status,
    401,
  );
});
test("single-use pairing under concurrency", async () => {
  const link = await data(await call("/admin/pair", "POST", {})),
    keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    body = {
      token: link.pairing_url.split("/").pop(),
      name: "fixture",
      public_key_pem: keys.publicKey.export({ type: "spki", format: "pem" }),
    };
  const result = await Promise.all([
    call("/api/v4/relay/pair", "POST", body),
    call("/api/v4/relay/pair", "POST", body),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM devices").first()).n,
    1,
  );
});
test("pairing response satisfies installed Android contract and enables heartbeat", async () => {
  const d = await pair();
  // Relay.java rejects the response before saving unless these fields are valid.
  assert.match(d.device_id, /^[a-f0-9]{64}$/);
  assert.equal(d.enabled, true);
  assert.ok(Number.isSafeInteger(d.enrolled_at_ms) && d.enrolled_at_ms > 0);
  const other = await pair();
  assert.match(other.device_id, /^[a-f0-9]{64}$/);
  assert.notEqual(other.device_id, d.device_id);
  const response = await signed(
    d,
    {
      schema_version: 1,
      notification_access: true,
      listener_connected: true,
      foreground_running: true,
    },
    "/api/v4/relay/heartbeat",
  );
  assert.equal(response.status, 200);
  const state = await data(await call("/admin/state"));
  const phone = state.devices.find((item) => item.id === d.device_id);
  assert.ok(phone.last_seen >= d.enrolled_at_ms);
  assert.equal(JSON.parse(phone.health).listener_connected, true);
});
test("five merchant routes, wrong-provider isolation and duplicate idempotency", async () => {
  const d = await pair();
  for (const provider of ["paytm", "phonepe", "hdfc", "bharatpe", "gpay"]) {
    await profile(provider);
    const p = await order();
    const wrong = event(p, provider === "paytm" ? "phonepe" : "paytm");
    assert.notEqual((await data(await signed(d, wrong))).status, "matched");
    assert.equal(await status(p), "pending");
    const e = event(p, provider),
      matched = await data(await signed(d, e));
    assert.equal(matched.status, "matched");
    assert.equal(matched.transitioned, true);
    assert.equal(matched.payment_id, p.id);
    assert.equal(await status(p), "paid");
    const duplicate = await data(await signed(d, e));
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.transitioned, false);
  }
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM payments WHERE status='paid'")
        .first()
    ).n,
    5,
  );
});
test("tamper, wrong epoch and revoked phone rejection", async () => {
  await profile();
  const d = await pair(),
    p = await order(),
    e = event(p);
  assert.equal((await signed(d, e, undefined, { tamper: true })).status, 401);
  assert.equal(
    (await signed(d, e, undefined, { epoch: d.enrolled_at_ms + 1 })).status,
    401,
  );
  await call("/admin/devices/" + d.device_id, "DELETE");
  assert.equal((await signed(d, e)).status, 401);
  assert.equal(await status(p), "pending");
});
test("negative, ambiguous, integer, malformed and unknown-app notifications ignored", async () => {
  await profile();
  const d = await pair(),
    p = await order();
  for (const str of [
    `Refund received INR ${p.payable_amount}`,
    `INR ${p.payable_amount} received pending`,
    `Settlement received INR ${p.payable_amount}`,
    `You paid INR ${p.payable_amount}`,
    `Received INR ${p.payable_amount} balance INR 200.20`,
    "You received INR 10.00",
    "You received INR 10.001",
    `INR ${p.payable_amount} not received`,
    `Payment request received INR ${p.payable_amount}`,
    `Cancelled payment INR ${p.payable_amount} received`,
  ])
    assert.equal(
      (await data(await signed(d, event(p, "paytm", { text: str })))).status,
      "ignored",
    );
  assert.equal(
    (
      await data(
        await signed(
          d,
          event(p, "paytm", { package_name: "com.fake.business" }),
        ),
      )
    ).status,
    "ignored",
  );
  assert.equal(await status(p), "pending");
});
test("Paytm Hindi receipt accepts exact amount and rejects negative or ambiguous evidence", async () => {
  await profile();
  const d = await pair(),
    p = await order();
  const receipt = `₹${p.payable_amount} Test Customer से प्राप्त हुआ`;
  for (const text of [
    `${receipt} नहीं`,
    `${receipt}\nरिफंड`,
    `${receipt}\nलंबित`,
    `${receipt}\nवापसी`,
    `${receipt}\n₹2.33`,
    "₹1.00 Test Customer से प्राप्त हुआ",
    `₹${p.payable_amount} का भुगतान अनुरोध प्राप्त हुआ`,
  ]) {
    const result = await data(
      await signed(
        d,
        event(p, "paytm", {
          title: "Payment Received on Paytm for Business",
          text,
        }),
      ),
    );
    assert.equal(result.status, "ignored");
    assert.equal(await status(p), "pending");
  }
  // Verify the Hindi-only wording without relying on an English title.
  const result = await data(
    await signed(
      d,
      event(p, "paytm", {
        title: "Paytm for Business",
        text: "",
        big_text: receipt + "\n30 Sep 2026 09:17 AM को प्राप्त हुआ",
      }),
    ),
  );
  assert.equal(result.status, "matched");
  assert.equal(await status(p), "paid");
});
test("concurrent evidence transitions once and creates durable outbox once", async () => {
  await profile();
  await call("/admin/webhook", "POST", {
    endpoint: "https://shop.example/hook",
  });
  const d = await pair(),
    p = await order(),
    e = event(p);
  const bodies = await Promise.all(
    (await Promise.all([signed(d, e), signed(d, e)])).map(data),
  );
  assert.equal(bodies.filter((r) => r.transitioned).length, 1);
  assert.equal(
    (await signed(d, { ...e, text: "You received INR 999.99" })).status,
    409,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
});
test("concurrent order idempotency, unique amounts and paid-amount quarantine", async () => {
  await profile();
  const key = randomUUID();
  const result = await Promise.all(
    Array.from({ length: 6 }, () => order(10, key)),
  );
  assert.equal(new Set(result.map((p) => p.id)).size, 1);
  assert.equal(
    (
      await call(
        "/admin/payments",
        "POST",
        { name: "Changed", amount: 10 },
        { "Idempotency-Key": key },
      )
    ).status,
    409,
  );
  const many = await Promise.all(Array.from({ length: 15 }, () => order()));
  assert.equal(new Set(many.map((p) => p.payable_amount)).size, 15);
  const d = await pair(),
    p = many[0];
  await signed(d, event(p));
  assert.notEqual((await order()).payable_amount, p.payable_amount);
});
test("pre-order, late and cancelled events cannot change payment state", async () => {
  await profile();
  const d = await pair(),
    p = await order();
  await db
    .prepare(
      "UPDATE payments SET created=created+5000,expires=expires+5000,grace=grace+5000,reuse=reuse+5000 WHERE id=?",
    )
    .bind(p.id)
    .run();
  assert.equal((await data(await signed(d, event(p)))).status, "unmatched");
  assert.equal(await status(p), "pending");
  await call("/admin/cancel/" + p.id, "POST");
  assert.equal((await data(await signed(d, event(p)))).status, "unmatched");
  assert.equal(await status(p), "cancelled");
  const expired = await order();
  await db
    .prepare(
      "UPDATE payments SET created=created-1000000,expires=expires-1000000,grace=grace-1000000 WHERE id=?",
    )
    .bind(expired.id)
    .run();
  assert.equal(
    (await data(await signed(d, event(expired)))).status,
    "unmatched",
  );
  assert.equal(await status(expired), "expired");
});
test("profile switch preserves destination; pending account edits blocked", async () => {
  await profile();
  const p = await order();
  await profile("phonepe");
  const next = await order();
  assert.equal(p.profile, "paytm");
  assert.equal(next.profile, "phonepe");
  assert.equal(
    (
      await call("/admin/profiles", "POST", {
        id: "paytm",
        label: "Paytm",
        upi: "changed@invalid",
        payee: "TEST",
      })
    ).status,
    409,
  );
  const d = await pair();
  assert.equal((await data(await signed(d, event(p)))).status, "matched");
});
test("API scope and revocation; signed webhook persists failed attempts and retry lease", async () => {
  await profile();
  const key = await data(await call("/admin/keys", "POST", { label: "shop" })),
    other = await data(await call("/admin/keys", "POST", { label: "other" })),
    hook = await data(
      await call("/admin/webhook", "POST", {
        endpoint: "https://shop.example/hook",
      }),
    );
  const p = await data(
    await call(
      "/api/v1/payments",
      "POST",
      { name: "Shop order", external_id: "SHOP-1", amount: 10 },
      {
        Authorization: "Bearer " + key.secret,
        "Idempotency-Key": randomUUID(),
      },
      false,
    ),
  );
  assert.equal(
    (
      await call(
        "/api/v1/payments/" + p.id,
        "GET",
        undefined,
        { Authorization: "Bearer " + other.secret },
        false,
      )
    ).status,
    404,
  );
  const d = await pair();
  await signed(d, event(p));
  await jobs.fetch("https://jobs.test/");
  assert.equal(webhookCalls.length, 1);
  assert.equal(
    (await db.prepare("SELECT * FROM deliveries").first()).status,
    "retry",
  );
  const sent = webhookCalls[0];
  assert.equal(
    sent.headers["x-ffshop-signature"],
    createHmac("sha256", hook.secret)
      .update(sent.headers["x-ffshop-timestamp"] + "." + sent.body)
      .digest("hex"),
  );
  assert.equal(JSON.parse(sent.body).payment.external_id, "SHOP-1");
  webhookStatus = 200;
  await db.prepare("UPDATE deliveries SET next_at=0").run();
  await Promise.all([
    jobs.fetch("https://jobs.test/"),
    jobs.fetch("https://jobs.test/"),
  ]);
  assert.equal(webhookCalls.length, 2);
  assert.equal(
    (await db.prepare("SELECT * FROM deliveries").first()).status,
    "delivered",
  );
  await call("/admin/keys/" + key.id, "DELETE");
  assert.equal(
    (
      await call(
        "/api/v1/payments/" + p.id,
        "GET",
        undefined,
        { Authorization: "Bearer " + key.secret },
        false,
      )
    ).status,
    401,
  );
});
test("webhook URL rejection and scheduled expiry retains amount reservation", async () => {
  for (const endpoint of [
    "http://shop.example",
    "https://127.0.0.1",
    "https://localhost",
    "https://[::1]",
    "https://a:b@shop.example",
    "https://host.internal",
  ])
    assert.equal(
      (await call("/admin/webhook", "POST", { endpoint })).status,
      400,
    );
  await profile();
  const p = await order();
  await db
    .prepare("UPDATE payments SET created=0,expires=1,grace=2 WHERE id=?")
    .bind(p.id)
    .run();
  await jobs.fetch("https://jobs.test/");
  assert.equal(await status(p), "expired");
  assert.equal((await db.prepare("SELECT count(*) n FROM slots").first()).n, 1);
});
test("existing Android Java Protocol signs evidence accepted by workerd", async () => {
  const java = `import java.nio.file.*; import java.security.*; import java.security.spec.*; import java.util.Base64; import in.ffshop.relay.Protocol; public class Probe {public static void main(String[] a) throws Exception {if(a[0].equals("key")){KeyPairGenerator g=KeyPairGenerator.getInstance("EC");g.initialize(new ECGenParameterSpec("secp256r1"));KeyPair k=g.generateKeyPair();Files.write(Path.of(a[1],"key.der"),k.getPrivate().getEncoded());System.out.print("-----BEGIN PUBLIC KEY-----\\n"+Base64.getEncoder().encodeToString(k.getPublic().getEncoded())+"\\n-----END PUBLIC KEY-----");}else{PrivateKey k=KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(a[1],"key.der"))));System.out.print(Protocol.sign(k,a[2],a[3],Long.parseLong(a[4]),Files.readAllBytes(Path.of(a[1],"body.json"))));}}}`;
  await writeFile(join(temp, "Probe.java"), java);
  execFileSync("javac", [
    "-d",
    temp,
    resolve("../android/app/src/main/java/in/ffshop/relay/Protocol.java"),
    join(temp, "Probe.java"),
  ]);
  const pem = execFileSync("java", ["-cp", temp, "Probe", "key", temp], {
    encoding: "utf8",
  });
  const link = await data(await call("/admin/pair", "POST", {})),
    d = await data(
      await call("/api/v4/relay/pair", "POST", {
        token: link.pairing_url.split("/").pop(),
        name: "Java fixture",
        public_key_pem: pem,
      }),
    );
  await profile();
  const p = await order(),
    raw = JSON.stringify(event(p)),
    timestamp = String(Date.now()),
    path = "/api/v4/relay/events";
  await writeFile(join(temp, "body.json"), raw);
  const signature = execFileSync(
    "java",
    [
      "-cp",
      temp,
      "Probe",
      "sign",
      temp,
      path,
      timestamp,
      String(d.enrolled_at_ms),
    ],
    { encoding: "utf8" },
  );
  const response = await data(
    await call(
      path,
      "POST",
      raw,
      {
        "X-PayGate-Relay-Device": d.device_id,
        "X-PayGate-Relay-Time": timestamp,
        "X-PayGate-Relay-Epoch": String(d.enrolled_at_ms),
        "X-PayGate-Relay-Signature": signature,
      },
      false,
    ),
  );
  assert.equal(response.status, "matched");
  assert.equal(await status(p), "paid");
});
test("SQL destination guard closes profile-update versus order-creation race", async () => {
  await profile();
  await order();
  await assert.rejects(
    () =>
      db
        .prepare("UPDATE profiles SET upi='different@invalid' WHERE id='paytm'")
        .run(),
    /pending_destination_change/,
  );
  assert.equal(
    (await db.prepare("SELECT upi FROM profiles WHERE id='paytm'").first()).upi,
    "paytm@invalid",
  );
});
test("event posted within pay window is accepted during delivery grace only", async () => {
  await profile();
  const d = await pair(),
    p = await order();
  const e = event(p);
  await db
    .prepare("UPDATE payments SET expires=?,grace=? WHERE id=?")
    .bind(e.posted_at_ms + 1, e.posted_at_ms + 300000, p.id)
    .run();
  assert.equal((await data(await signed(d, e))).status, "matched");
  const p2 = await order();
  const e2 = event(p2);
  await db
    .prepare("UPDATE payments SET expires=?,grace=? WHERE id=?")
    .bind(
      Date.parse(p2.created_at) + 1,
      Date.parse(p2.created_at) + 300000,
      p2.id,
    )
    .run();
  e2.posted_at_ms = Date.parse(p2.created_at) + 2;
  assert.equal((await data(await signed(d, e2))).status, "unmatched");
});
test("body bounds, invalid input and stale pairing cannot produce an order", async () => {
  await profile();
  assert.equal(
    (
      await call(
        "/admin/payments",
        "POST",
        { name: "Bad", amount: 1.01 },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    400,
  );
  assert.equal(
    (await call("/admin/payments", "POST", { name: "Bad", amount: 10 })).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/admin/payments",
        "POST",
        { name: "x".repeat(70000), amount: 10 },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    413,
  );
  const d = await pair();
  assert.equal(
    (await call("/api/v4/relay/pair", "POST", d.pairBody)).status,
    401,
  );
});

test("business account lifecycle preserves history and disabled existing orders can settle", async () => {
  await profile("paytm");
  await data(
    await call("/admin/profiles", "POST", {
      id: "bharatpe",
      label: "Counter B",
      upi: "bharat@invalid",
      payee: "Fixture Merchant",
      active: false,
    }),
  );
  let state = await data(await call("/admin/state"));
  assert.equal(state.profiles.find((p) => p.id === "paytm").active, 1);
  assert.equal(state.profiles.find((p) => p.id === "bharatpe").active, 0);
  const p = await data(
    await call(
      "/admin/payments",
      "POST",
      { name: "Account order", amount: 10, profile: "bharatpe" },
      { "Idempotency-Key": randomUUID() },
    ),
  );
  assert.equal(p.profile, "bharatpe");
  assert.equal((await call("/admin/profiles/bharatpe", "DELETE")).status, 409);
  assert.equal(
    (
      await call("/admin/profiles", "POST", {
        id: "bharatpe",
        label: "Counter B",
        upi: "new@invalid",
        payee: "Fixture Merchant",
        active: false,
      })
    ).status,
    409,
  );
  await data(
    await call("/admin/profiles/bharatpe/enabled", "POST", { enabled: false }),
  );
  assert.equal(
    (
      await call(
        "/admin/payments",
        "POST",
        { name: "Disabled", amount: 10, profile: "bharatpe" },
        { "Idempotency-Key": randomUUID() },
      )
    ).status,
    409,
  );
  assert.equal(
    (await call("/admin/profiles/bharatpe/default", "POST", {})).status,
    409,
  );
  const d = await pair();
  assert.equal(
    (await data(await signed(d, event(p, "bharatpe")))).status,
    "matched",
  );
  await data(await call("/admin/profiles/bharatpe", "DELETE"));
  state = await data(await call("/admin/state"));
  assert.equal(
    state.profiles.some((p) => p.id === "bharatpe"),
    false,
  );
  assert.equal(
    (await data(await call("/admin/payments/" + p.id))).upi,
    "bharat@invalid",
  );
  await data(
    await call("/admin/profiles", "POST", {
      id: "bharatpe",
      label: "Restored",
      upi: "restored@invalid",
      payee: "Fixture Merchant",
      active: false,
    }),
  );
  await data(await call("/admin/profiles/bharatpe/default", "POST", {}));
  assert.equal((await order()).profile, "bharatpe");
});

test("account selection participates in idempotency and default account races roll back", async () => {
  await profile("paytm");
  await data(
    await call("/admin/profiles", "POST", {
      id: "phonepe",
      label: "PhonePe",
      upi: "phone@invalid",
      payee: "Test",
      active: false,
    }),
  );
  const key = randomUUID();
  const p = await data(
    await call(
      "/admin/payments",
      "POST",
      { name: "Choice", amount: 10, profile: "paytm" },
      { "Idempotency-Key": key },
    ),
  );
  assert.equal(
    (
      await data(
        await call(
          "/admin/payments",
          "POST",
          { name: "Choice", amount: 10, profile: "paytm" },
          { "Idempotency-Key": key },
        ),
      )
    ).id,
    p.id,
  );
  assert.equal(
    (
      await call(
        "/admin/payments",
        "POST",
        { name: "Choice", amount: 10, profile: "phonepe" },
        { "Idempotency-Key": key },
      )
    ).status,
    409,
  );
  assert.equal(
    (await call("/admin/profiles/paytm/enabled", "POST", { enabled: "false" }))
      .status,
    400,
  );
  assert.equal(
    (await call("/admin/profiles/paytm", "DELETE", undefined, {}, false))
      .status,
    401,
  );
  assert.equal(
    (
      await call(
        "/admin/profiles/paytm/enabled",
        "POST",
        { enabled: false },
        { Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
});

test("manual review validates exact credit, reference reuse, scope and webhook atomicity", async () => {
  await profile("paytm");
  await data(
    await call("/admin/webhook", "POST", {
      endpoint: "https://shop.example/hook",
    }),
  );
  const p = await order();
  const body = {
    checked: true,
    reference: "123456789012",
    amount_paise: Math.round(Number(p.payable_amount) * 100),
  };
  const path = "/admin/payments/" + p.id + "/confirm";
  assert.equal((await call(path, "POST", body, {}, false)).status, 401);
  assert.equal(
    (await call(path, "POST", { ...body, checked: false })).status,
    400,
  );
  assert.equal(
    (await call(path, "POST", { ...body, amount_paise: body.amount_paise + 1 }))
      .status,
    400,
  );
  assert.equal(await status(p), "pending");
  const result = await data(await call(path, "POST", body));
  assert.equal(result.status, "paid");
  assert.equal(result.confirmation_source, "manual");
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM reviews").first()).n,
    1,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
  assert.equal((await call(path, "POST", body)).status, 409);
  const next = await order();
  assert.equal(
    (
      await call("/admin/payments/" + next.id + "/confirm", "POST", {
        ...body,
        amount_paise: Math.round(Number(next.payable_amount) * 100),
      })
    ).status,
    409,
  );
  const d = await pair();
  await signed(d, event(p));
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
});

test("competing admin reviews and signed receipt only confirm and enqueue once", async () => {
  await profile();
  await data(
    await call("/admin/webhook", "POST", {
      endpoint: "https://shop.example/hook",
    }),
  );
  const p = await order(),
    d = await pair();
  const path = "/admin/payments/" + p.id + "/confirm";
  const body = {
    checked: true,
    reference: "RACE123456",
    amount_paise: Math.round(Number(p.payable_amount) * 100),
  };
  const results = await Promise.all([
    call(path, "POST", body),
    call(path, "POST", { ...body, reference: "RACE654321" }),
    signed(d, event(p)),
  ]);
  assert.ok(results.every((r) => [200, 409].includes(r.status)));
  assert.equal(await status(p), "paid");
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
  assert.ok(
    (await db.prepare("SELECT count(*) n FROM reviews").first()).n <= 1,
  );
});

test("paginated history, computed expiration, literal search and global summary", async () => {
  await profile();
  for (let i = 0; i < 27; i++)
    await data(
      await call(
        "/admin/payments",
        "POST",
        { name: i === 0 ? "Literal %_ order" : "History " + i, amount: 10 },
        { "Idempotency-Key": randomUUID() },
      ),
    );
  const first = await data(await call("/admin/payments"));
  assert.equal(first.total, 27);
  assert.equal(first.payments.length, 25);
  assert.equal(first.pages, 2);
  const second = await data(await call("/admin/payments?page=2"));
  assert.equal(second.payments.length, 2);
  assert.equal(
    (
      await data(
        await call("/admin/payments?search=" + encodeURIComponent("%_")),
      )
    ).total,
    1,
  );
  await db
    .prepare(
      "UPDATE payments SET created=created-700000,expires=expires-700000,grace=grace-700000 WHERE id=?",
    )
    .bind(first.payments[0].id)
    .run();
  assert.equal(
    (await data(await call("/admin/payments?status=expired"))).total,
    1,
  );
  assert.equal(
    (await data(await call("/admin/payments?status=pending"))).total,
    26,
  );
  assert.equal((await data(await call("/admin/state"))).summary.orders, 27);
  assert.equal((await call("/admin/payments?status=anything")).status, 400);
});

test("all providers accept strict positive Hindi and expanded receipts but reject amount-only lists", async () => {
  const d = await pair();
  for (const provider of ["paytm", "phonepe", "bharatpe", "hdfc", "gpay"]) {
    await profile(provider);
    const p = await order();
    let result = await data(
      await signed(
        d,
        event(p, provider, {
          title: "",
          text: "",
          big_text: `10:10 AM\nTest Customer\n₹${p.payable_amount}\nClose\nRefresh`,
        }),
      ),
    );
    assert.equal(
      result.status,
      provider === "bharatpe" ? "processed" : "ignored",
    );
    assert.equal(await status(p), "pending");
    let state = await data(await call("/admin/state"));
    assert.equal(
      state.events.find((e) => e.id === result.relay_event_id).reason,
      provider === "bharatpe" ? "bharatpe_baseline" : "no_credit_wording",
    );
    result = await data(
      await signed(
        d,
        event(p, provider, {
          title: "Business receipt",
          text: `You received INR ${p.payable_amount} from Test Customer`,
          big_text: `You received INR ${p.payable_amount} from Test Customer\nTransaction ID 123456789012`,
        }),
      ),
    );
    assert.equal(result.status, "matched");
    const hindi = await order();
    result = await data(
      await signed(
        d,
        event(hindi, provider, {
          title: "Business receipt",
          text: `₹${hindi.payable_amount} Test Customer से प्राप्त हुआ`,
        }),
      ),
    );
    assert.equal(result.status, "matched");
    const negative = await order();
    result = await data(
      await signed(
        d,
        event(negative, provider, {
          title: "Payment failed",
          text: `₹${negative.payable_amount} Test Customer से प्राप्त हुआ`,
        }),
      ),
    );
    assert.equal(result.status, "ignored");
  }
});

test("turning off or replacing callbacks stops queued delivery and clears its data", async () => {
  await profile();
  const device = await pair();
  for (const replacement of ["", "https://new-shop.example/callback"]) {
    await data(
      await call("/admin/webhook", "POST", {
        endpoint: "https://old-shop.example/callback",
      }),
    );
    const p = await order();
    await data(await signed(device, event(p)));
    await jobs.fetch("https://jobs/");
    const sent = webhookCalls.length;
    await data(await call("/admin/webhook", "POST", { endpoint: replacement }));
    const d = await db
      .prepare("SELECT * FROM deliveries WHERE payment_id=?")
      .bind(p.id)
      .first();
    assert.equal(d.status, "cancelled");
    assert.equal(d.secret, "");
    assert.equal(d.payload, "");
    assert.equal(d.endpoint, "");
    await call("/admin/deliveries/" + d.id, "POST", {});
    await jobs.fetch("https://jobs/");
    assert.equal(webhookCalls.length, sent);
  }
});

test("public readiness reveals only setup flags; source stays self-hosted", async () => {
  const ready = await data(
    await call("/api/readiness", "GET", undefined, {}, false),
  );
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.checks, {
    origin: true,
    admin_key: true,
    database: true,
    schema: true,
  });
  assert.equal(
    (await data(await call("/api/config", "GET", undefined, {}, false)))
      .source_url,
    "/source.zip",
  );
  await db.prepare("DELETE FROM settings WHERE key='schema_version'").run();
  const unavailable = await call("/api/readiness", "GET", undefined, {}, false);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).checks.schema, false);
});

const minuteNow = () => Math.floor(Date.now() / 60000) * 60000;
function bharatTime(time) {
  const d = new Date(time + 19800000);
  return `${d.getUTCHours() % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${d.getUTCHours() >= 12 ? "PM" : "AM"}`;
}
function bharatEvent(entries, overrides = {}) {
  return event({ payable_amount: "1.01" }, "bharatpe", {
    title: "",
    text: "",
    big_text:
      entries
        .map(
          ([time, amount, name = "Test Customer"]) =>
            `${bharatTime(time)}\n${name}\n₹${amount}`,
        )
        .join("\n") + "\nClose\nRefresh",
    ...overrides,
  });
}
async function bharatFixture() {
  await profile("bharatpe");
  const d = await pair();
  d.enrolled_at_ms -= 3600000;
  await db
    .prepare("UPDATE devices SET epoch=? WHERE id=?")
    .bind(d.enrolled_at_ms, d.device_id)
    .run();
  const base = minuteNow();
  const old = [
    [base - 180000, "4.61"],
    [base - 300000, "4.61"],
  ];
  const baseline = await data(
    await signed(d, bharatEvent(old, { posted_at_ms: base - 120000 })),
  );
  assert.equal(baseline.status, "processed");
  await db
    .prepare("UPDATE bharatpe_snapshots SET received=? WHERE device_id=?")
    .bind(base - 120000, d.device_id)
    .run();
  const p = await order(6);
  await db
    .prepare(
      "UPDATE payments SET created=?,expires=?,grace=?,reuse=? WHERE id=?",
    )
    .bind(base - 30000, base + 270000, base + 570000, base + 86400000, p.id)
    .run();
  return { d, p, base, old };
}

test("all 99 paise slots exhaust safely and cancelled/paid amounts stay reserved", async () => {
  await profile();
  const entries = [];
  for (let i = 0; i < 99; i++) entries.push(await order(20));
  const totals = entries.map((p) => Math.round(Number(p.payable_amount) * 100));
  assert.equal(new Set(totals).size, 99);
  assert.equal(Math.min(...totals), 2001);
  assert.equal(Math.max(...totals), 2099);
  await data(await call("/admin/cancel/" + entries[0].id, "POST"));
  const d = await pair();
  await signed(d, event(entries[1]));
  const full = await call(
    "/admin/payments",
    "POST",
    { name: "Full", amount: 20 },
    { "Idempotency-Key": randomUUID() },
  );
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error.code, "amount_capacity");
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM payments").first()).n,
    99,
  );
  const next = await order(21);
  assert(Number(next.payable_amount) > 21 && Number(next.payable_amount) < 22);
  const row = await db.prepare("SELECT * FROM payments LIMIT 1").first();
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        randomUUID(),
        "fixture",
        randomUUID(),
        "h",
        2000,
        2151,
        "paytm",
        "test@invalid",
        "Test",
        "Test",
        row.created,
        row.expires,
        row.grace,
        row.reuse,
      )
      .run(),
    /invalid_payment_adjustment/,
  );
});

test("BharatPe new row matches once; refresh/replay/new event IDs do not duplicate callbacks", async () => {
  const { d, p, base, old } = await bharatFixture();
  await data(
    await call("/admin/webhook", "POST", {
      endpoint: "https://shop.example/callback",
    }),
  );
  const e = bharatEvent([[base, p.payable_amount], ...old]);
  const r = await data(await signed(d, e));
  assert.equal(r.transitioned, true);
  assert.equal(await status(p), "paid");
  const replay = await data(await signed(d, e));
  assert.equal(replay.duplicate, true);
  assert.equal(replay.transitioned, false);
  const refresh = await data(
    await signed(d, {
      ...e,
      event_id: hash(randomUUID()),
      posted_at_ms: Date.now(),
    }),
  );
  assert.equal(refresh.transitioned, false);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM events WHERE status='matched'")
        .first()
    ).n,
    1,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM bharatpe_rows").first()).n,
    3,
  );
  const conflict = await signed(d, {
    ...e,
    big_text: e.big_text.replace("Test Customer", "Different Customer"),
  });
  assert.equal(conflict.status, 409);
});

test("BharatPe multiple new rows settle separate exact orders", async () => {
  const { d, p, base, old } = await bharatFixture();
  const second = await order(8);
  await db
    .prepare("UPDATE payments SET created=? WHERE id=?")
    .bind(base - 30000, second.id)
    .run();
  await data(
    await signed(
      d,
      bharatEvent([
        [base, p.payable_amount],
        [base, second.payable_amount, "Another Customer"],
        ...old,
      ]),
    ),
  );
  assert.equal(await status(p), "paid");
  assert.equal(await status(second), "paid");
});

test("BharatPe same-minute orders and first snapshots stay pending", async () => {
  const { d, p, base, old } = await bharatFixture();
  await db
    .prepare("UPDATE payments SET created=? WHERE id=?")
    .bind(base + 1, p.id)
    .run();
  await signed(d, bharatEvent([[base, p.payable_amount], ...old]));
  assert.equal(await status(p), "pending");
  await db.prepare("DELETE FROM bharatpe_snapshots").run();
  const first = await data(
    await signed(d, bharatEvent([[base, p.payable_amount], ...old])),
  );
  assert.equal(first.transitioned, false);
  assert.equal(await status(p), "pending");
});

test("BharatPe a seen row never settles a later order after reservation reuse", async () => {
  const { d, p, base, old } = await bharatFixture();
  const saved = await db.prepare("SELECT * FROM bharatpe_snapshots").first();
  const entries = [[base, p.payable_amount], ...old];
  await signed(d, bharatEvent(entries));
  assert.equal(await status(p), "paid");
  await db.prepare("DELETE FROM slots WHERE payment_id=?").bind(p.id).run();
  const later = await order(6);
  await db
    .prepare("UPDATE payments SET payable=?,created=? WHERE id=?")
    .bind(Math.round(Number(p.payable_amount) * 100), base - 10000, later.id)
    .run();
  await db
    .prepare("UPDATE slots SET amount=? WHERE payment_id=?")
    .bind(Math.round(Number(p.payable_amount) * 100), later.id)
    .run();
  await db
    .prepare(
      "UPDATE bharatpe_snapshots SET rows=?,posted=?,received=? WHERE device_id=?",
    )
    .bind(saved.rows, saved.posted, saved.received, d.device_id)
    .run();
  const repeated = await data(await signed(d, bharatEvent(entries)));
  assert.equal(repeated.transitioned, false);
  assert.equal(await status(later), "pending");
});

test("BharatPe concurrent copies and second phones cannot double settle", async () => {
  const { d, p, base, old } = await bharatFixture();
  await data(
    await call("/admin/webhook", "POST", {
      endpoint: "https://shop.example/callback",
    }),
  );
  const entries = [[base, p.payable_amount], ...old];
  const results = await Promise.all(
    Array.from({ length: 6 }, async () =>
      data(await signed(d, bharatEvent(entries))),
    ),
  );
  assert.equal(await status(p), "paid");
  assert.equal(results.filter((r) => r.transitioned).length, 1);
  assert.equal(
    (await db.prepare("SELECT count(*) n FROM deliveries").first()).n,
    1,
  );
  const second = await pair();
  await signed(second, bharatEvent(entries));
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) n FROM events WHERE status='matched'")
        .first()
    ).n,
    1,
  );
});

test("BharatPe malformed/negative lists, capture gaps and cancelled orders stay unconfirmed", async () => {
  const { d, p, base, old } = await bharatFixture();
  const good = bharatEvent([[base, p.payable_amount], ...old]);
  for (const bad of [
    { ...good, title: "Payment failed" },
    { ...bharatEvent([[base, p.payable_amount]]), title: "Payment received" },
    { ...good, big_text: good.big_text + "\nRefund received" },
    { ...good, big_text: good.big_text.replace("Test Customer", "Refund") },
    { ...good, big_text: good.big_text.replace("Close\nRefresh", "") },
    { ...good, big_text: good.big_text.replace("₹", "-₹") },
    bharatEvent([...old, [base, p.payable_amount]]),
  ]) {
    await signed(d, { ...bad, event_id: hash(randomUUID()) });
    assert.equal(await status(p), "pending");
  }
  await db
    .prepare("UPDATE bharatpe_snapshots SET received=?")
    .bind(base - 900000)
    .run();
  await signed(d, good);
  assert.equal(await status(p), "pending");
  await data(await call("/admin/cancel/" + p.id, "POST"));
  await signed(d, { ...good, event_id: hash(randomUUID()) });
  assert.equal(await status(p), "cancelled");
});

test("one-to-99 paise range applies to every provider and API account selection", async () => {
  const key = await data(
    await call("/admin/keys", "POST", { label: "Website" }),
  );
  for (const provider of ["paytm", "phonepe", "bharatpe", "hdfc", "gpay"]) {
    await profile(provider);
    const p = await data(
      await call(
        "/api/v1/payments",
        "POST",
        { name: "All providers", amount: 12, profile: provider },
        {
          Authorization: "Bearer " + key.secret,
          "Idempotency-Key": randomUUID(),
        },
        false,
      ),
    );
    assert.equal(p.profile, provider);
    const paise = Math.round(Number(p.payable_amount) * 100) - 1200;
    assert(paise >= 1 && paise <= 99);
  }
});

test("website redirect is configured by admin, same-origin allowlisted and exposed only after payment", async () => {
  await profile();
  const key = await data(
    await call("/admin/keys", "POST", { label: "Website" }),
  );
  const auth = {
    Authorization: "Bearer " + key.secret,
    "Idempotency-Key": randomUUID(),
  };
  const body = {
    name: "Shop order",
    amount: 10,
    external_id: "SHOP-17",
    return_url:
      "https://shop.example/payment/return?order=SHOP-17&ffshop_payment_id=wrong",
  };
  assert.equal(
    (await call("/api/v1/payments", "POST", body, auth, false)).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/admin/website",
        "POST",
        { origin: "https://shop.example" },
        {},
        false,
      )
    ).status,
    401,
  );
  for (const origin of [
    "https://shop.example/path",
    "https://shop.example?x=1",
    "javascript:alert(1)",
    "http://shop.example",
    "https://user:pass@shop.example",
    "https://shop.example/#return",
    "https://127.0.0.1",
    "https://ffshop-test.pages.dev",
  ])
    assert.equal(
      (await call("/admin/website", "POST", { origin })).status,
      400,
    );
  await data(
    await call("/admin/website", "POST", { origin: "https://shop.example" }),
  );
  const p = await data(
    await call("/api/v1/payments", "POST", body, auth, false),
  );
  assert.equal(
    (await data(await call("/api/checkout/" + p.id))).return_url,
    undefined,
  );
  const replay = await data(
    await call("/api/v1/payments", "POST", body, auth, false),
  );
  assert.equal(replay.id, p.id);
  assert.equal(
    (
      await call(
        "/api/v1/payments",
        "POST",
        { ...body, return_url: "https://shop.example/other" },
        auth,
        false,
      )
    ).status,
    409,
  );
  for (const return_url of [
    "https://evil.example/return",
    "https://shop.example.evil.example/return",
    "https://shop.example@evil.example/return",
    "http://shop.example/return",
    "//shop.example/return",
    "javascript:alert(1)",
    "https://shop.example:444/return",
    "https://shop.example/return#fragment",
  ])
    assert.equal(
      (
        await call(
          "/api/v1/payments",
          "POST",
          { ...body, return_url },
          { ...auth, "Idempotency-Key": randomUUID() },
          false,
        )
      ).status,
      400,
    );
  const d = await pair();
  await data(await signed(d, event(p)));
  const paid = await data(await call("/api/checkout/" + p.id));
  const destination = new URL(paid.return_url);
  assert.equal(destination.origin, "https://shop.example");
  assert.equal(destination.pathname, "/payment/return");
  assert.equal(destination.searchParams.get("order"), "SHOP-17");
  assert.equal(destination.searchParams.get("ffshop_payment_id"), p.id);
  const injected = await data(
    await call("/api/checkout/" + p.id + "?return_url=https://evil.example"),
  );
  assert.equal(injected.return_url, paid.return_url);
  const other = await data(
    await call("/admin/keys", "POST", { label: "Other shop" }),
  );
  assert.equal(
    (
      await call(
        "/api/v1/payments/" + p.id,
        "GET",
        undefined,
        { Authorization: "Bearer " + other.secret },
        false,
      )
    ).status,
    404,
  );
  await data(await call("/admin/website", "POST", { origin: "" }));
  assert.equal(
    (await data(await call("/api/checkout/" + p.id))).return_url,
    undefined,
  );
  assert.equal(await status(p), "paid");
});

test("cancelled/expired website orders never redirect and concurrent creation stores one return mapping", async () => {
  await profile();
  await data(
    await call("/admin/website", "POST", { origin: "https://shop.example" }),
  );
  const key = await data(
    await call("/admin/keys", "POST", { label: "Website" }),
  );
  const body = {
    name: "Atomic return",
    amount: 10,
    return_url: "https://shop.example/return",
  };
  const auth = {
    Authorization: "Bearer " + key.secret,
    "Idempotency-Key": randomUUID(),
  };
  const many = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("/api/v1/payments", "POST", body, auth, false).then(data),
    ),
  );
  assert.equal(new Set(many.map((p) => p.id)).size, 1);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM payment_returns").first()).n,
    1,
  );
  await call("/admin/cancel/" + many[0].id, "POST");
  assert.equal(
    (await data(await call("/api/checkout/" + many[0].id))).return_url,
    undefined,
  );
  const p = await data(
    await call(
      "/api/v1/payments",
      "POST",
      body,
      { ...auth, "Idempotency-Key": randomUUID() },
      false,
    ),
  );
  await db
    .prepare("UPDATE payments SET status='expired' WHERE id=?")
    .bind(p.id)
    .run();
  assert.equal(
    (await data(await call("/api/checkout/" + p.id))).return_url,
    undefined,
  );
});

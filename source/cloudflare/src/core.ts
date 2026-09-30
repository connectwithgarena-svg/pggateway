export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ADMIN_KEY_HASH: string;
  PUBLIC_ORIGIN: string;
  SOURCE_URL?: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
export const enc = new TextEncoder();
export const hex = (a: ArrayBuffer) =>
  Array.from(new Uint8Array(a), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
export const sha = async (s: string | ArrayBuffer) =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof s === "string" ? enc.encode(s) : s,
    ),
  );
export const token = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
export const id = () => crypto.randomUUID();
export function equal(a: string, b: string) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
export function text(v: unknown, max = 120) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, "invalid_input", "Missing or invalid text");
  return v.trim();
}
export const sql = (env: Env, q: string, ...args: any[]) =>
  env.DB.prepare(q).bind(...args);
export const one = async <T = any>(env: Env, q: string, ...args: any[]) =>
  sql(env, q, ...args).first<T>();
export async function rows(env: Env, q: string, ...args: any[]) {
  return (await sql(env, q, ...args).all()).results;
}
export function json(
  body: any,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export async function readJSON(req: Request) {
  if (
    !req.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "content_type", "Use application/json");
  const reader = req.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        fail(413, "too_large", "Request too large");
      }
      parts.push(value);
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(400, "invalid_json", "Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "invalid_json", "Expected an object");
  return { raw, value };
}
export async function limit(
  env: Env,
  key: string,
  max: number,
  windowMs: number,
) {
  const now = Date.now();
  const row = await one(
    env,
    `INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`,
    key,
    now + windowMs,
    now,
    now,
  );
  if (row.count > max)
    fail(429, "rate_limited", "Too many attempts. Try again later.");
}
export const providers: Record<string, string> = {
  "com.paytm.business": "paytm",
  "com.phonepe.app.business": "phonepe",
  "com.hdfc.smarthub": "hdfc",
  "com.bharatpe.app": "bharatpe",
  "com.google.android.apps.nbu.paisa.merchant": "gpay",
};
export function analyzeNotification(e: any): {
  observation: { profile: string; amount: number } | null;
  reason: string;
} {
  const reject = (reason: string) => ({ observation: null, reason });
  const profile = providers[e.package_name];
  if (!profile) return reject("unsupported_app");
  const body = [
    ...new Set(
      [e.title, e.text, e.big_text]
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim()),
    ),
  ].join(" ");
  if (
    /\b(reversal|reversed|refund(?:ed)?|cashback|reward|interest|salary|chargeback|settlement|settled|loan|emi|bill|due|reminder|debited|sent|you\s+paid|paid\s+(to|for)|withdrawn|purchase|spent|transferred\s+to|failed|failure|declined|decline|unsuccessful|rejected|pending|processing|cancelled|canceled|request(?:ed)?|not\s+(?:yet\s+)?(?:received|credited|paid))\b/i.test(
      body,
    )
  )
    return reject("negative_status");
  // Negative Hindi wording must also override an English receipt title.
  if (
    /(नहीं|नही|असफल|विफल|लंबित|लम्बित|रद्द|वापस|वापसी|रिफंड|कैशबैक|अनुरोध|भेजा|भेजे|कटौती|निपटान)/u.test(
      body,
    )
  )
    return reject("negative_status");
  const money =
    /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?=$|[^0-9A-Za-z.]|\.(?:\s|$))/gi;
  // Expanded text often repeats the entire collapsed text. Keep all fields for
  // negative-status checks, but count a contained field only in its larger form.
  const fields = [
    ...new Set(
      [e.title, e.text, e.big_text]
        .filter((v): v is string => typeof v === "string" && !!v.trim())
        .map((v) => v.trim()),
    ),
  ];
  const receiptText = fields
    .filter(
      (field) =>
        !fields.some((other) => other !== field && other.includes(field)),
    )
    .join(" ");
  const amounts = [...receiptText.matchAll(money)];
  if (amounts.length !== 1)
    return reject(amounts.length ? "multiple_amounts" : "no_amount");
  const englishReceipt = /\b(received|credited|deposited|paid\s+you)\b/i.test(
    body,
  );
  // Strict positive Hindi receipt template; real provider formats still need phone validation.
  const hindiReceipt = [e.title, e.text, e.big_text].some(
    (field) =>
      typeof field === "string" &&
      /^(?:₹|Rs\.?|INR)\s*[0-9][0-9,]*(?:\.[0-9]+)?\s+[^\r\n₹]{1,120}\s+से प्राप्त हुआ(?:\s*\n\s*\d{1,2} [A-Za-z]{3} \d{4} \d{1,2}:\d{2} (?:AM|PM) को प्राप्त हुआ)?\s*$/iu.test(
        field.trim(),
      ),
  );
  if (!englishReceipt && !hindiReceipt) return reject("no_credit_wording");
  const n = amounts[0][1];
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(n) &&
    !/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(n) &&
    !/^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(n)
  )
    return reject("invalid_amount");
  const [whole, fraction = ""] = n.replaceAll(",", "").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 100 === 0)
    return reject("whole_or_invalid_amount");
  return { observation: { profile, amount }, reason: "receipt_parsed" };
}
export function parseNotification(e: any) {
  return analyzeNotification(e).observation;
}
export function derToRaw(signature: string) {
  let a: Uint8Array;
  try {
    a = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    fail(401, "invalid_signature", "Invalid relay signature");
  }
  if (a.length < 8 || a.length > 72 || a[0] !== 48 || a[1] !== a.length - 2)
    fail(401, "invalid_signature", "Invalid relay signature");
  let off = 2;
  const out = new Uint8Array(64);
  for (let i = 0; i < 2; i++) {
    if (a[off++] !== 2)
      fail(401, "invalid_signature", "Invalid relay signature");
    const len = a[off++];
    let n = a.slice(off, off + len);
    off += len;
    if (
      !len ||
      len > 33 ||
      n.length !== len ||
      n[0] & 128 ||
      (len > 1 && n[0] === 0 && !(n[1] & 128))
    )
      fail(401, "invalid_signature", "Invalid relay signature");
    if (n.length === 33) {
      if (n[0] !== 0) fail(401, "invalid_signature", "Invalid relay signature");
      n = n.slice(1);
    }
    out.set(n, i * 32 + 32 - n.length);
  }
  if (off !== a.length)
    fail(401, "invalid_signature", "Invalid relay signature");
  return out;
}
export async function importPEM(pem: string) {
  if (
    !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(pem)
  )
    fail(400, "invalid_key", "Use a P-256 public key");
  try {
    return await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(
        atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
        (c) => c.charCodeAt(0),
      ),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    fail(400, "invalid_key", "Use a P-256 public key");
  }
}
export async function authenticateRelay(req: Request, env: Env, raw: string) {
  const device = await one(
    env,
    "SELECT * FROM devices WHERE id=? AND enabled=1",
    req.headers.get("X-PayGate-Relay-Device") || "",
  );
  if (!device)
    fail(
      401,
      "unknown_relay_device",
      "Phone is not paired or has been revoked",
    );
  const time = req.headers.get("X-PayGate-Relay-Time") || "",
    epoch = req.headers.get("X-PayGate-Relay-Epoch") || "";
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 300000 ||
    epoch !== String(device.epoch)
  )
    fail(401, "invalid_relay_time", "Check phone clock or pair again");
  const canonical = `${req.method}\n${new URL(req.url).pathname}\n${time}\n${epoch}\n${await sha(raw)}`;
  const key = await importPEM(device.pem);
  const signature = derToRaw(
    req.headers.get("X-PayGate-Relay-Signature") || "",
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      enc.encode(canonical),
    ))
  )
    fail(401, "invalid_signature", "Invalid relay signature");
  return device;
}
export function viewPayment(p: any, origin: string) {
  const upi = new URLSearchParams({
    pa: p.upi,
    pn: p.payee,
    am: (p.payable / 100).toFixed(2),
    cu: "INR",
    tn: `FFSHOP ${p.id}`,
  });
  return {
    id: p.id,
    name: p.name,
    external_id: p.external_id,
    status:
      p.status === "pending" && Date.now() > p.grace ? "expired" : p.status,
    requested_amount: (p.requested / 100).toFixed(2),
    payable_amount: (p.payable / 100).toFixed(2),
    profile: p.profile,
    payee: p.payee,
    upi: p.upi,
    upi_uri: `upi://pay?${upi}`,
    created_at: new Date(p.created).toISOString(),
    expires_at: new Date(p.expires).toISOString(),
    grace_until: new Date(p.grace).toISOString(),
    confirmation_source:
      p.status === "paid"
        ? String(p.evidence).startsWith("manual:")
          ? "manual"
          : "notification"
        : null,
    paid_at: p.paid_at ? new Date(p.paid_at).toISOString() : null,
    checkout_url: `${origin}/pay/${p.id}`,
  };
}

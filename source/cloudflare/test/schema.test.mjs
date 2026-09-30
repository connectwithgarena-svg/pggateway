import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const schema = (await readFile("migrations/0001.sql", "utf8")).replace(
  /CREATE TRIGGER[\s\S]*?END;/g,
  (statement) => statement.replace(/\n/g, " "),
);
const expectedTables = [
  "api_keys",
  "deliveries",
  "devices",
  "events",
  "limits",
  "pairings",
  "payments",
  "profiles",
  "sessions",
  "settings",
  "slots",
];
async function fixture(run) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("schema fixture")}}',
      compatibilityDate: "2026-09-29",
      d1Databases: { DB: "ffshop-schema-fixture" },
    }),
  );
  try {
    await run(await mf.getD1Database("DB"));
  } finally {
    await mf.dispose();
  }
}
async function checkObjects(db) {
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all()
  ).results.map((r) => r.name);
  assert.deepEqual(tables, expectedTables);
  const triggers = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
      )
      .all()
  ).results.map((r) => r.name);
  assert.deepEqual(triggers, [
    "confirm_payment",
    "consume_pair",
    "guard_destination",
    "queue_paid",
  ]);
}
test("schema resumes when settings already exists and preserves its rows", async () =>
  fixture(async (db) => {
    await db.exec(
      "CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT; INSERT INTO settings VALUES('fixture','preserve-me');",
    );
    await db.exec(schema);
    await checkObjects(db);
    assert.equal(
      (
        await db
          .prepare("SELECT value FROM settings WHERE key='fixture'")
          .first()
      ).value,
      "preserve-me",
    );
  }));
test("schema reruns without losing payment, reservation or profile data", async () =>
  fixture(async (db) => {
    await db.exec(schema);
    await db.exec(
      "INSERT INTO profiles VALUES('paytm','Fixture','fixture@invalid','Test',1); INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('fixture-payment','admin','fixture-key','fixture-hash',1000,1001,'paytm','fixture@invalid','Test','Fixture',1,2,3,4); INSERT INTO slots VALUES(1001,'fixture-payment',4);",
    );
    const before = (await db.prepare("SELECT * FROM payments").all()).results;
    await db.exec(schema);
    await db.exec(schema);
    await checkObjects(db);
    assert.deepEqual(
      (await db.prepare("SELECT * FROM payments").all()).results,
      before,
    );
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM slots").first()).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM profiles").first()).n,
      1,
    );
  }));

test("upgrade preserves existing payments and protects account lifecycle at database boundary", async () =>
  fixture(async (db) => {
    await db.exec(schema);
    await db.exec(
      "INSERT INTO profiles VALUES('paytm','Fixture','fixture@invalid','Test',1); INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('upgrade-payment','admin','upgrade-key','hash',1000,1001,'paytm','fixture@invalid','Test','Keep me',unixepoch('subsec')*1000,unixepoch('subsec')*1000+300000,unixepoch('subsec')*1000+600000,unixepoch('subsec')*1000+86400000);",
    );
    const upgrade = await readFile("migrations/0002.sql", "utf8");
    await db.exec(
      upgrade
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("--"))
        .join("\n"),
    );
    assert.equal(
      (
        await db
          .prepare("SELECT enabled FROM profiles WHERE id='paytm'")
          .first()
      ).enabled,
      1,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT name FROM payments WHERE id='upgrade-payment'")
          .first()
      ).name,
      "Keep me",
    );
    await assert.rejects(
      db
        .prepare("UPDATE profiles SET active=0,removed=1 WHERE id='paytm'")
        .run(),
      /pending_destination_change/,
    );
    await assert.rejects(
      db.prepare("UPDATE profiles SET enabled=0 WHERE id='paytm'").run(),
      /invalid_profile_state/,
    );
    await db.exec(
      "UPDATE payments SET status='cancelled' WHERE id='upgrade-payment'; UPDATE profiles SET active=0,enabled=0,removed=1 WHERE id='paytm';",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT name FROM payments WHERE id='upgrade-payment'")
          .first()
      ).name,
      "Keep me",
    );
  }));

test("1.5 migration preserves linked orders and permits Google Pay Business", async () =>
  fixture(async (db) => {
    await db.exec(schema);
    const clean = (s) =>
      s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("--"))
        .join("\n");
    await db.exec(clean(await readFile("migrations/0002.sql", "utf8")));
    await db.exec(
      "INSERT INTO profiles VALUES('paytm','Keep account','keep@invalid','Fixture',1,1,0); INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('keep','admin','keep','hash',1000,1001,'paytm','keep@invalid','Fixture','Keep order',1,2,3,4); INSERT INTO slots VALUES(1001,'keep',4);",
    );
    await db.exec(
      "INSERT INTO settings VALUES('webhook','{\"endpoint\":\"https://old.example/callback\",\"secret\":\"old-secret\"}'); INSERT INTO deliveries(id,payment_id,endpoint,secret,payload,next_at) VALUES('old-delivery','keep','https://old.example/callback','old-secret','private',1);",
    );
    const payments = (await db.prepare("SELECT * FROM payments").all()).results;
    const profiles = (await db.prepare("SELECT * FROM profiles").all()).results;
    await db.exec(clean(await readFile("migrations/0003.sql", "utf8")));
    assert.deepEqual(
      (await db.prepare("SELECT * FROM payments").all()).results,
      payments,
    );
    assert.deepEqual(
      (await db.prepare("SELECT * FROM profiles").all()).results,
      profiles,
    );
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM slots").first()).n,
      1,
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    assert.equal(
      await db
        .prepare("SELECT value FROM settings WHERE key='webhook'")
        .first(),
      null,
    );
    assert.deepEqual(
      await db
        .prepare(
          "SELECT status,endpoint,secret,payload FROM deliveries WHERE id='old-delivery'",
        )
        .first(),
      { status: "cancelled", endpoint: "", secret: "", payload: "" },
    );
    await db.exec(
      "INSERT INTO profiles VALUES('gpay','Google Business','google@invalid','Fixture',0,1,0)",
    );
    await assert.rejects(
      db.prepare("UPDATE profiles SET active=1 WHERE id='gpay'").run(),
      /UNIQUE/,
    );
    await assert.rejects(
      db.prepare("UPDATE profiles SET removed=1 WHERE id='paytm'").run(),
      /invalid_profile_state/,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT value FROM settings WHERE key='schema_version'")
          .first()
      ).value,
      "3",
    );
  }));

test("1.6 upgrade retains historical larger adjustments and enforces paise range on new orders", async () =>
  fixture(async (db) => {
    await db.exec(schema);
    const clean = (s) =>
      s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("--"))
        .join("\n");
    for (const file of ["0002.sql", "0003.sql"])
      await db.exec(clean(await readFile("migrations/" + file, "utf8")));
    await db.exec(
      "INSERT INTO profiles VALUES('bharatpe','Test','test@invalid','Test',1,1,0); INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('old','admin','old','hash',100,679,'bharatpe','test@invalid','Test','Historical',1,2,3,4); INSERT INTO slots VALUES(679,'old',4); INSERT INTO settings VALUES('webhook','{\"endpoint\":\"https://own.example\",\"secret\":\"synthetic\"}');",
    );
    const original = (await db.prepare("SELECT * FROM payments").all()).results;
    const upgrade = await readFile("migrations/0004.sql", "utf8");
    await db.exec(upgrade);
    await db.exec(upgrade);
    assert.deepEqual(
      (await db.prepare("SELECT * FROM payments").all()).results,
      original,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT value FROM settings WHERE key='schema_version'")
          .first()
      ).value,
      "4",
    );
    assert(
      await db
        .prepare("SELECT value FROM settings WHERE key='webhook'")
        .first(),
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    assert.equal(
      (await db.prepare("SELECT count(*) n FROM slots").first()).n,
      1,
    );
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('new','admin','new','hash',100,201,'bharatpe','test@invalid','Test','Invalid adjustment',1,2,3,4)",
        )
        .run(),
      /invalid_payment_adjustment/,
    );
  }));

test("1.7 combined update preserves schema3/4/5 history, settings and row dedup state", async () =>
  fixture(async (db) => {
    await db.exec(schema);
    const clean = (s) =>
      s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith("--"))
        .join("\n");
    for (const n of [2, 3])
      await db.exec(clean(await readFile(`migrations/000${n}.sql`, "utf8")));
    await db.exec(
      "INSERT INTO profiles(id,label,upi,payee,active) VALUES('paytm','Test','test@invalid','Test',1); INSERT INTO payments(id,scope,idem,request_hash,requested,payable,profile,upi,payee,name,created,expires,grace,reuse) VALUES('keep','admin','keep','hash',100,679,'paytm','test@invalid','Test','Keep',1,2,3,4); INSERT INTO settings VALUES('webhook','{\"endpoint\":\"https://shop.example/callback\",\"secret\":\"synthetic\"}'); INSERT INTO settings VALUES('website_origin','https://shop.example');",
    );
    const original = await db.prepare("SELECT * FROM payments").first();
    const four = await readFile("migrations/0004.sql", "utf8"),
      five = await readFile("migrations/0005.sql", "utf8");
    await db.exec(four);
    await db.exec("INSERT INTO bharatpe_rows VALUES('seen','event',1)");
    await db.exec(four + "\n" + five);
    await db.exec(
      "INSERT INTO payment_returns VALUES('keep','https://shop.example/return')",
    );
    await db.exec(four + "\n" + five);
    assert.deepEqual(
      await db.prepare("SELECT * FROM payments").first(),
      original,
    );
    assert(
      await db.prepare("SELECT * FROM bharatpe_rows WHERE id='seen'").first(),
    );
    assert(
      await db
        .prepare("SELECT value FROM settings WHERE key='webhook'")
        .first(),
    );
    assert.equal(
      (await db.prepare("SELECT url FROM payment_returns").first()).url,
      "https://shop.example/return",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT value FROM settings WHERE key='schema_version'")
          .first()
      ).value,
      "5",
    );
    assert.deepEqual(
      (await db.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
  }));

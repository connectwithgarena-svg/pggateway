// Build first. Use the previously verified, signed APK; no private keys bundled.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
const args = process.argv.slice(2),
  apk = args[args.indexOf("--apk") + 1],
  out = args[args.indexOf("--out") + 1];
if (!args.includes("--apk") || !args.includes("--out") || !apk || !out)
  throw Error(
    "Usage: node scripts/package.mjs --apk signed.apk --out final.zip",
  );
const files = {};
const load = async (name, path) =>
  (files[name] = new Uint8Array(await readFile(path)));
for (const name of ["LICENSE", "NOTICE", "PROVIDERS.md", "PRIVACY.md"])
  await load(name, "../" + name);
for (const name of ["PAYMENT-LOGIC.md", "RELEASE-NOTES.md"])
  await load(name, name);
for (const [name, path] of [
  ["03-WEBSITE-INTEGRATION.md", "WEBSITE-INTEGRATION.md"],
  ["04-START-HERE-HINDI.md", "START-HERE-HINDI.md"],
  ["source.zip", "dist/source.zip"],
  ["05-MAINTENANCE-WORKER.js", "build/jobs.js"],
  ["extras/setup-key.html", "web/setup-key.html"],
  ["FF-Shop-Relay-1.5.apk", apk],
])
  await load(name, path);
const pageFiles = {};
for (const name of [
  "index.html",
  "app.js",
  "style.css",
  "_worker.js",
  "_headers",
  "_routes.json",
  "source.zip",
  "deployment-check.html",
  "deployment-check.js",
  "integration-guide.html",
  "PRIVACY.md",
])
  pageFiles[name] = new Uint8Array(await readFile("dist/" + name));
files["01-PAGES-UPLOAD.zip"] = zipSync(pageFiles, { level: 9 });
const migrations = await Promise.all(
  [1, 2, 3, 4, 5].map((n) => readFile(`migrations/000${n}.sql`, "utf8")),
);
const consoleSQL = (text) =>
  text
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, (s) => s.replace(/\n/g, " "))
    .split(/\r?\n/)
    .filter((s) => s.trim() && !s.trim().startsWith("--"))
    .join("\n") + "\n";
for (const [name, start] of [
  ["02-DATABASE-UPDATE.sql", 3],
  ["extras/database-FRESH-ONLY.sql", 0],
  ["extras/upgrade-from-1.3.sql", 1],
  ["extras/upgrade-from-1.4.sql", 2],
])
  files[name] = new TextEncoder().encode(
    consoleSQL(migrations.slice(start).join("\n")),
  );
const helper = {};
for (const name of ["ffshop-client.mjs", "README.md"])
  helper[name] = new Uint8Array(await readFile("website-integration/" + name));
helper["LICENSE"] = files.LICENSE;
helper["NOTICE"] = files.NOTICE;
files["WEBSITE-SERVER-HELPER.zip"] = zipSync(helper, { level: 9 });
files["00-READ-FIRST.txt"] = new TextEncoder().encode(
  "FF SHOP1.7\n\nYour checked live site was1.5 / schema3.\n1. Back up existing D1. Execute full 02-DATABASE-UPDATE.sql in its Console. Version query must return5.\n2. Upload ONLY 01-PAGES-UPLOAD.zip to ffshop-255 Pages Production. Keep DB binding/origin/admin hash.\n3. Check /deployment-check.html:1.7.0, schema5, all PASS.\n4. Keep installed Relay1.5. Refresh BharatPe BEFORE creating an order; pay during the next-minute interval shown on checkout.\n5. Extra0.01–0.99 applies to ALL providers. Real-phone acceptance test is still required.\n6. Read 04-START-HERE-HINDI.md and 03-WEBSITE-INTEGRATION.md. API key goes only on your website server.\n7. Never upload this outer ZIP or fresh SQL over your existing database.\n",
);
files["SHA256SUMS.txt"] = new TextEncoder().encode(
  Object.keys(files)
    .sort()
    .map(
      (name) =>
        createHash("sha256").update(files[name]).digest("hex") + "  " + name,
    )
    .join("\n") + "\n",
);
await mkdir(resolve(out, ".."), { recursive: true });
await writeFile(out, zipSync(files, { level: 9 }));
console.log(
  "Final numbered package written: " +
    resolve(out) +
    " (" +
    Object.keys(files).length +
    " files)",
);

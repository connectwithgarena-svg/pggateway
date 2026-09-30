// Local-only development: isolated persistent fixture DB and synthetic admin identity.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
const runtime = process.env.FFSHOP_PREVIEW_STATE;
if (!runtime)
  throw new Error(
    "Set FFSHOP_PREVIEW_STATE to a private directory outside the checkout.",
  );
await mkdir(runtime, { recursive: true });
const keyFile = resolve(runtime, "admin.key");
let key;
try {
  key = (await readFile(keyFile, "utf8")).trim();
} catch {
  key = randomBytes(32).toString("hex");
  await writeFile(keyFile, key, { mode: 0o600 });
}
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "0.0.0.0",
    port: 8790,
    https: true,
    modules: true,
    script: await readFile("dist/_worker.js", "utf8"),
    compatibilityDate: "2026-09-29",
    d1Databases: { DB: "ffshop-preview" },
    d1Persist: resolve(runtime, "d1"),
    bindings: {
      PUBLIC_ORIGIN: "https://localhost:8790",
      ADMIN_KEY_HASH: createHash("sha256").update(key).digest("hex"),
    },
    serviceBindings: {
      ASSETS: async (request) => {
        const url = new URL(request.url);
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        if (
          ![
            "/index.html",
            "/app.js",
            "/style.css",
            "/source.zip",
            "/deployment-check.html",
            "/deployment-check.js",
            "/integration-guide.html",
            "/PRIVACY.md",
          ].includes(path)
        )
          return new Response("Not found", { status: 404 });
        try {
          return new Response(await readFile(resolve("dist", "." + path)), {
            headers: {
              "Content-Type": path.endsWith(".js")
                ? "text/javascript"
                : path.endsWith(".css")
                  ? "text/css"
                  : path.endsWith(".zip")
                    ? "application/zip"
                    : "text/html",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  }),
);
await mf.ready;
const db = await mf.getD1Database("DB");
if (
  !(await db
    .prepare("SELECT name FROM sqlite_master WHERE name='profiles'")
    .first())
)
  await db.exec(
    (await readFile("migrations/0001.sql", "utf8")).replace(
      /CREATE TRIGGER[\s\S]*?END;/g,
      (m) => m.replace(/\n/g, " "),
    ),
  );
const columns = (await db.prepare("PRAGMA table_info(profiles)").all()).results;
if (!columns.some((column) => column.name === "enabled")) {
  const upgrade = await readFile("migrations/0002.sql", "utf8");
  await db.exec(
    upgrade
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("--"))
      .join("\n"),
  );
}
const version = await db
  .prepare("SELECT value FROM settings WHERE key='schema_version'")
  .first();
if (!["3", "4", "5"].includes(version?.value)) {
  const migration = (await readFile("migrations/0003.sql", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("--"))
    .join("\n");
  await db.exec(migration);
}
if (!["4", "5"].includes(version?.value)) {
  await db.exec(await readFile("migrations/0004.sql", "utf8"));
}
if (version?.value !== "5")
  await db.exec(await readFile("migrations/0005.sql", "utf8"));
console.log(
  "FFSHOP local Pages runtime ready on port 8790. Synthetic DB; no merchant configured.",
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    await mf.dispose();
    process.exit();
  });

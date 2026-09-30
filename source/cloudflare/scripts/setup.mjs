import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
const cli = createInterface({ input: stdin, output: stdout });
try {
  try {
    await access("wrangler.json");
    throw new Error(
      "wrangler.json already exists; edit the existing configuration instead of regenerating credentials.",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const name = (
    await cli.question(
      "Cloudflare Pages project name (lowercase letters/numbers/hyphens): ",
    )
  ).trim();
  const databaseId = (
    await cli.question("Existing Cloudflare D1 database UUID: ")
  ).trim();
  const databaseName =
    (await cli.question("D1 database name [ffshop]: ")).trim() || "ffshop";
  if (
    !/^[a-z][a-z0-9-]{1,48}$/.test(name) ||
    !/^\w[\w-]{0,63}$/.test(databaseName) ||
    !/^[a-f0-9-]{36}$/.test(databaseId)
  )
    throw new Error("Invalid project name or database ID");
  const key = randomBytes(32).toString("hex");
  const binding = {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "migrations",
  };
  await writeFile(
    "wrangler.json",
    JSON.stringify(
      {
        name,
        pages_build_output_dir: "dist",
        compatibility_date: "2026-09-29",
        d1_databases: [binding],
        vars: { PUBLIC_ORIGIN: `https://${name}.pages.dev` },
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    "wrangler.jobs.json",
    JSON.stringify(
      {
        name: name + "-maintenance",
        main: "src/jobs.ts",
        compatibility_date: "2026-09-29",
        workers_dev: false,
        triggers: { crons: ["*/5 * * * *"] },
        d1_databases: [binding],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  await writeFile(
    ".ffshop-admin.txt",
    `Admin key (keep private): ${key}\nADMIN_KEY_HASH: ${createHash("sha256").update(key).digest("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Configuration saved. Keep .ffshop-admin.txt private. Create the Pages project, set its ADMIN_KEY_HASH secret from this file, then npm run deploy.",
  );
} finally {
  cli.close();
}

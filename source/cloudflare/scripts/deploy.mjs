import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const config = JSON.parse(await readFile("wrangler.json", "utf8"));
await access("dist/source.zip");
function run(args) {
  const r = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    {
      stdio: "inherit",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  if (r.status !== 0) process.exit(r.status || 1);
}
// Remote writes only when the operator explicitly runs npm run deploy.
run([
  "d1",
  "migrations",
  "apply",
  config.d1_databases[0].database_name,
  "--remote",
  "--config",
  "wrangler.json",
]);
run(["deploy", "--config", "wrangler.jobs.json"]);
run([
  "pages",
  "deploy",
  "dist",
  "--project-name",
  config.name,
  "--branch",
  "main",
]);

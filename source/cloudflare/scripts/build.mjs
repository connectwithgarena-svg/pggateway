import { build } from "esbuild";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/worker.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await build({
  entryPoints: ["src/jobs.ts"],
  outfile: "build/jobs.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await build({
  entryPoints: ["web/app.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await copyFile("web/index.html", "dist/index.html");
await copyFile("web/style.css", "dist/style.css");
for (const file of [
  "deployment-check.html",
  "deployment-check.js",
  "integration-guide.html",
])
  await copyFile("web/" + file, "dist/" + file);
await copyFile("../PRIVACY.md", "dist/PRIVACY.md");
await writeFile(
  "dist/_routes.json",
  JSON.stringify({
    version: 1,
    include: [
      "/",
      "/pay/*",
      "/device/pair/*",
      "/api/*",
      "/admin/*",
      "/healthz",
    ],
    exclude: [],
  }),
);
await writeFile(
  "dist/_headers",
  `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\n`,
);
console.log("Built FFSHOP Pages app and scheduled maintenance Worker.");
await import("./source.mjs");

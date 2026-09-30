import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { zipSync } from "fflate";
import { resolve, relative } from "node:path";
const root = resolve(".."),
  files = {};
async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (
      ["node_modules", "build", "dist", ".gradle", ".wrangler"].includes(
        ent.name,
      ) ||
      ent.name.startsWith(".dev.vars") ||
      ent.name.startsWith(".env") ||
      [
        ".ffshop-admin.txt",
        "wrangler.json",
        "wrangler.jobs.json",
        "local.properties",
      ].includes(ent.name)
    )
      continue;
    const path = resolve(dir, ent.name);
    if (ent.isDirectory()) await walk(path);
    else if (ent.isFile()) {
      const name = relative(root, path).replaceAll("\\", "/");
      if (/\.(jks|keystore|pem|p12|pfx|key|db|log)$/.test(name)) continue;
      files[name] =
        name === "android/gradlew"
          ? [
              new Uint8Array(await readFile(path)),
              { os: 3, attrs: 0o100755 << 16 },
            ]
          : new Uint8Array(await readFile(path));
    }
  }
}
await walk(resolve("src"));
await walk(resolve("web"));
await walk(resolve("scripts"));
await walk(resolve("test"));
await walk(resolve("migrations"));
await walk(resolve("website-integration"));
await walk(resolve("../android"));
for (const name of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "wrangler.example.json",
  "wrangler.jobs.example.json",
  "README.md",
  "START-HERE-HINDI.md",
  "PAYMENT-LOGIC.md",
  "RELEASE-NOTES.md",
  "WEBSITE-INTEGRATION.md",
  ".gitignore",
])
  files["cloudflare/" + name] = new Uint8Array(await readFile(name));
for (const name of ["LICENSE", "NOTICE", "PROVIDERS.md", "PRIVACY.md"])
  files[name] = new Uint8Array(await readFile("../" + name));
await mkdir("dist", { recursive: true });
await writeFile("dist/source.zip", zipSync(files, { level: 9 }));
console.log(
  `Bundled ${Object.keys(files).length} source files, license and Android sources.`,
);

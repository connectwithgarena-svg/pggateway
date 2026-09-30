import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";
// Exercise Wrangler's actual Pages asset server: a plain ASSETS mock misses
// the /index.html -> / canonical redirect that caused the production loop.
test(
  "Pages asset routing serves home and checkout without redirect loops",
  { timeout: 30000 },
  async () => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const child = spawn(
      process.execPath,
      [
        resolve("node_modules/wrangler/bin/wrangler.js"),
        "pages",
        "dev",
        "dist",
        "--port",
        String(port),
        "--ip",
        "127.0.0.1",
        "--compatibility-date",
        "2026-09-29",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    let logs = "";
    child.stdout.on("data", (b) => (logs += b));
    child.stderr.on("data", (b) => (logs += b));
    const base = `http://127.0.0.1:${port}`;
    try {
      const deadline = Date.now() + 20000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(logs);
        try {
          const r = await fetch(base + "/healthz", {
            signal: AbortSignal.timeout(500),
          });
          ready = r.ok;
          await r.body?.cancel();
          if (ready) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready, logs);
      for (const path of [
        "/",
        "/?fixture=1",
        "/pay/fixture-order",
        "/pay/fixture-order?fixture=1",
      ]) {
        const response = await fetch(base + path, { redirect: "manual" });
        assert.equal(
          response.status,
          200,
          `${path} redirects to ${response.headers.get("location")}`,
        );
        assert.equal(response.headers.get("location"), null);
        assert.match(await response.text(), /FFSHOP Payments/);
      }
      const canonical = await fetch(base + "/index.html", {
        redirect: "manual",
      });
      assert.equal(canonical.status, 308);
      assert.equal(canonical.headers.get("location"), "/");
      const followed = await fetch(base + "/index.html");
      assert.equal(followed.status, 200);
      assert.equal(new URL(followed.url).pathname, "/");
      await followed.body?.cancel();
      for (const path of [
        "/app.js",
        "/style.css",
        "/source.zip",
        "/deployment-check.html",
        "/deployment-check.js",
        "/PRIVACY.md",
        "/integration-guide.html",
      ]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200);
        await response.body?.cancel();
      }
      // Missing settings must remain an API failure, not SPA HTML or a redirect.
      const admin = await fetch(base + "/admin/state", { redirect: "manual" });
      assert.equal(admin.status, 503);
      assert.equal((await admin.json()).error.code, "not_configured");
    } finally {
      if (child.exitCode === null) {
        process.kill(-child.pid, "SIGTERM");
        await Promise.race([
          once(child, "exit"),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
        if (child.exitCode === null) process.kill(-child.pid, "SIGKILL");
      }
    }
  },
);

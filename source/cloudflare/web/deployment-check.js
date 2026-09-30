const results = document.getElementById("results"),
  button = document.getElementById("check");
async function check() {
  button.disabled = true;
  results.replaceChildren();
  const show = (ok, label, detail) => {
    const li = document.createElement("li");
    li.textContent = `${ok ? "PASS" : "CHECK"} — ${label}: ${detail}`;
    li.className = ok ? "positive" : "muted";
    results.append(li);
  };
  for (const [path, type] of [
    ["/healthz", "json"],
    ["/api/readiness", "json"],
    ["/app.js", "javascript"],
    ["/style.css", "css"],
    ["/source.zip", "zip"],
  ]) {
    try {
      const response = await fetch(path, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
      if (type === "json") {
        if (!response.headers.get("content-type")?.includes("application/json"))
          throw Error(`HTTP ${response.status}: Worker/API missing`);
        const data = await response.json();
        if (path === "/healthz")
          show(
            response.ok && data.version === "1.7.0",
            path,
            data.version
              ? `FF Shop ${data.version}`
              : "Old Worker — upload the full current package",
          );
        else if (data.checks) {
          const descriptions = {
            origin: "PUBLIC_ORIGIN matches this HTTPS domain",
            admin_key: "ADMIN_KEY_HASH is configured",
            database: "D1 is bound as DB",
            schema: "D1 migration 0005 has been applied",
          };
          for (const [key, label] of Object.entries(descriptions))
            show(
              data.checks[key] === true,
              label,
              data.checks[key] ? "Ready" : "Needs configuration",
            );
        } else
          show(
            false,
            path,
            "Readiness route missing — redeploy current _worker.js",
          );
      } else {
        const valid =
          response.ok &&
          (response.headers.get("content-type") || "").includes(type);
        show(
          valid,
          path,
          valid
            ? "File available"
            : `HTTP ${response.status}; missing or wrong file type`,
        );
        await response.body?.cancel();
      }
    } catch (error) {
      show(false, path, error.message);
    }
  }
  button.disabled = false;
}
button.addEventListener("click", check);
check();

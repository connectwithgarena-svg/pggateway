import QRCode from "qrcode";
const root = document.querySelector("#app"),
  notice = document.querySelector("#notice"),
  modal = document.querySelector("#modal");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const providers = {
  paytm: "Paytm Business",
  bharatpe: "BharatPe",
  phonepe: "PhonePe Business",
  hdfc: "HDFC SmartHub Vyapar",
  gpay: "Google Pay Business",
};
const initials = {
  paytm: "pt",
  bharatpe: "B",
  phonepe: "Pe",
  hdfc: "H",
  gpay: "G",
};
const icons = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  transactions: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  accounts: "M3 21h18 M4 9h16 M12 3l9 6H3z M6 9v12 M12 9v12 M18 9v12",
  phones: "M7 2h10v20H7z M10 18h4",
  integrations: "M8 3v5 M16 3v5 M6 8h12v3a6 6 0 0 1-12 0z M12 17v5",
  diagnostics: "M3 12h4l3-8 4 16 3-8h4",
  privacy: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  refresh: "M20 7v5h-5 M4 17v-5h5 M19 12a7 7 0 0 0-12-5 M5 12a7 7 0 0 0 12 5",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  close: "M6 6l12 12 M18 6L6 18",
  check: "M5 12l4 4L19 6",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  logout: "M9 3H4v18h5 M10 12h11 M16 7l5 5-5 5",
  link: "M10 14l4-4 M8 16l-2 2a4 4 0 0 1-6-6l4-4 M16 8l2-2a4 4 0 0 1 6 6l-4 4",
  wallet: "M3 6h18v14H3z M3 6l14-4v4 M16 11h5v5h-5z",
};
const icon = (k) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[k] || icons.info}"/></svg>`;
const money = (v) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
const date = (v) =>
  v
    ? new Date(v).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not available";
const badge = (s) =>
  `<span class="badge ${esc(s)}">${esc(s[0]?.toUpperCase() + s.slice(1))}</span>`;
const logo = (p) =>
  `<div class="provider-logo ${esc(p)}" aria-hidden="true">${initials[p] || "B"}</div>`;
const button = (action, label, cls = "secondary", value = "") =>
  `<button type="button" class="${cls}" data-action="${action}" data-value="${esc(value)}" ${label.startsWith("<svg") && !label.includes("</svg> ") ? `aria-label="${esc(action === "nav" ? pages[value]?.[0] || "Open section" : action === "close" ? "Close dialog" : action)}"` : ""}>${label}</button>`;
const empty = (title, description = "", action = "") =>
  `<div class="empty"><div class="empty-icon">${icon("transactions")}</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
const footer = () =>
  `<footer class="footer"><span>FFSHOP · Your payment workspace</span><a href="/source.zip">Source &amp; license</a></footer>`;
let state,
  view = "overview",
  timer,
  orderKey = crypto.randomUUID(),
  filter = { search: "", status: "", profile: "", page: 1 },
  transactionPage,
  requestSequence = 0;
function message(s) {
  notice.textContent = s;
  setTimeout(() => {
    if (notice.textContent === s) notice.textContent = "";
  }, 7000);
}
async function api(path, method = "GET", body, extra = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    const error = new Error(
      "The API is missing or returned a page. Upload the complete pages-upload.zip, then open Deployment check.",
    );
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}
function form(id, fn) {
  document.getElementById(id)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(e.target)));
    } catch (error) {
      message(error.message);
    } finally {
      btn.disabled = false;
    }
  });
}
function openModal(title, body) {
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>${button("close", icon("close"), "ghost")}</div><div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  modal.close();
  modal.innerHTML = "";
}
async function qr(value, target) {
  const el = document.getElementById(target);
  if (el)
    el.src = await QRCode.toDataURL(value, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: "M",
    });
}
function login() {
  clearInterval(timer);
  if (modal.open) closeModal();
  root.innerHTML = `<div class="login-screen"><section class="login-hero"><div class="brand">FF<span>SHOP</span><small>PAYMENT WORKSPACE</small></div><h1>Your business.<br>Your payments.<br><em>Your control.</em></h1><p>Manage your business accounts, collect UPI payments and keep every order in view.</p><div class="supported-providers">${Object.values(
    providers,
  )
    .map((p) => `<span>${esc(p)}</span>`)
    .join(
      "",
    )}</div></section><section class="login-form"><div class="login-card"><div class="eyebrow">Welcome back</div><h2>Sign in to your workspace</h2><p>A private workspace for your accounts, payments and relay phones.</p><form id="login"><label>Private admin key<input name="password" type="password" autocomplete="current-password" placeholder="Enter your admin key" required></label><button type="submit">Sign in securely ${icon("arrow")}</button></form><footer>Use the key generated during your Cloudflare setup.<br><a href="/source.zip">Source &amp; license</a></footer></div></section></div>`;
  form("login", async (b) => {
    await api("/admin/session", "POST", b);
    await dashboard();
  });
}
const pages = {
  overview: [
    "Overview",
    "A clear view of your payments and connected business accounts.",
  ],
  transactions: [
    "Transactions",
    "Search your order history and follow every payment.",
  ],
  accounts: [
    "Business accounts",
    "Manage the receiving accounts behind your business QR codes.",
  ],
  phones: [
    "Connected phones",
    "Keep your merchant notifications connected to your workspace.",
  ],
  integrations: [
    "Integrations",
    "Connect your shop and deliver payment updates.",
  ],
  privacy: [
    "Privacy & setup",
    "See where your data goes and check your deployment.",
  ],
  diagnostics: [
    "Notification activity",
    "Understand which notifications were accepted and why.",
  ],
};
async function dashboard() {
  try {
    state = await api("/admin/state");
  } catch (error) {
    if (error.status === 401) {
      login();
      return;
    }
    throw error;
  }
  clearInterval(timer);
  renderShell();
  timer = setInterval(async () => {
    if (document.hidden || modal.open) return;
    try {
      state = await api("/admin/state");
      if (view === "transactions") await loadTransactions();
      else if (
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName,
        )
      )
        renderShell();
    } catch (error) {
      if (error.status === 401) login();
    }
  }, 30000);
}
function renderShell() {
  const [title] = pages[view];
  root.innerHTML = `<div class="workspace"><aside class="sidebar"><div class="brand">FF<span>SHOP</span><small>PAYMENT WORKSPACE</small></div><div class="workspace-label">Workspace</div><nav class="nav" aria-label="Main navigation">${Object.entries(
    pages,
  )
    .map(
      ([k, [v]]) =>
        `<button data-action="nav" data-value="${k}" class="${view === k ? "active" : ""}" ${view === k ? 'aria-current="page"' : ""}>${icon(k)}${v}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="side-profile"><div class="avatar">A</div><div><strong>Business admin</strong><span>Private workspace</span></div></div><p>FF Shop 1.7</p><a href="/source.zip">Source &amp; license ↗</a></div></aside><div class="content"><header class="topbar"><div class="breadcrumb">Workspace <span aria-hidden="true"> / </span> <strong>${title}</strong></div><div class="top-actions"><span class="environment"><span class="dot"></span>Refreshes every 30s</span>${button("refresh", icon("refresh") + " Refresh", "secondary small")}${button("logout", icon("logout") + " Sign out", "ghost small")}</div></header><div class="page"><div class="page-heading"><div><div class="eyebrow">Your business, connected</div><h1>${view === "overview" ? "Business overview" : title}</h1><p>${pages[view][1]}</p></div>${["overview", "transactions"].includes(view) ? button("new-payment", icon("plus") + " Create payment", "primary") : view === "accounts" ? button("add-account", icon("plus") + " Add account", "primary") : ""}</div><div id="page-content">${{ overview: overview, transactions: transactions, accounts: accounts, phones: phones, integrations: integrations, diagnostics: diagnostics, privacy: privacy }[view]()}</div>${footer()}</div></div></div>`;
  if (view === "transactions") {
    bindFilters();
    loadTransactions().catch((e) => message(e.message));
  }
  if (view === "integrations") bindIntegrations();
}
function paymentRows(payments) {
  return payments
    .map(
      (p) =>
        `<tr><td><strong>${esc(p.name)}</strong><small class="mono">${esc(p.id.slice(0, 12))}…</small></td><td>${esc(providers[p.profile] || p.profile)}</td><td class="money">${money(p.payable_amount)}</td><td>${badge(p.status)}${p.confirmation_source === "manual" ? '<div class="manual-label">Admin verified</div>' : ""}</td><td><small>${date(p.created_at)}</small></td><td>${button("payment", "View", "secondary small", p.id)}</td></tr>`,
    )
    .join("");
}
const paymentHead =
  "<thead><tr><th>Order</th><th>Account</th><th>Payable</th><th>Status</th><th>Created</th><th></th></tr></thead>";
function overview() {
  const s = state.summary || {},
    active = state.profiles.filter((p) => p.enabled),
    defaultAccount = state.profiles.find((p) => p.active);
  return `<div class="stats">${[
    [
      "Total collected",
      money(s.collected / 100),
      "Confirmed payments",
      "wallet",
    ],
    ["Paid orders", s.paid || 0, `${s.orders || 0} orders in total`, "check"],
    [
      "Awaiting payment",
      s.pending || 0,
      "Orders within the confirmation window",
      "transactions",
    ],
    [
      "Collected today",
      money(s.today_collected / 100),
      "Today · UTC",
      "overview",
    ],
  ]
    .map(
      ([label, value, note, i]) =>
        `<div class="stat"><div class="stat-label">${label}${icon(i)}</div><div class="stat-value">${value}</div><div class="stat-note ${i === "wallet" ? "positive" : ""}">${note}</div></div>`,
    )
    .join(
      "",
    )}</div>${!defaultAccount ? `<div class="tip">${icon("info")}<p>Add a business account and choose a default to start collecting payments. ${button("nav", "Manage accounts", "ghost small", "accounts")}</p></div>` : ""}<div class="grid overview-grid"><div><section class="card"><div class="card-head"><div><h2>Recent transactions</h2><p>Your latest payment activity</p></div>${button("nav", "View all " + icon("arrow"), "ghost small", "transactions")}</div>${state.payments.length ? `<div class="table-scroll"><table>${paymentHead}<tbody>${paymentRows(state.payments.slice(0, 6))}</tbody></table></div>` : empty("Your first payment starts here", "Create a link and share the exact payable total with your customer.", button("new-payment", "Create payment", "primary small"))}<div class="card-foot"><span>Confirmation comes from a matched notification or an admin review.</span></div></section><section class="card"><div class="card-head"><h2>Collection checklist</h2><span class="badge">Getting ready</span></div><div class="card-body"><div class="row between"><span>Receiving accounts</span><strong>${active.length} / 5 enabled</strong></div><p class="muted">Paytm · BharatPe · PhonePe · HDFC · Google Pay</p><div class="status-box"><strong>${defaultAccount ? "Default: " + esc(defaultAccount.label) : "Choose your default account"}</strong><p>${defaultAccount ? esc(defaultAccount.upi) : "Your default receives orders created without an account selection."}</p></div><div class="status-box"><strong>${state.devices.some((d) => d.enabled && d.last_seen > Date.now() - 180000) ? "A relay phone is connected" : "Connect your relay phone"}</strong><p>Enable each business app you use and keep notification access on.</p></div>${button("nav", "Manage connected phones " + icon("arrow"), "secondary small", "phones")}</div></section></div><div><section class="card"><div class="card-head"><h2>Business accounts</h2>${button("nav", icon("arrow"), "ghost small", "accounts")}</div><div class="card-body">${state.profiles.map((p) => `<div class="account-row">${logo(p.id)}<div class="account-info"><strong>${esc(p.label)}</strong><small>${esc(p.payee)}</small></div>${badge(p.active ? "default" : p.enabled ? "enabled" : "disabled")}</div>`).join("") || empty("No accounts added", "Connect your merchant UPI destination.")}</div></section><section class="card"><div class="card-head"><h2>Latest notifications</h2>${button("nav", icon("arrow"), "ghost small", "diagnostics")}</div><div class="card-body">${
    state.events
      .slice(0, 4)
      .map(
        (e) =>
          `<div class="activity"><div class="activity-icon">${icon(e.status === "matched" ? "check" : "diagnostics")}</div><div class="activity-main"><strong>${esc(providerForPackage(e.package))}</strong><p>${reasonText(e.reason, e.status)}</p><p>${date(e.received)}</p></div>${badge(e.status)}</div>`,
      )
      .join("") ||
    empty(
      "Waiting for activity",
      "Notifications will appear here after your phone sends them.",
    )
  }</div></section></div></div>`;
}
function transactions() {
  return `<section class="card"><div class="toolbar"><label class="search" aria-label="Search orders">${icon("search")}<input id="order-search" value="${esc(filter.search)}" placeholder="Search order name, ID or reference" aria-label="Search orders"></label><select id="order-status" aria-label="Filter by status"><option value="">All statuses</option>${["paid", "pending", "expired", "cancelled"].map((v) => `<option value="${v}" ${filter.status === v ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select><select id="order-account" aria-label="Filter by account"><option value="">All accounts</option>${Object.entries(
    providers,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${filter.profile === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select>${button("export", icon("download") + " Export page", "secondary small")}</div><div id="transaction-results">${empty("Loading transactions…")}</div></section>`;
}
function bindFilters() {
  let delay;
  document.getElementById("order-search").oninput = (e) => {
    filter.search = e.target.value;
    filter.page = 1;
    clearTimeout(delay);
    delay = setTimeout(
      () => loadTransactions().catch((e) => message(e.message)),
      250,
    );
  };
  for (const [id, key] of [
    ["order-status", "status"],
    ["order-account", "profile"],
  ])
    document.getElementById(id).onchange = (e) => {
      filter[key] = e.target.value;
      filter.page = 1;
      loadTransactions().catch((e) => message(e.message));
    };
}
async function loadTransactions() {
  const sequence = ++requestSequence;
  const result = await api("/admin/payments?" + new URLSearchParams(filter));
  if (view !== "transactions" || sequence !== requestSequence) return;
  transactionPage = result;
  document.getElementById("transaction-results").innerHTML =
    `${result.payments.length ? `<div class="table-scroll"><table>${paymentHead}<tbody>${paymentRows(result.payments)}</tbody></table></div>` : empty("No transactions found", "Try another filter or create your first payment.")}<div class="card-foot"><span>${result.total} matching orders · 25 per page</span><div class="pagination">${button("previous", "Previous", "secondary small")}<span>${result.page} / ${result.pages}</span>${button("next", "Next", "secondary small")}</div></div>`;
  document.querySelector("[data-action=previous]").disabled = result.page <= 1;
  document.querySelector("[data-action=next]").disabled =
    result.page >= result.pages;
}
function accounts() {
  return `<div class="tip">${icon("info")}<p>Add one receiving account per business app. Use the UPI ID from that account’s merchant QR, and monitor the same account on your paired phone. Disabling stops new orders; existing orders can still confirm.</p></div><div class="grid">${Object.keys(
    providers,
  )
    .map((id) => {
      const p = state.profiles.find((p) => p.id === id);
      return `<section class="card provider-card"><div class="provider-card-header">${logo(id)}<div class="account-info"><strong>${providers[id]}</strong><small>${p ? esc(p.label) : "Ready to connect"}</small></div>${badge(p ? (p.active ? "default" : p.enabled ? "enabled" : "disabled") : "not added")}</div>${p ? `<dl class="account-fields"><div><dt class="field-label">Merchant name</dt><dd>${esc(p.payee)}</dd></div><div><dt class="field-label">Receiving UPI ID</dt><dd>${esc(p.upi)}</dd></div><div><dt class="field-label">Open orders</dt><dd>${p.pending_orders || 0} within the confirmation window</dd></div></dl><div class="account-actions">${button("edit-account", "Edit", "secondary small", id)}${!p.active && p.enabled ? button("default-account", "Set default", "secondary small", id) : ""}${button("toggle-account", p.enabled ? "Disable" : "Enable", "secondary small", id)}${button("remove-account", "Remove", "danger small", id)}</div>` : `<p class="muted">Connect your ${providers[id]} receiving account to create payment links.</p>${button("add-account", icon("plus") + " Add account", "secondary", id)}`}</section>`;
    })
    .join("")}</div>`;
}
function safeHealth(d) {
  try {
    return JSON.parse(d.health || "{}");
  } catch {
    return {};
  }
}
function phones() {
  return `<div class="grid"><section class="card"><div class="card-head"><div><h2>Connect an Android phone</h2><p>FF Shop 1.7 · Android 8 or later</p></div>${icon("phones")}</div><div class="card-body"><ol class="step-list"><li>Install the Relay APK included in the final package.</li><li>Generate a pairing link and paste it in the Relay app within 5 minutes.</li><li>Allow notification access and select your receiving business apps.</li><li>Tap Start relay and keep the phone online.</li></ol>${button("pair", icon("plus") + " Create pairing link", "primary")}<div id="pairing"></div></div></section><section class="card"><div class="card-head"><h2>Phone health</h2></div><div class="card-body"><div class="tip"><p>Check the Relay inspector when a payment stays pending. Empty standard fields may use a custom layout; failed or ambiguous receipts need review.</p></div><p class="muted">A green heartbeat means the relay contacted the server. Confirm notification access and listener status separately.</p></div></section></div><div class="grid">${
    state.devices
      .map((d) => {
        const h = safeHealth(d),
          online = d.enabled && d.last_seen > Date.now() - 180000;
        return `<section class="card"><div class="card-head"><div class="row">${icon("phones")}<h2>${esc(d.name)}</h2></div>${badge(!d.enabled ? "revoked" : online ? "enabled" : "offline")}</div><div class="card-body"><div class="phone-health"><div><span>Last contact</span><strong>${d.last_seen ? date(d.last_seen) : "Awaiting heartbeat"}</strong></div><div><span>Notification access</span><strong>${h.notification_access === true ? "Allowed" : h.notification_access === false ? "Off" : "Not reported"}</strong></div><div><span>Listener</span><strong>${h.listener_connected === true ? "Connected" : h.listener_connected === false ? "Disconnected" : "Not reported"}</strong></div><div><span>Relay version</span><strong>${esc(h.app_version || "Not reported")}</strong></div><div><span>Queued notifications</span><strong>${esc(h.pending_count ?? "Not reported")}</strong></div><div><span>Failed captures / deliveries</span><strong>${esc(h.failed_count ?? "Not reported")}</strong></div><div><span>Battery optimization</span><strong>${h.battery_optimization_exempt === true ? "Unrestricted" : h.battery_optimization_exempt === false ? "Restricted" : "Not reported"}</strong></div><div><span>Background service</span><strong>${h.foreground_service === true ? "Running" : h.foreground_service === false ? "Stopped" : "Not reported"}</strong></div></div>${h.last_client_error ? `<div class="tip warning"><p>${esc(h.last_client_error)}</p></div>` : ""}${d.enabled ? button("revoke-phone", "Revoke phone", "danger small", d.id) : "<small>This phone can no longer submit events.</small>"}</div></section>`;
      })
      .join("") ||
    `<section class="card">${empty("No phones connected", "Create a pairing link to connect your merchant phone.")}</section>`
  }</div>`;
}
function integrations() {
  return `<section class="card"><div class="card-head"><h2>Your website &amp; payment return</h2><a href="/integration-guide.html">Step-by-step API guide ↗</a></div><div class="card-body"><form id="website"><label>Your website origin<input name="origin" type="url" placeholder="https://your-shop.com" value="${esc(state.website?.origin || "")}"><span class="help">Enter only the HTTPS domain. Orders may use a return_url on this domain. Leave blank to disable redirects.</span></label><button type="submit">Save website</button></form><p class="muted">After confirmation, checkout returns to your website. Your server must verify payment status using its secret API key before fulfilling the order.</p></div></section><div class="grid"><section class="card"><div class="card-head"><div><h2>Shop API keys</h2><p>Create orders securely from your shop server</p></div>${icon("integrations")}</div><div class="card-body"><form id="key"><label>Key name<input name="label" placeholder="My shop server" required maxlength="120"></label><button type="submit">Generate API key</button></form><div id="key-secret"></div>${state.keys.map((k) => `<div class="account-row"><div class="account-info"><strong>${esc(k.label)}</strong><small>${k.enabled ? "Active key" : "Revoked key"}</small></div>${k.enabled ? button("revoke-key", "Revoke", "danger small", k.id) : badge("revoked")}</div>`).join("")}</div></section><section class="card"><div class="card-head"><div><h2>Payment webhooks</h2><p>Signed updates with automatic retries</p></div>${icon("link")}</div><div class="card-body"><form id="webhook"><label>Your shop callback URL<input name="endpoint" type="url" value="${esc(state.webhook?.endpoint || "")}" placeholder="https://your-shop.com/payment-webhook"><span class="help">Leave empty to disable callbacks. Saving rotates the secret and cancels queued deliveries.</span></label><button type="submit">Save webhook</button></form><div id="webhook-secret"></div><p class="muted">Verify the callback HMAC and deduplicate the event before fulfilling an order.</p></div></section></div><section class="card"><div class="card-head"><h2>Webhook deliveries</h2><span class="muted">Latest 30</span></div>${state.deliveries.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Status</th><th>Attempts</th><th>HTTP result</th><th></th></tr></thead><tbody>${state.deliveries.map((d) => `<tr><td class="mono">${esc(d.payment_id)}</td><td>${badge(d.status)}</td><td>${d.attempts}</td><td>${d.last_status || "—"}</td><td>${d.status === "exhausted" ? button("retry-delivery", "Retry", "secondary small", d.id) : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("No callbacks yet", "Deliveries appear after a payment is confirmed with a webhook configured.")}</section><section class="card"><div class="card-head"><h2>Quick API reference</h2></div><div class="card-body"><p>Send your API key as <strong>Authorization: Bearer &lt;key&gt;</strong>. Create an order with a unique <strong>Idempotency-Key</strong>.</p><code>POST /api/v1/payments\n{"name":"Order 1001","amount":100,"external_id":"1001","profile":"paytm","return_url":"https://your-shop.com/payment/return"}\n\nGET /api/v1/payments/&lt;payment_id&gt;</code><small>Amount is a base amount in whole rupees. Return the checkout URL to your customer. Profile is optional; omitted profile uses the default account.</small></div></section>`;
}
function bindIntegrations() {
  form("website", async (b) => {
    await api("/admin/website", "POST", b);
    await dashboard();
    message("Website return settings saved.");
  });
  form("key", async (b) => {
    const result = await api("/admin/keys", "POST", b);
    state = await api("/admin/state");
    openModal(
      "Save your new API key",
      `<p>Shown once. Store it privately on your shop server.</p><code>${esc(result.secret)}</code>${button("copy-secret", "Copy key", "secondary", result.secret)}`,
    );
    renderShell();
  });
  form("webhook", async (b) => {
    const result = await api("/admin/webhook", "POST", b);
    state = await api("/admin/state");
    openModal(
      "Webhook settings saved",
      `<p>${b.endpoint ? "Save this signing secret privately. It applies to future deliveries." : "Callbacks disabled. Queued deliveries are cancelled. Requests already sent cannot be recalled."}</p>${b.endpoint ? `<code>${esc(result.secret)}</code>${button("copy-secret", "Copy secret", "secondary", result.secret)}` : ""}`,
    );
    renderShell();
  });
}
function providerForPackage(pkg) {
  return (
    {
      "com.paytm.business": "Paytm Business",
      "com.bharatpe.app": "BharatPe",
      "com.phonepe.app.business": "PhonePe Business",
      "com.hdfc.smarthub": "HDFC SmartHub Vyapar",
      "com.google.android.apps.nbu.paisa.merchant": "Google Pay Business",
    }[pkg] || pkg
  );
}
function reasonText(reason, status) {
  if (status === "matched") return "Matched the exact order amount";
  if (status === "corroborated") return "Order already confirmed";
  return esc(
    {
      bharatpe_unrecognized_list:
        "BharatPe list format or fields are ambiguous — review credit",
      bharatpe_baseline:
        "BharatPe baseline saved — create the next order after this capture",
      bharatpe_list_checked: "BharatPe list checked — individual results below",
      bharatpe_refresh_or_gap:
        "Refresh, old list or capture gap — baseline updated; review credit",
      bharatpe_old_or_ambiguous_row:
        "Existing row or unclear time — not used for a new order",
      bharatpe_row_checked:
        "No fresh order match, already-seen row or same-minute payment — review credit",
      no_amount: "No readable amount captured",
      multiple_amounts: "Multiple amounts — receipt needs review",
      negative_status: "Failed, refund or other non-credit alert",
      no_credit_wording: "Amount found without a received/credited message",
      unsupported_app: "Unsupported notification package",
      invalid_amount: "Unrecognized amount format",
      whole_or_invalid_amount: "Receipt is not an exact adjusted total",
      receipt_parsed: "Receipt parsed",
    }[reason] ||
      (status === "matched"
        ? "Matched the exact order amount"
        : status === "corroborated"
          ? "Order was already confirmed"
          : reason || "No diagnostic details in this older event"),
  );
}
function diagnostics() {
  return `<div class="tip warning">${icon("info")}<p>Notification matching uses the paired phone’s evidence. BharatPe lists use a baseline and fresh timestamped rows. First snapshots, refreshes, same-minute orders and ambiguous rows stay unconfirmed; check merchant history for those credits.</p></div><section class="card"><div class="card-head"><h2>Notification events</h2><span class="muted">Latest 50</span></div>${state.events.length ? `<div class="table-scroll"><table><thead><tr><th>Provider</th><th>Amount</th><th>Result</th><th>Details</th><th>Received</th><th></th></tr></thead><tbody>${state.events.map((e) => `<tr><td>${esc(providerForPackage(e.package))}</td><td class="money">${e.amount ? money(e.amount / 100) : "—"}</td><td>${badge(e.status)}</td><td class="diagnostic-reason">${reasonText(e.reason, e.status)}</td><td><small>${date(e.received)}</small></td><td>${e.payment_id ? button("payment", "View order", "secondary small", e.payment_id) : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("No notifications received", "Connect a phone, enable a business app and check its notification access.")}</section><section class="card"><div class="card-head"><h2>Admin confirmation history</h2></div>${state.reviews.length ? `<div class="table-scroll"><table><thead><tr><th>Order</th><th>Merchant reference</th><th>Confirmed</th><th></th></tr></thead><tbody>${state.reviews.map((r) => `<tr><td class="mono">${esc(r.payment_id)}</td><td>${esc(r.reference)}</td><td>${date(r.created)}</td><td>${button("payment", "View order", "secondary small", r.payment_id)}</td></tr>`).join("")}</tbody></table></div>` : empty("No manual confirmations", "Admin confirmations record the exact amount and merchant reference.")}</section>`;
}
function privacy() {
  return `<div class="privacy-intro"><div class="privacy-seal">${icon("privacy")}</div><div><div class="eyebrow">Owned by you</div><h2>Your data stays in your workspace</h2><p>No advertising SDK, analytics script or repository-owner callback is bundled. Your Cloudflare account hosts the app and database.</p></div></div><div class="grid"><section class="card"><div class="card-head"><h2>Data destinations</h2>${badge("private")}</div><div class="card-body"><dl class="account-fields"><div><dt class="field-label">Dashboard & paired relay</dt><dd>${esc(location.origin)}</dd></div><div><dt class="field-label">Merchant webhook · optional</dt><dd>${state.webhook?.endpoint ? esc(state.webhook.endpoint) : "Off — no payment callbacks configured"}</dd></div><div><dt class="field-label">Third-party analytics / owner callbacks</dt><dd>None in this build</dd></div></dl>${button("nav", "Manage callback destination", "secondary", "integrations")}<p class="help">Only configure an endpoint you own. Disabling or replacing it cancels queued deliveries; an in-flight request cannot be recalled.</p></div></section><section class="card"><div class="card-head"><h2>What gets stored</h2></div><div class="card-body"><ul class="privacy-list"><li>Orders, exact amounts, receiving UPI IDs and payment history in your D1 database.</li><li>Notification text is processed by your Worker. D1 keeps event hashes, amounts and matching results, not the raw notification body.</li><li>The phone clears notification bodies after delivery or permanent rejection. Pending evidence stays on the phone until delivery or disconnect.</li><li>Cloudflare, your phone OS and merchant/payment providers still process their normal service data. Restrict access to your hosting account.</li></ul><a href="/PRIVACY.md">Read the privacy audit ↗</a></div></section></div><section class="card"><div class="card-head"><div><h2>Deployment & provider checks</h2><p>Fix missing files, bindings and migrations before accepting payments.</p></div><a class="button secondary" href="/deployment-check.html">Deployment check ${icon("arrow")}</a></div><div class="card-body"><p>Paytm Business, PhonePe Business, HDFC SmartHub Vyapar, BharatPe and Google Pay Business use explicit notification opt-in. Google Pay Business capture is experimental until tested on your phone.</p><p class="muted">Bank-app UI screenshots and image-only notifications cannot establish a verified credit. Test a small exact-total payment for every enabled app and check Notification activity.</p><a href="/source.zip">Download this build’s source and licence</a></div></section>`;
}
function accountModal(id) {
  const p = state.profiles.find((p) => p.id === id),
    available = Object.keys(providers).filter(
      (k) => !state.profiles.some((p) => p.id === k),
    );
  if (!p && id && !available.includes(id)) return;
  if (!p && !available.length) {
    message(
      "All four business accounts are already added. Use Edit to update one.",
    );
    return;
  }
  openModal(
    p ? "Edit business account" : "Add business account",
    `<form id="account-form"><label>Business app<select name="id">${(p ? [p.id] : available).map((k) => `<option value="${k}" ${k === id ? "selected" : ""}>${providers[k]}</option>`).join("")}</select></label><label>Account label<input name="label" value="${esc(p?.label || "")}" placeholder="e.g. Main store" required maxlength="120"></label><label>Merchant name<input name="payee" value="${esc(p?.payee || "")}" placeholder="Name shown on your merchant QR" required maxlength="120"></label><label>Receiving UPI ID<input name="upi" value="${esc(p?.upi || "")}" placeholder="yourbusiness@bank" required maxlength="255"><span class="help">Copy the UPI ID from your merchant QR. Pending orders protect changes to this destination.</span></label><label class="checkbox"><input type="checkbox" name="active" ${p?.active || !state.profiles.some((p) => p.active) ? "checked" : ""}><span>Use as the default for new orders</span></label><div class="modal-actions">${button("close", "Cancel", "secondary")}<button type="submit">${p ? "Save changes" : "Add account"}</button></div></form>`,
  );
  form("account-form", async (b) => {
    await api("/admin/profiles", "POST", { ...b, active: b.active === "on" });
    closeModal();
    await dashboard();
    message("Business account saved.");
  });
}
function newPayment() {
  const enabled = state.profiles.filter((p) => p.enabled);
  if (!enabled.length) {
    view = "accounts";
    renderShell();
    accountModal();
    return;
  }
  openModal(
    "Create payment link",
    `<form id="order-form"><label>Order name<input name="name" placeholder="Order 1001" required maxlength="120"></label><div class="form-grid"><label>Base amount (₹)<input name="amount" type="number" min="1" max="100000" step="1" placeholder="100" required></label><label>Business account<select name="profile">${enabled.map((p) => `<option value="${p.id}" ${p.active ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label><label class="wide">Your order reference (optional)<input name="external_id" maxlength="120" placeholder="Your shop’s order ID"></label></div><div class="tip"><p>A unique ₹0.01–₹0.99 is added to the base amount. Your customer must pay the exact displayed total within 5 minutes. For BharatPe lists, refresh the merchant notification before creating an order and pay during the time shown on checkout.</p></div><div class="modal-actions">${button("close", "Cancel", "secondary")}<button type="submit">Create payment ${icon("arrow")}</button></div></form>`,
  );
  document.getElementById("order-form").addEventListener("input", () => {
    orderKey = crypto.randomUUID();
  });
  form("order-form", async (b) => {
    if (!b.external_id) delete b.external_id;
    const p = await api(
      "/admin/payments",
      "POST",
      { ...b, amount: Number(b.amount) },
      { "Idempotency-Key": orderKey },
    );
    orderKey = crypto.randomUUID();
    state = await api("/admin/state");
    renderShell();
    await paymentModal(p);
  });
}
async function paymentModal(payment) {
  const p =
    typeof payment === "string"
      ? await api("/admin/payments/" + encodeURIComponent(payment))
      : payment;
  openModal(
    "Payment details",
    `<div class="row between"><div><div class="muted">${esc(p.name)}</div><div class="amount">${money(p.payable_amount)}</div></div>${badge(p.status)}</div><div class="detail-list"><div><small>Business account</small><strong>${esc(providers[p.profile])}</strong></div><div><small>Base amount</small><strong>${money(p.requested_amount)}</strong></div><div><small>Created</small><strong>${date(p.created_at)}</strong></div><div><small>Pay before</small><strong>${date(p.expires_at)}</strong></div><div class="wide"><small>Receiving merchant</small><strong>${esc(p.payee)} · ${esc(p.upi)}</strong></div><div class="wide"><small>Order ID</small><strong class="mono">${esc(p.id)}</strong></div>${p.external_id ? `<div class="wide"><small>Shop reference</small><strong>${esc(p.external_id)}</strong></div>` : ""}${p.confirmation_source ? `<div class="wide"><small>Confirmation</small><strong>${p.confirmation_source === "manual" ? "Merchant history checked by admin" : "Matched merchant notification"} · ${date(p.paid_at)}</strong></div>` : ""}</div>${p.status === "pending" && Date.now() < Date.parse(p.expires_at) ? `<img class="qr" id="order-qr" alt="Exact-amount payment QR"><div class="copy-row"><code>${esc(p.checkout_url)}</code>${button("copy-link", "Copy", "secondary small", p.checkout_url)}</div><a class="button secondary" href="${esc(p.checkout_url)}" target="_blank" rel="noopener">Open checkout ${icon("arrow")}</a>` : ""}${p.status === "pending" ? bharatTiming(p) : ""}<div class="modal-actions">${["pending", "expired"].includes(p.status) ? button("review-payment", "Review credit", "secondary", p.id) : ""}${p.status === "pending" ? button("cancel-payment", "Cancel order", "danger", p.id) : ""}${button("close", "Close", "secondary")}</div>`,
  );
  await qr(p.upi_uri, "order-qr");
}
async function reviewPayment(id) {
  const p = await api("/admin/payments/" + encodeURIComponent(id));
  openModal(
    "Confirm a merchant credit",
    `<p>Order <strong>${esc(p.name)}</strong> · ${money(p.payable_amount)}</p><div class="tip warning"><p>Open ${esc(providers[p.profile])} transaction history and verify this exact credit to ${esc(p.upi)}. A screenshot or amount-only notification does not verify the credit.</p></div><form id="review-form"><label>Merchant transaction reference / UTR<input name="reference" required minlength="6" maxlength="80" pattern="[A-Za-z0-9_-]{6,80}" placeholder="Reference from merchant history"></label><label>Exact credited amount (₹)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="${esc(p.payable_amount)}"></label><label class="checkbox"><input type="checkbox" name="checked" required><span>I checked the merchant transaction history and confirmed this credit belongs to this order.</span></label><div class="modal-actions">${button("close", "Cancel", "secondary")}<button type="submit">Confirm received payment</button></div></form>`,
  );
  form("review-form", async (b) => {
    const amount = String(b.amount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
      throw new Error("Enter an exact amount with up to two decimal places.");
    const [rupees, paise = ""] = amount.split(".");
    const result = await api(
      "/admin/payments/" + encodeURIComponent(id) + "/confirm",
      "POST",
      {
        reference: b.reference,
        amount_paise: Number(rupees) * 100 + Number(paise.padEnd(2, "0")),
        checked: b.checked === "on",
      },
    );
    state = await api("/admin/state");
    renderShell();
    await paymentModal(result);
    message("Merchant credit confirmed and recorded.");
  });
}
function confirmAction(title, text, fn) {
  openModal(
    title,
    `<p>${esc(text)}</p><div class="modal-actions">${button("close", "Keep it", "secondary")}<button id="confirm-action" class="danger">Confirm</button></div>`,
  );
  document.getElementById("confirm-action").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await fn();
      closeModal();
      await dashboard();
    } catch (error) {
      message(error.message);
      e.target.disabled = false;
    }
  };
}
async function run(action, value) {
  switch (action) {
    case "close":
      closeModal();
      break;
    case "nav":
      view = value;
      requestSequence++;
      renderShell();
      break;
    case "refresh":
      await dashboard();
      message("Workspace updated.");
      break;
    case "logout":
      await api("/admin/session", "DELETE");
      login();
      break;
    case "new-payment":
      newPayment();
      break;
    case "add-account":
    case "edit-account":
      accountModal(value);
      break;
    case "default-account":
      await api("/admin/profiles/" + value + "/default", "POST", {});
      await dashboard();
      break;
    case "toggle-account": {
      const p = state.profiles.find((p) => p.id === value);
      await api("/admin/profiles/" + value + "/enabled", "POST", {
        enabled: !p.enabled,
      });
      await dashboard();
      break;
    }
    case "remove-account":
      confirmAction(
        "Remove business account?",
        "This removes the account from your workspace and stops new orders. Existing order history is retained. Pending orders must be cancelled or finished first.",
        () => api("/admin/profiles/" + value, "DELETE"),
      );
      break;
    case "revoke-phone":
      confirmAction(
        "Revoke this phone?",
        "This phone will no longer be allowed to submit payment evidence.",
        () => api("/admin/devices/" + value, "DELETE"),
      );
      break;
    case "revoke-key":
      confirmAction(
        "Revoke this API key?",
        "Your shop will need a different active key to create new payments.",
        () => api("/admin/keys/" + value, "DELETE"),
      );
      break;
    case "retry-delivery":
      await api("/admin/deliveries/" + value, "POST", {});
      await dashboard();
      message("Callback queued for retry.");
      break;
    case "pair": {
      const p = await api("/admin/pair", "POST", {});
      openModal(
        "Connect your relay phone",
        `<p>Paste the complete link into FFSHOP Relay within 5 minutes. Keep this link private.</p><code>${esc(p.pairing_url)}</code>${button("copy-link", "Copy pairing link", "secondary", p.pairing_url)}`,
      );
      break;
    }
    case "copy-link":
    case "copy-secret":
      await navigator.clipboard.writeText(value);
      message("Copied.");
      break;
    case "payment":
      await paymentModal(value);
      break;
    case "review-payment":
      await reviewPayment(value);
      break;
    case "cancel-payment":
      confirmAction(
        "Cancel this order?",
        "The checkout will stop accepting payment. Check the merchant history if the customer already paid.",
        () => api("/admin/cancel/" + value, "POST", {}),
      );
      break;
    case "previous":
      filter.page = Math.max(1, filter.page - 1);
      await loadTransactions();
      break;
    case "next":
      filter.page++;
      await loadTransactions();
      break;
    case "export": {
      if (!transactionPage?.payments.length) {
        message("No transactions on this page to export.");
        break;
      }
      const cell = (v) => {
        let s = String(v ?? "");
        if (/^(?:[\t\r]|\s*[=+\-@])/.test(s)) s = "'" + s;
        return '"' + s.replaceAll('"', '""') + '"';
      };
      const lines = [
        [
          "Order ID",
          "Name",
          "Provider",
          "Base amount",
          "Payable amount",
          "Status",
          "Created at",
          "Paid at",
          "Confirmation",
          "Shop reference",
        ],
        ...transactionPage.payments.map((p) => [
          p.id,
          p.name,
          p.profile,
          p.requested_amount,
          p.payable_amount,
          p.status,
          p.created_at,
          p.paid_at,
          p.confirmation_source,
          p.external_id,
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n")],
          { type: "text/csv;charset=utf-8" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "ffshop-transactions-page-" + transactionPage.page + ".csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
  }
}
for (const host of [root, modal])
  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.disabled) return;
    try {
      await run(b.dataset.action, b.dataset.value || "");
    } catch (error) {
      if (error.status === 401) login();
      message(error.message);
    }
  });
modal.addEventListener("close", () => {
  if (!modal.open) modal.innerHTML = "";
});
function bharatTiming(p) {
  if (p.profile !== "bharatpe") return "";
  const start = new Date(
    (Math.floor(Date.parse(p.created_at) / 60000) + 1) * 60000,
  );
  const end = new Date(Math.floor(Date.parse(p.expires_at) / 60000) * 60000);
  const clock = (d) =>
    d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `<div class="tip warning"><p>BharatPe list matching: pay from <strong>${esc(clock(start))} to before ${esc(clock(end))} IST</strong>. Paying in the order’s creation minute may need merchant review. If already paid, do not pay again.</p></div>`;
}
async function checkout() {
  const id = encodeURIComponent(location.pathname.split("/").pop());
  let p;
  try {
    p = await api("/api/checkout/" + id);
  } catch (error) {
    root.innerHTML = `<div class="checkout-shell"><div class="brand">FF<span>SHOP</span></div><section class="card checkout-card"><h1>Payment unavailable</h1><p>${esc(error.message)}</p></section></div>`;
    return;
  }
  root.innerHTML = `<div class="checkout-shell"><div class="brand">FF<span>SHOP</span></div><section class="card checkout-card"><span class="badge">Secure UPI checkout</span><h1 id="payment-state">Pay your order</h1><div id="payment-method"><div class="amount">${money(p.payable_amount)}</div><p class="muted">Pay the exact amount, including paise.</p>${bharatTiming(p)}<img id="qr" class="qr" alt="Merchant UPI payment QR"><strong>${esc(p.payee)}</strong><p class="muted">${esc(p.upi)}</p><a class="button" href="${esc(p.upi_uri)}">Open UPI app ${icon("arrow")}</a><p class="muted">Or scan the QR from another phone.</p><small>Base ${money(p.requested_amount)} + unique amount ${money(Number(p.payable_amount) - Number(p.requested_amount))}</small></div><div class="progress-line"><span></span></div><p id="status-detail"></p><small>Order ${esc(p.id)}</small></section><div class="checkout-footer">Status updates automatically. Contact the shop for an unconfirmed credit.<br><a href="/source.zip">Source &amp; license</a></div></div>`;
  await qr(p.upi_uri, "qr");
  let finished = false,
    redirectStarted = false;
  function update(s) {
    const expired = Date.now() >= Date.parse(s.expires_at);
    document.getElementById("payment-method").hidden =
      s.status !== "pending" || expired;
    document.getElementById("payment-state").textContent =
      s.status === "paid"
        ? "Payment confirmed"
        : s.status === "pending"
          ? expired
            ? "Checking for confirmation"
            : "Waiting for payment"
          : s.status === "cancelled"
            ? "Payment cancelled"
            : "Payment expired";
    document.getElementById("status-detail").textContent =
      s.status === "paid"
        ? "The merchant has confirmed your payment."
        : expired
          ? "Do not pay this QR now. If already paid, contact the shop before paying again."
          : `Pay before ${new Date(s.expires_at).toLocaleTimeString()}`;
    if (s.status === "paid" && s.return_url && !redirectStarted) {
      const target = new URL(s.return_url);
      if (
        target.protocol === "https:" &&
        !target.username &&
        !target.password
      ) {
        redirectStarted = true;
        const link = document.createElement("a");
        link.href = target.href;
        link.className = "button secondary";
        link.textContent = "Return to website";
        document.getElementById("status-detail").textContent =
          "Payment confirmed. Returning to your website…";
        document.getElementById("status-detail").after(link);
        setTimeout(() => location.replace(target.href), 1500);
      }
    }
    if (["paid", "expired", "cancelled"].includes(s.status)) {
      finished = true;
      clearInterval(timer);
    }
  }
  update(p);
  if (!finished)
    timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        p = await api("/api/checkout/" + id);
        update(p);
      } catch {
        document.getElementById("status-detail").textContent =
          "Connection interrupted. Do not pay again; check with the shop.";
      }
    }, 10000);
}
(location.pathname.startsWith("/pay/") ? checkout() : dashboard()).catch(
  (error) => {
    message(error.message);
    root.innerHTML = `<div class="loading-screen"><h1>Unable to open the workspace</h1><p>${esc(error.message)}</p><p>Check your deployment settings and database upgrade.</p><p><a href="/deployment-check.html">Open deployment check →</a></p><button data-action="refresh">Try again</button></div>`;
  },
);

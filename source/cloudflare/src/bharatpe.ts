import { Env, sha, sql, one, fail } from "./core";

// BharatPe's custom list has no transaction ID/date/seconds. A first snapshot
// only establishes a baseline. Only strictly prepended rows can become evidence.
export function bharatPeList(
  e: any,
): { amount: number; minute: number; key: string }[] | null {
  if (
    e.package_name !== "com.bharatpe.app" ||
    (e.title || "").trim() ||
    (e.text || "").trim()
  )
    return null;
  const lines = (e.big_text || "")
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((s: string) => s.trim())
    .filter(Boolean);
  if (
    lines.pop() !== "Refresh" ||
    lines.pop() !== "Close" ||
    !lines.length ||
    lines.length % 3 ||
    lines.length > 30
  )
    return null;
  const day =
    Math.floor((e.posted_at_ms + 19800000) / 86400000) * 86400000 - 19800000;
  const result: { amount: number; minute: number; key: string }[] = [];
  for (let i = 0; i < lines.length; i += 3) {
    const time = /^(0?[1-9]|1[0-2]):([0-5]\d)\s+(AM|PM)$/i.exec(lines[i]);
    const name = lines[i + 1];
    const money = /^₹\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(lines[i + 2]);
    if (
      !time ||
      !money ||
      !/^[\p{L}\p{M} .'-]{1,120}$/u.test(name) ||
      !/\p{L}/u.test(name) ||
      /\b(refund|settlement|failed|pending|reversed|cashback|reward|debited|sent|request|cancelled)\b/i.test(
        name,
      )
    )
      return null;
    const clockMinute =
      ((Number(time[1]) % 12) + (time[3].toUpperCase() === "PM" ? 12 : 0)) *
        60 +
      Number(time[2]);
    let minute = day + clockMinute * 60000;
    if (minute > e.posted_at_ms) minute -= 86400000;
    const amount =
      Number(money[1]) * 100 + Number((money[2] || "").padEnd(2, "0"));
    if (
      amount <= 0 ||
      (result.length && minute > result[result.length - 1].minute)
    )
      return null;
    // Intentionally omit the inferred day: yesterday's identical row must never
    // be reinterpreted as a fresh credit when a notification is refreshed.
    const key = JSON.stringify([
      clockMinute,
      name.replace(/\s+/g, " ").toLowerCase(),
      amount,
    ]);
    if (result.some((r) => r.key === key)) return null;
    result.push({ amount, minute, key });
  }
  return result;
}

export async function ingestBharatPeList(
  env: Env,
  device: any,
  event: any,
  eventId: string,
  hash: string,
  list: NonNullable<ReturnType<typeof bharatPeList>>,
) {
  const fingerprints = await Promise.all(
    list.map((r) => sha("bharatpe-row\n" + r.key)),
  );
  const rowIds = await Promise.all(
    list.map((_, i) => sha(eventId + ":row:" + i)),
  );
  const respond = async (duplicate: boolean) => {
    const stored = await one(env, "SELECT * FROM events WHERE id=?", eventId);
    if (!stored) return null;
    if (stored.hash !== hash)
      fail(409, "event_conflict", "Event ID reused with different content");
    const matched = await one(
      env,
      `SELECT COUNT(*) AS n FROM events WHERE id IN (${rowIds.map(() => "?").join(",")}) AND status='matched'`,
      ...rowIds,
    );
    return {
      event_id: event.event_id,
      relay_event_id: eventId,
      status: stored.status,
      duplicate,
      transitioned: !duplicate && matched.n > 0,
    };
  };
  const replay = await respond(true);
  if (replay) return replay;
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const previous = await one(
      env,
      "SELECT * FROM bharatpe_snapshots WHERE device_id=?",
      device.id,
    );
    const previousRows: string[] = previous ? JSON.parse(previous.rows) : [];
    const added = previousRows.length
      ? fingerprints.indexOf(previousRows[0])
      : -1;
    const contiguous =
      added > 0 &&
      fingerprints.slice(added).every((key, i) => previousRows[i] === key);
    const fresh =
      previous &&
      previous.received >= now - 600000 &&
      previous.posted < event.posted_at_ms &&
      event.posted_at_ms >= now - 90000 &&
      event.posted_at_ms <= now;
    const eligible = !!(contiguous && fresh);
    const reason = !previous
      ? "bharatpe_baseline"
      : eligible
        ? "bharatpe_list_checked"
        : "bharatpe_refresh_or_gap";
    // Compare-and-swap the baseline in the same D1 transaction as all evidence.
    // A concurrent request that changes it causes a reread, never a stale match.
    const guard =
      "COALESCE((SELECT event_id FROM bharatpe_snapshots WHERE device_id=?),'')=?";
    const guardArgs = [device.id, previous?.event_id || ""];
    const auth =
      "EXISTS(SELECT 1 FROM devices WHERE id=? AND enabled=1 AND epoch=?)";
    const rootGuard =
      "EXISTS(SELECT 1 FROM events WHERE id=? AND hash=? AND received=?)";
    const statements = [
      sql(
        env,
        `INSERT OR IGNORE INTO events(id,device_id,source_id,hash,package,profile,posted,received,reason,status) SELECT ?,?,?,?,?,?,?,?,?, 'processed' WHERE ${guard} AND ${auth}`,
        eventId,
        device.id,
        event.event_id,
        hash,
        event.package_name,
        "bharatpe",
        event.posted_at_ms,
        now,
        reason,
        ...guardArgs,
        device.id,
        device.epoch,
      ),
    ];
    for (let index = 0; index < list.length; index++) {
      const row = list[index],
        fingerprint = fingerprints[index];
      const rowId = rowIds[index];
      const candidate =
        eligible &&
        index < added &&
        row.amount % 100 !== 0 &&
        row.minute >= now - 120000;
      statements.push(
        sql(
          env,
          `INSERT OR IGNORE INTO bharatpe_rows(id,first_event,received) SELECT ?,?,? WHERE ${guard} AND ${rootGuard}`,
          fingerprint,
          eventId,
          now,
          ...guardArgs,
          eventId,
          hash,
          now,
        ),
      );
      statements.push(
        sql(
          env,
          `INSERT OR IGNORE INTO events(id,device_id,source_id,hash,package,profile,amount,posted,received,reason,status,payment_id)
         SELECT ?,?,?,?,?,?,?,?,?,?,'ignored',
           (SELECT p.id FROM payments p JOIN slots s ON s.payment_id=p.id
            WHERE ?=1 AND p.profile='bharatpe' AND p.payable=? AND s.amount=p.payable
            AND p.created>=? AND p.created<=? AND ?<=p.expires AND ?<=p.expires
            AND ?<=p.grace AND s.until>? AND p.status='pending'
            AND EXISTS(SELECT 1 FROM bharatpe_rows WHERE id=? AND first_event=?))
         WHERE ${guard} AND ${rootGuard}`,
          rowId,
          device.id,
          event.event_id + ":row:" + index,
          fingerprint,
          event.package_name,
          "bharatpe",
          row.amount,
          row.minute,
          now,
          candidate
            ? "bharatpe_row_checked"
            : reason === "bharatpe_baseline"
              ? reason
              : "bharatpe_old_or_ambiguous_row",
          candidate ? 1 : 0,
          row.amount,
          previous?.received ?? now,
          row.minute,
          row.minute + 59999,
          event.posted_at_ms,
          now,
          now,
          fingerprint,
          eventId,
          ...guardArgs,
          eventId,
          hash,
          now,
        ),
      );
    }
    statements.push(
      sql(
        env,
        `INSERT INTO bharatpe_snapshots(device_id,event_id,rows,posted,received) SELECT ?,?,?,?,? WHERE ${guard} AND ${rootGuard}
       ON CONFLICT(device_id) DO UPDATE SET event_id=excluded.event_id,rows=excluded.rows,posted=excluded.posted,received=excluded.received WHERE excluded.posted>bharatpe_snapshots.posted`,
        device.id,
        eventId,
        JSON.stringify(fingerprints),
        event.posted_at_ms,
        now,
        ...guardArgs,
        eventId,
        hash,
        now,
      ),
    );
    const results = await env.DB.batch(statements);
    const response = await respond(results[0].meta.changes === 0);
    if (response) return response;
    const active = await one(
      env,
      "SELECT id FROM devices WHERE id=? AND enabled=1 AND epoch=?",
      device.id,
      device.epoch,
    );
    if (!active) fail(401, "unknown_relay_device", "Phone has been revoked");
  }
  fail(503, "snapshot_busy", "Notification baseline changed; retry this event");
}

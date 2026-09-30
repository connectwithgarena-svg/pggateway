import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["src/bharatpe.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { bharatPeList } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const fixture = {
  package_name: "com.bharatpe.app",
  title: "",
  text: "",
  posted_at_ms: Date.parse("2026-09-30T06:44:27Z"),
  big_text:
    "12:14 PM\nTest Customer\n₹6.79\n12:12 PM\nTest Customer\n₹4.61\n12:10 PM\nTest Customer\n₹4.61\nClose\nRefresh",
};
test("BharatPe supplied three-row format preserves separate times and repeated amounts", () => {
  const parsed = bharatPeList(fixture);
  assert.deepEqual(
    parsed.map((p) => p.amount),
    [679, 461, 461],
  );
  assert.deepEqual(
    parsed.map((p) => p.minute),
    [
      Date.parse("2026-09-30T06:44Z"),
      Date.parse("2026-09-30T06:42Z"),
      Date.parse("2026-09-30T06:40Z"),
    ],
  );
  assert.equal(new Set(parsed.map((p) => p.key)).size, 3);
  assert.deepEqual(
    bharatPeList({
      ...fixture,
      posted_at_ms: fixture.posted_at_ms + 86400000,
    }).map((p) => p.key),
    parsed.map((p) => p.key),
  );
});
test("BharatPe midnight uses previous day for old rows; future clock and malformed lists cannot look fresh", () => {
  const parsed = bharatPeList({
    ...fixture,
    posted_at_ms: Date.parse("2026-09-30T18:30:20Z"),
    big_text:
      "12:00 AM\nTest Customer\n₹6.79\n11:59 PM\nTest Customer\n₹4.61\nClose\nRefresh",
  });
  assert.equal(parsed[0].minute, Date.parse("2026-09-30T18:30Z"));
  assert.equal(parsed[1].minute, Date.parse("2026-09-30T18:29Z"));
  const future = bharatPeList({
    ...fixture,
    big_text: fixture.big_text.replace("12:14 PM", "12:15 PM"),
  });
  assert.equal(future, null); // out of chronological order after mapping future time to yesterday
  for (const change of [
    { package_name: "com.phonepe.app.business" },
    { text: "Payment failed" },
    { big_text: fixture.big_text.replace("12:12 PM", "12:10 PM") },
    { big_text: fixture.big_text.replace("₹6.79", "₹6.791") },
    { big_text: fixture.big_text.replace("12:14 PM", "24:14 PM") },
    { big_text: fixture.big_text + "\nPending" },
  ])
    assert.equal(bharatPeList({ ...fixture, ...change }), null);
});

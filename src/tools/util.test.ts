import { test } from "node:test";
import assert from "node:assert/strict";
import { DESTRUCTIVE, fail, hostId, isoDate, ok, READ_ONLY, WRITE } from "./util.js";

test("isoDate accepts a bare date and a full timestamp, rejects junk", () => {
  const d = isoDate(); // factory → fresh schema
  assert.equal(d.safeParse("2026-08-01").success, true);
  assert.equal(d.safeParse("2026-08-01T00:00:00Z").success, true);
  assert.equal(d.safeParse("2026-08-01T12:30:00.000+03:00").success, true);
  assert.equal(d.safeParse("01.08.2026").success, false);
  assert.equal(d.safeParse("today").success, false);
});

test("isoDate and hostId are factories returning independent schemas", () => {
  assert.notEqual(isoDate(), isoDate());
  assert.notEqual(hostId(), hostId());
});

test("hostId is optional (the env default can supply it) but rejects the empty string", () => {
  const h = hostId();
  assert.equal(h.safeParse(undefined).success, true);
  assert.equal(h.safeParse("https:example.com:443").success, true);
  assert.equal(h.safeParse("").success, false);
});

test("ok emits compact JSON; fail flags isError", () => {
  assert.equal((ok({ a: 1 }).content[0] as { text: string }).text, '{"a":1}');
  const f = fail(new Error("boom"));
  assert.equal(f.isError, true);
  assert.match((f.content[0] as { text: string }).text, /boom/);
});

test("fail appends the underlying cause when present", () => {
  const err = new Error("timeout", { cause: new Error("ECONNRESET") });
  const f = fail(err);
  assert.match((f.content[0] as { text: string }).text, /timeout \(ECONNRESET\)/);
});

test("the annotation constants set all four hints", () => {
  assert.deepEqual(READ_ONLY, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(WRITE, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  assert.deepEqual(DESTRUCTIVE, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});

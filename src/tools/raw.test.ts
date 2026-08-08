import { test } from "node:test";
import assert from "node:assert/strict";
import { WebmasterClient } from "../client.js";
import { registerRawTool } from "./raw.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const BASE = "https://api.webmaster.yandex.net/v4";

/** Registers raw_request against a real client with a recording fetch stub. */
function harness() {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as { method: string; body?: string };
    calls.push({ url: String(url), method: i.method, body: i.body ? JSON.parse(i.body) : undefined });
    if (/\/v4\/user$/.test(String(url))) {
      return new Response(JSON.stringify({ user_id: 7 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const client = new WebmasterClient({ token: "TKN", apiBase: BASE, maxRetries: 0, retryBaseMs: 0 });
  const tools: Record<string, Handler> = {};
  const server = { registerTool: (name: string, _cfg: unknown, h: Handler) => { tools[name] = h; } };
  registerRawTool(server as never, client);
  return { tools, calls, restore: () => { globalThis.fetch = original; } };
}

test("raw_request defaults to GET and hits the given path", async () => {
  const { tools, calls, restore } = harness();
  try {
    const res = await tools.raw_request({ path: "user" });
    assert.equal(res.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, `${BASE}/user`);
    assert.equal(calls[0].body, undefined);
  } finally {
    restore();
  }
});

test("raw_request substitutes {user-id} via the cached user id", async () => {
  const { tools, calls, restore } = harness();
  try {
    await tools.raw_request({ path: "user/{user-id}/hosts" });
    // First call resolves GET /user, second hits the substituted path.
    assert.equal(calls[0].url, `${BASE}/user`);
    assert.equal(calls[1].url, `${BASE}/user/7/hosts`);
  } finally {
    restore();
  }
});

test("raw_request POSTs a JSON body verbatim", async () => {
  const { tools, calls, restore } = harness();
  try {
    await tools.raw_request({ path: "user/7/hosts", method: "POST", body: { host_url: "https://a.ru" } });
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body, { host_url: "https://a.ru" });
  } finally {
    restore();
  }
});

test("raw_request rejects an absolute path as an isError result, without fetching", async () => {
  for (const evil of ["https://evil.example/steal", "http://evil.example/x", "\\\\evil.example/x"]) {
    const { tools, calls, restore } = harness();
    try {
      const res = await tools.raw_request({ path: evil });
      assert.equal(res.isError, true, `${JSON.stringify(evil)} should be isError`);
      assert.match(res.content[0].text, /foreign origin/);
      assert.equal(calls.length, 0, `must not fetch for ${JSON.stringify(evil)}`);
    } finally {
      restore();
    }
  }
});

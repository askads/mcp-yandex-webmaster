import { test } from "node:test";
import assert from "node:assert/strict";
import { WebmasterClient } from "./client.js";
import { CredentialsError, MISSING_TOKEN_MESSAGE } from "./config.js";
import type { WebmasterConfig } from "./types.js";

const BASE = "https://api.webmaster.yandex.net/v4";
const HOST = "https:example.com:443";
const HOST_ENC = encodeURIComponent(HOST);

type Call = {
  url: string;
  method: string;
  auth: unknown;
  contentType: unknown;
  body: Record<string, unknown> | undefined;
};

/**
 * Installs a recording fetch stub and returns a client + the captured calls.
 * GET /v4/user answers { user_id: 7 } so user-id auto-detection works; every
 * other path answers { ok: true }.
 */
function harness(extra: Partial<WebmasterConfig> = {}) {
  const calls: Call[] = [];
  const config: WebmasterConfig = {
    token: "TKN",
    apiBase: BASE,
    maxRetries: 0,
    retryBaseMs: 0,
    ...extra,
  };

  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({
      url: String(url),
      method: init.method,
      auth: init.headers.Authorization,
      contentType: init.headers["Content-Type"],
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    if (/\/v4\/user$/.test(String(url))) {
      return new Response(JSON.stringify({ user_id: 7 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  return { client: new WebmasterClient(config), calls, restore: () => { globalThis.fetch = orig; } };
}

test("user(): GET /v4/user with OAuth auth and no Content-Type", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.user();
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].auth, "OAuth TKN");
  assert.equal(calls[0].contentType, undefined);
  assert.equal(calls[0].body, undefined);
});

test("listSites resolves the user id once and caches it across calls", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.listSites();
    await client.listSites();
  } finally {
    restore();
  }
  const userCalls = calls.filter((c) => c.url === `${BASE}/user`);
  assert.equal(userCalls.length, 1, "GET /user must be fetched once and cached");
  assert.equal(calls[1].url, `${BASE}/user/7/hosts`);
  assert.equal(calls[2].url, `${BASE}/user/7/hosts`);
});

test("a configured YANDEX_USER_ID skips the GET /user roundtrip", async () => {
  const { client, calls, restore } = harness({ userId: 42 });
  try {
    await client.listSites();
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/user/42/hosts`);
});

test("a failed user-id fetch is not cached", async () => {
  let userCalls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    if (/\/v4\/user$/.test(String(url))) {
      userCalls++;
      if (userCalls === 1) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ user_id: 7 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new WebmasterClient({ token: "T", apiBase: BASE, maxRetries: 0, retryBaseMs: 0 });
    await assert.rejects(() => client.listSites(), /HTTP 500/);
    await client.listSites(); // refetches the id after the failure
    assert.equal(userCalls, 2);
  } finally {
    globalThis.fetch = orig;
  }
});

test("addSite: POST /user/{uid}/hosts with a host_url body", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.addSite({ hostUrl: "https://example.com" });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user/7/hosts`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].contentType, "application/json");
  assert.deepEqual(calls[0].body, { host_url: "https://example.com" });
});

test("siteSummary URL-encodes the host id from the call", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.siteSummary({ hostId: HOST });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user/7/hosts/${HOST_ENC}/summary`);
});

test("the config's default host id is used when the call omits one", async () => {
  const { client, calls, restore } = harness({ userId: 7, hostId: "http:default.ru:80" });
  try {
    await client.siteDiagnostics({});
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user/7/hosts/${encodeURIComponent("http:default.ru:80")}/diagnostics`);
});

test("a missing host id fails fast without a single fetch", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await assert.rejects(() => client.siteSummary({}), /host_id is required/);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("startVerification: POST with verification_type=DNS in the query and no body", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.startVerification({ hostId: HOST, verificationType: "dns" });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user/7/hosts/${HOST_ENC}/verification?verification_type=DNS`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].contentType, undefined);
});

test("popularQueries maps the wire query: order, repeated indicators, device, dates, paging", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.popularQueries({
      hostId: HOST,
      orderBy: "total_shows",
      queryIndicators: ["total_shows", "avg_show_position"],
      deviceTypeIndicator: "mobile",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-07",
      offset: 500,
      limit: 500,
    });
  } finally {
    restore();
  }
  assert.equal(
    calls[0].url,
    `${BASE}/user/7/hosts/${HOST_ENC}/search-queries/popular` +
      "?order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&query_indicator=AVG_SHOW_POSITION" +
      "&device_type_indicator=MOBILE&date_from=2026-08-01&date_to=2026-08-07&offset=500&limit=500",
  );
  assert.equal(calls[0].method, "GET");
});

test("searchQueriesHistory hits /search-queries/all/history and drops undefined params", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.searchQueriesHistory({ hostId: HOST, queryIndicators: ["total_clicks"] });
  } finally {
    restore();
  }
  assert.equal(
    calls[0].url,
    `${BASE}/user/7/hosts/${HOST_ENC}/search-queries/all/history?query_indicator=TOTAL_CLICKS`,
  );
});

test("listSitemaps passes the cursor pagination params", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.listSitemaps({ hostId: HOST, parentId: "c7-fe:80-c0", limit: 100, from: "c7-fe:80-c1" });
  } finally {
    restore();
  }
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, `/v4/user/7/hosts/${HOST_ENC}/sitemaps`);
  assert.equal(url.searchParams.get("parent_id"), "c7-fe:80-c0");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("from"), "c7-fe:80-c1");
});

test("addSitemap and recrawlUrl POST their url bodies to the right paths", async () => {
  const { client, calls, restore } = harness({ userId: 7 });
  try {
    await client.addSitemap({ hostId: HOST, url: "https://example.com/sitemap.xml" });
    await client.recrawlUrl({ hostId: HOST, url: "https://example.com/page" });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/user/7/hosts/${HOST_ENC}/user-added-sitemaps`);
  assert.deepEqual(calls[0].body, { url: "https://example.com/sitemap.xml" });
  assert.equal(calls[1].url, `${BASE}/user/7/hosts/${HOST_ENC}/recrawl/queue`);
  assert.deepEqual(calls[1].body, { url: "https://example.com/page" });
});

test("read endpoints build their documented paths", async () => {
  const { client, calls, restore } = harness({ userId: 7, hostId: HOST });
  try {
    await client.indexingHistory({ dateFrom: "2026-08-01", dateTo: "2026-08-07" });
    await client.externalLinks({ offset: 10, limit: 100 });
    await client.importantUrls({});
    await client.verificationStatus({});
  } finally {
    restore();
  }
  assert.equal(
    calls[0].url,
    `${BASE}/user/7/hosts/${HOST_ENC}/indexing/history?date_from=2026-08-01&date_to=2026-08-07`,
  );
  assert.equal(calls[1].url, `${BASE}/user/7/hosts/${HOST_ENC}/links/external/samples?offset=10&limit=100`);
  assert.equal(calls[2].url, `${BASE}/user/7/hosts/${HOST_ENC}/important-urls`);
  assert.equal(calls[3].url, `${BASE}/user/7/hosts/${HOST_ENC}/verification`);
});

test("non-2xx throws WebmasterError with the error_code and a follow-up hint", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error_code: "HOST_NOT_VERIFIED", error_message: "Host is not verified" }),
      { status: 404 },
    )) as typeof fetch;
  const client = new WebmasterClient({ token: "T", userId: 7, apiBase: BASE, maxRetries: 0 });
  try {
    await assert.rejects(
      () => client.siteSummary({ hostId: HOST }),
      /HTTP 404: \[HOST_NOT_VERIFIED\] Host is not verified — подтвердите права/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

test("INVALID_USER_ID surfaces the available_user_id from the body", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ error_code: "INVALID_USER_ID", error_message: "Invalid user id", available_user_id: 123 }),
      { status: 403 },
    )) as typeof fetch;
  const client = new WebmasterClient({ token: "T", userId: 7, apiBase: BASE, maxRetries: 0 });
  try {
    await assert.rejects(() => client.listSites(), /available_user_id: 123/);
  } finally {
    globalThis.fetch = orig;
  }
});

// --- Retry / timeout / SSRF behavior ---

function makeClient(overrides: Partial<WebmasterConfig> = {}) {
  return new WebmasterClient({
    token: "T",
    userId: 7,
    hostId: HOST,
    apiBase: BASE,
    retryBaseMs: 0, // no real backoff delay in tests
    ...overrides,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: String(url), init: i });
    return handler(String(url), i);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("request() retries a 429 rate limit — even for a write — then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ task_id: "t" }), { status: 202 });
  });
  try {
    const result = await makeClient().recrawlUrl({ url: "https://example.com/p" });
    assert.deepEqual(result, { task_id: "t" });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() never retries a 429 QUOTA_EXCEEDED (a daily quota) and surfaces the hint", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response(
      JSON.stringify({ error_code: "QUOTA_EXCEEDED", error_message: "Daily quota exceeded" }),
      { status: 429 },
    );
  });
  try {
    await assert.rejects(
      () => makeClient({ maxRetries: 3 }).recrawlUrl({ url: "https://example.com/p" }),
      /HTTP 429: \[QUOTA_EXCEEDED\].*суточная квота/,
    );
    assert.equal(calls, 1, "backoff cannot refill a daily quota — must not retry");
  } finally {
    mock.restore();
  }
});

test("request() retries a 5xx for GET then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().siteSummary({});
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() never retries a 5xx for a write (the write may have committed)", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("bad gateway", { status: 502 });
  });
  try {
    await assert.rejects(() => makeClient().recrawlUrl({ url: "https://example.com/p" }), /HTTP 502/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }
});

test("request() does not retry a 400 and gives up after maxRetries on 429", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("nope", { status: 400 });
  });
  try {
    await assert.rejects(() => makeClient().siteSummary({}), /HTTP 400/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }

  calls = 0;
  const mock2 = mockFetch(() => {
    calls++;
    return new Response("slow down", { status: 429 });
  });
  try {
    await assert.rejects(() => makeClient({ maxRetries: 2 }).siteSummary({}), /HTTP 429/);
    assert.equal(calls, 3); // initial + 2 retries
  } finally {
    mock2.restore();
  }
});

test("request() retries a network error for reads then succeeds", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) throw new Error("ECONNRESET");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().siteSummary({});
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() rethrows a network error immediately for a write", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    throw new Error("ECONNRESET");
  });
  try {
    await assert.rejects(() => makeClient({ maxRetries: 2 }).addSite({ hostUrl: "https://a.ru" }), /ECONNRESET/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }
});

test("request() aborts and reports a timeout when the request hangs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init: unknown) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    const client = makeClient({ timeoutMs: 10, maxRetries: 0 });
    await assert.rejects(() => client.siteSummary({}), /timed out after 10ms/);
  } finally {
    globalThis.fetch = original;
  }
});

test("request() rejects an absolute path (SSRF) and never fetches a foreign origin", async () => {
  for (const evil of ["https://evil.example/steal", "http://evil.example/x", "\\\\evil.example/x"]) {
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      await assert.rejects(() => makeClient().request("GET", evil), /foreign origin/);
      assert.equal(mock.calls.length, 0, `must not fetch for ${JSON.stringify(evil)}`);
    } finally {
      mock.restore();
    }
  }
});

test("request() still accepts a relative API path (with an inline query string)", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    const result = await makeClient().request("GET", "user/7/hosts?limit=5");
    assert.deepEqual(result, { ok: true });
    assert.equal(mock.calls[0].url, `${BASE}/user/7/hosts?limit=5`);
  } finally {
    mock.restore();
  }
});

test("a leading slash stays under the /v4 base", async () => {
  const mock = mockFetch(() => new Response("{}", { status: 200 }));
  try {
    await makeClient().request("GET", "/user");
    assert.equal(mock.calls[0].url, `${BASE}/user`);
  } finally {
    mock.restore();
  }
});

// --- Missing token (degraded start) ---

/**
 * The degraded-start contract: a server without a token still runs, so the
 * client must fail the call itself — with the exact actionable message, before
 * any fetch. Zero fetch calls proves the error skips the retry/backoff loop
 * and the user-id auto-detection alike (maxRetries is deliberately non-zero
 * here, and listSites would otherwise start with GET /user).
 */
test("no token: CredentialsError with the exact text, fetch never called", async () => {
  const mock = mockFetch(() => new Response("{}", { status: 200 }));
  try {
    const client = new WebmasterClient({ apiBase: BASE, maxRetries: 3, retryBaseMs: 0 });
    await assert.rejects(
      () => client.listSites(),
      (err: unknown) => {
        assert.ok(err instanceof CredentialsError, "must be a CredentialsError");
        assert.equal((err as Error).name, "CredentialsError");
        assert.equal((err as Error).message, MISSING_TOKEN_MESSAGE);
        // The historical startup error, verbatim — the message is the product.
        assert.ok(
          (err as Error).message.startsWith(
            "YANDEX_OAUTH_TOKEN is required (Yandex OAuth token with access to Yandex Webmaster).",
          ),
          "the message must open with the historical startup error, verbatim",
        );
        assert.match((err as Error).message, /restart the server/, "the fix must mention the restart");
        return true;
      },
    );
    assert.equal(mock.calls.length, 0, "must not fetch at all — no user-id lookup, no retries");
  } finally {
    mock.restore();
  }
});

test("an empty token is a missing token, not an empty credential", async () => {
  const mock = mockFetch(() => new Response("{}", { status: 200 }));
  try {
    const client = new WebmasterClient({ token: "", userId: 7, apiBase: BASE, maxRetries: 0 });
    await assert.rejects(() => client.listSites(), CredentialsError);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

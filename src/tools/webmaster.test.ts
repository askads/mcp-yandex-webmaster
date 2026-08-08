import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHostTools } from "./hosts.js";
import { registerQueryTools } from "./queries.js";
import { registerIndexingTools } from "./indexing.js";
import { registerLinkTools } from "./links.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const CLIENT_METHODS = [
  "user",
  "listSites",
  "addSite",
  "siteSummary",
  "verificationStatus",
  "startVerification",
  "siteDiagnostics",
  "popularQueries",
  "searchQueriesHistory",
  "indexingHistory",
  "recrawlUrl",
  "importantUrls",
  "listSitemaps",
  "addSitemap",
  "externalLinks",
] as const;

/** Fake server + fake client so the tool handlers run without network. */
function harness(opts: { throwOn?: string } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const client = Object.fromEntries(
    CLIENT_METHODS.map((method) => [
      method,
      async (params: unknown) => {
        calls.push({ method, params });
        if (opts.throwOn === method) throw new Error("boom");
        return { ok: true };
      },
    ]),
  );
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerHostTools(server as never, client as never);
  registerQueryTools(server as never, client as never);
  registerIndexingTools(server as never, client as never);
  registerLinkTools(server as never, client as never);
  return { calls, tools };
}

test("registers all fifteen domain tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), [
    "add_site",
    "add_sitemap",
    "get_external_links",
    "get_indexing_history",
    "get_popular_queries",
    "get_search_queries_history",
    "get_site_diagnostics",
    "get_site_summary",
    "get_user_id",
    "get_verification_status",
    "list_important_urls",
    "list_sitemaps",
    "list_sites",
    "recrawl_url",
    "start_verification",
  ]);
});

test("get_user_id and list_sites call their client methods without params", async () => {
  const { calls, tools } = harness();
  await tools.get_user_id({});
  await tools.list_sites({});
  assert.equal(calls[0].method, "user");
  assert.equal(calls[1].method, "listSites");
});

test("get_popular_queries forwards normalized snake_case args to the client", async () => {
  const { calls, tools } = harness();
  await tools.get_popular_queries({
    host_id: "https:example.com:443",
    order_by: "total_clicks",
    query_indicators: ["total_shows", "total_clicks"],
    device_type_indicator: "desktop",
    date_from: "2026-08-01",
    date_to: "2026-08-07",
    offset: 0,
    limit: 100,
  });
  assert.equal(calls[0].method, "popularQueries");
  assert.deepEqual(calls[0].params, {
    hostId: "https:example.com:443",
    orderBy: "total_clicks",
    queryIndicators: ["total_shows", "total_clicks"],
    deviceTypeIndicator: "desktop",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-07",
    offset: 0,
    limit: 100,
  });
});

test("start_verification forwards the host and the normalized method", async () => {
  const { calls, tools } = harness();
  await tools.start_verification({ host_id: "https:example.com:443", verification_type: "meta_tag" });
  assert.equal(calls[0].method, "startVerification");
  assert.deepEqual(calls[0].params, { hostId: "https:example.com:443", verificationType: "meta_tag" });
});

test("add_site, add_sitemap and recrawl_url forward their urls", async () => {
  const { calls, tools } = harness();
  await tools.add_site({ host_url: "https://example.com" });
  await tools.add_sitemap({ host_id: "h", url: "https://example.com/sitemap.xml" });
  await tools.recrawl_url({ host_id: "h", url: "https://example.com/page" });
  assert.deepEqual(calls[0], { method: "addSite", params: { hostUrl: "https://example.com" } });
  assert.deepEqual(calls[1], { method: "addSitemap", params: { hostId: "h", url: "https://example.com/sitemap.xml" } });
  assert.deepEqual(calls[2], { method: "recrawlUrl", params: { hostId: "h", url: "https://example.com/page" } });
});

test("list_sitemaps forwards the cursor pagination params", async () => {
  const { calls, tools } = harness();
  await tools.list_sitemaps({ host_id: "h", parent_id: "p1", limit: 50, from: "s9" });
  assert.deepEqual(calls[0].params, { hostId: "h", parentId: "p1", limit: 50, from: "s9" });
});

test("an omitted host_id is forwarded as undefined (the client applies the env default)", async () => {
  const { calls, tools } = harness();
  await tools.get_site_summary({});
  assert.deepEqual(calls[0].params, { hostId: undefined });
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "siteDiagnostics" });
  const res = await tools.get_site_diagnostics({ host_id: "h" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});

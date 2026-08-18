import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { WebmasterClient } from "../dist/client.js";
import { registerAuthTools } from "../dist/tools/auth.js";
import { registerHostTools } from "../dist/tools/hosts.js";
import { registerQueryTools } from "../dist/tools/queries.js";
import { registerIndexingTools } from "../dist/tools/indexing.js";
import { registerLinkTools } from "../dist/tools/links.js";
import { registerRawTool } from "../dist/tools/raw.js";

const ALL_TOOLS = [
  "add_site",
  "add_sitemap",
  "auth_status",
  "finish_login",
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
  "logout",
  "raw_request",
  "recrawl_url",
  "start_login",
  "start_verification",
];

test("dist client rejects foreign-origin paths before sending the OAuth token", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const client = new WebmasterClient({
    token: "SECRET",
    apiBase: "https://api.webmaster.yandex.net/v4",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  await assert.rejects(() => client.request("GET", "https://example.invalid/steal"), /foreign origin/);
  assert.equal(called, false);
});

test("dist client resolves and caches the user id for host paths", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (/\/v4\/user$/.test(String(url))) {
      return new Response('{"user_id":5}', { status: 200 });
    }
    return new Response('{"ok":true}', { status: 200 });
  };

  const client = new WebmasterClient({
    token: "SECRET",
    apiBase: "https://api.webmaster.yandex.net/v4",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  await client.siteSummary({ hostId: "https:example.com:443" });
  await client.listSites();
  assert.deepEqual(urls, [
    "https://api.webmaster.yandex.net/v4/user",
    "https://api.webmaster.yandex.net/v4/user/5/hosts/https%3Aexample.com%3A443/summary",
    "https://api.webmaster.yandex.net/v4/user/5/hosts",
  ]);
});

test("dist registers the full tool set", () => {
  const names = [];
  const server = {
    registerTool(name) {
      names.push(name);
    },
  };
  const client = {};
  const tokens = {};

  registerAuthTools(server, client, tokens);
  registerHostTools(server, client);
  registerQueryTools(server, client);
  registerIndexingTools(server, client);
  registerLinkTools(server, client);
  registerRawTool(server, client);

  assert.deepEqual(names.sort(), ALL_TOOLS);
});

test("built server answers the MCP handshake over stdio and lists every tool", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: {
      ...process.env,
      YANDEX_OAUTH_TOKEN: "smoke-test-token",
      ASKADS_TELEMETRY: "0",
    },
  });
  const client = new Client({ name: "dist-smoke", version: "0.0.0" });
  try {
    await client.connect(transport);
    // The initialize result carries the prose the calling model reads before it
    // picks a tool — an empty one would ship the server without its briefing.
    const instructions = client.getInstructions();
    assert.equal(typeof instructions, "string", "initialize result must carry instructions");
    assert.ok(instructions.trim().length > 0, "instructions must not be empty");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);
    const raw = tools.find((t) => t.name === "raw_request");
    assert.equal(raw.annotations.destructiveHint, true, "raw_request must be flagged destructive");
  } finally {
    await client.close();
  }
});

/**
 * A server with no token at all: no env var, and a config dir that cannot hold
 * a stored login. Both halves matter — pointing XDG_CONFIG_HOME at a fresh temp
 * dir is what keeps the developer's own credentials.json from making this pass.
 */
async function connectUnconfigured(name) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !key.startsWith("YANDEX_"),
    ),
  );
  env.ASKADS_TELEMETRY = "0"; // keep the suite offline
  env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-webmaster-unconfigured-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/**
 * The degraded-start contract: without a token the binary used to exit(1)
 * before the handshake, leaving the client a dead server and no reason. It
 * must now start, list every tool, open the instructions with the fix, and
 * answer a tool call with the actionable error — offline: the AuthRequiredError
 * fires before any fetch (even the user-id auto-detection), so this test never
 * touches the network.
 */
test("built server starts without a token: handshake, tool list, actionable call error", async () => {
  const client = await connectUnconfigured("dist-smoke-unconfigured");
  try {
    // The model must read the fix — both paths of it — before it picks a tool.
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /ещё не подключён/);
    assert.match(instructions, /start_login/);
    assert.match(instructions, /finish_login/);
    assert.match(instructions, /YANDEX_OAUTH_TOKEN/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);

    // A tool call fails with the exact message instead of killing the server —
    // and the message names both fixes: the in-chat login and the env variable.
    const result = await client.callTool({ name: "list_sites", arguments: {} });
    assert.equal(result.isError, true);
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /Яндекс Вебмастер не подключён: нет токена доступа\./);
    assert.match(text, /не сбой сети/);
    assert.match(text, /start_login/);
    assert.match(text, /YANDEX_OAUTH_TOKEN/);
    assert.match(text, /перезапустить сервер/);
  } finally {
    await client.close();
  }
});

test("unconfigured server offers the in-chat login: auth_status and a PKCE authorize URL", async () => {
  const client = await connectUnconfigured("dist-smoke-login");
  try {
    const status = await client.callTool({ name: "auth_status", arguments: {} });
    const parsed = JSON.parse(status.content[0]?.text ?? "{}");
    assert.equal(parsed.configured, false);
    assert.match(parsed.path ?? "", /credentials\.json$/);

    const result = await client.callTool({ name: "start_login", arguments: {} });
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    const url = new URL(payload.authorizeUrl ?? "");
    assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
    // The Webmaster app of this server, not a copy-paste from a sibling server.
    assert.equal(url.searchParams.get("client_id"), "aeed3f03722542dbbe16f8a09e5b2fd0");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"), "the URL must carry a PKCE challenge");
    assert.ok(!url.search.includes("client_secret"), "a public client must not leak a secret");
    // Nothing dead in the URL either: `state` guards a redirect callback, and this
    // hand-copied-code flow has none — PKCE alone binds the exchange.
    assert.equal(url.searchParams.get("state"), null);
  } finally {
    await client.close();
  }
});

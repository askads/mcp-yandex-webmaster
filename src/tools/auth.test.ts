import { test } from "node:test";
import assert from "node:assert/strict";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenStore } from "../auth.js";
import type { WebmasterClient } from "../client.js";
import { clearPendingLogin, startLogin } from "../oauth.js";
import { registerAuthTools } from "./auth.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/** Captures the tool handlers registerAuthTools registers, instead of a real server. */
function captureTools(client: unknown, tokens: unknown): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _meta: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };
  registerAuthTools(
    server as unknown as McpServer,
    client as unknown as WebmasterClient,
    tokens as unknown as TokenStore,
  );
  return handlers;
}

/** A fetch stand-in for the oauth token endpoint. */
function stubFetch(reply: { status?: number; body: unknown }): typeof fetch {
  return (async () =>
    ({
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      text: async () => JSON.stringify(reply.body),
    }) as unknown as Response) as unknown as typeof fetch;
}

function textOf(result: CallToolResult): string {
  return result.content.map((c) => ("text" in c ? c.text : "")).join(" ");
}

/**
 * The login itself succeeded — the token is saved — and only the verification
 * call died (a hiccup, a Webmaster outage). A bare isError here would read as
 * «вход не удался» and send the user through start_login again for nothing.
 */
test("finish_login: a failed verification call is not reported as a failed login", async () => {
  const saved: unknown[] = [];
  const tokens = {
    save: (response: unknown) => {
      saved.push(response);
      return response;
    },
    status: () => ({ configured: true, canRefresh: true, path: "/tmp/credentials.json" }),
  };
  const client = {
    listSites: async () => {
      throw new Error("fetch failed: сеть недоступна");
    },
  };
  const handlers = captureTools(client, tokens);

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch({
    body: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
  });
  try {
    startLogin();
    const result = await handlers.get("finish_login")!({ code: "1234567" });

    assert.notEqual(result.isError, true, "a saved login must not come back as an error");
    assert.equal(saved.length, 1, "the token must be saved before the verification call");
    const text = textOf(result);
    assert.match(text, /сохранён/);
    assert.match(text, /Проверочный вызов к API не удался/);
    assert.match(text, /сеть недоступна/);
  } finally {
    globalThis.fetch = realFetch;
    clearPendingLogin();
  }
});

/** The boundary of the fix: a failure *before* the save — the code exchange — stays an error. */
test("finish_login: a failed code exchange is still an error", async () => {
  const saved: unknown[] = [];
  const tokens = {
    save: (response: unknown) => {
      saved.push(response);
      return response;
    },
    status: () => ({ configured: false, canRefresh: false, path: "/tmp/credentials.json" }),
  };
  const client = {
    listSites: async () => ({ hosts: [] }),
  };
  const handlers = captureTools(client, tokens);

  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch({
    status: 400,
    body: { error: "bad_verification_code", error_description: "Invalid code" },
  });
  try {
    startLogin();
    const result = await handlers.get("finish_login")!({ code: "stale" });

    assert.equal(result.isError, true);
    assert.equal(saved.length, 0, "nothing must be saved when the exchange fails");
    assert.match(textOf(result), /10 минут.*start_login/s);
  } finally {
    globalThis.fetch = realFetch;
    clearPendingLogin();
  }
});

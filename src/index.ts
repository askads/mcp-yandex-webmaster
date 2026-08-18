#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenStore } from "./auth.js";
import { WebmasterClient } from "./client.js";
import { ConfigError, DEFAULT_BASE, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { WebmasterConfig } from "./types.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerHostTools } from "./tools/hosts.js";
import { registerQueryTools } from "./tools/queries.js";
import { registerIndexingTools } from "./tools/indexing.js";
import { registerLinkTools } from "./tools/links.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Prose the calling model receives in the `initialize` result, before it picks a
 * tool — the only place to say what the tool list cannot: which Yandex product
 * this is, where the API stops, what a call costs and which errors mean
 * something other than they say. Kept in Russian, like the tool descriptions.
 */
const INSTRUCTIONS =
  "Это Яндекс Вебмастер API v4 — состояние сайта в органическом поиске Яндекса: индексация, ИКС, " +
  "диагностика, sitemap, внешние ссылки, показы и клики по запросам. Не Метрика (посещаемость " +
  "сайта) и не Вордстат (спрос по словам), рекламных данных тут нет. Почти всё здесь — чтение: " +
  "состояние меняют только add_site, add_sitemap, recrawl_url и start_verification, и они лишь " +
  "создают, ничего не удаляя и не редактируя. Видны только сайты аккаунта токена, а статистика — " +
  "лишь при подтверждённых правах. Переобход тратит суточную квоту сайта (429 QUOTA_EXCEEDED до " +
  "завтра не лечится), не отправляйте страницы пачками; прочие 429 сервер ретраит сам с бэкоффом " +
  "(5xx и таймауты — только на чтении). HOST_NOT_VERIFIED значит «нет прав», " +
  "HOST_NOT_LOADED/HOST_NOT_INDEXED — «данных ещё нет», а не пустой ответ; 409 *_ALREADY_ADDED или " +
  "VERIFICATION_ALREADY_IN_PROGRESS — «уже сделано», повтор не поможет; INVALID_USER_ID — не " +
  "проблема токена, а неверный YANDEX_USER_ID (в ответе есть available_user_id). Удалить сайт или " +
  "sitemap можно только через raw_request с DELETE — безвозвратно и лишь по явной просьбе.";

/**
 * Prepended to INSTRUCTIONS when no token is available. The model reads this
 * before it picks a tool, so an unconfigured session opens with the fix rather
 * than with a failed call. In Russian, like INSTRUCTIONS.
 */
const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: Яндекс Вебмастер ещё не подключён — токена нет, поэтому любой инструмент данных " +
  "вернёт ошибку. Подключение делается прямо в диалоге и без перезапуска клиента: вызовите " +
  "start_login, покажите пользователю ссылку, попросите войти под аккаунтом, которому видны " +
  "нужные сайты, и прислать код подтверждения, затем передайте код в finish_login. " +
  "Альтернатива — задать YANDEX_OAUTH_TOKEN в конфигурации MCP-клиента и перезапустить сервер. ";

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a dead server and no reason.
 * Instead the problem is carried into the session, where the model can read it
 * and relay it: the config degrades to "no credentials" and every tool call
 * fails with the actionable message.
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: WebmasterConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Error: ${err.message}`);
    // Fire-and-forget now that the process survives: the historical
    // `startup_failed` funnel stays comparable, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      config: { apiBase: process.env.YANDEX_WEBMASTER_API_BASE || DEFAULT_BASE },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a config
  // problem can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const { config, problem } = loadConfigOrDegraded(telemetry);
  const tokens = new TokenStore(config.token);
  const client = new WebmasterClient(config, tokens);

  // Resolved once, at startup, only to pick the instructions text: the token
  // itself is re-read per request, so a login mid-session still takes effect.
  const connected = tokens.hasToken();

  const server = new McpServer(
    {
      name: "mcp-yandex-webmaster",
      version: readVersion(),
    },
    // Surfaces as `instructions` in the initialize result (ServerOptions, not serverInfo).
    {
      instructions: connected
        ? INSTRUCTIONS
        : UNCONFIGURED_PREFIX + (problem ? `Проблема конфигурации: ${problem.message} ` : "") + INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that number.
    if (connected) telemetry.send("server_start");
    else telemetry.send("unconfigured_start", { reason: problem?.reason ?? "missing_token" });
  };

  registerAuthTools(server, client, tokens);
  registerHostTools(server, client);
  registerQueryTools(server, client);
  registerIndexingTools(server, client);
  registerLinkTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-yandex-webmaster running on stdio${connected ? "" : " (no token — connect via start_login)"}`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting mcp-yandex-webmaster:", err);
  process.exit(1);
});

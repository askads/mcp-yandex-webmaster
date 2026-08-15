# CLAUDE.md — mcp-yandex-webmaster

MCP server for the Yandex Webmaster API v4 (TypeScript, stdio). Mostly read
tools (sites, summary, diagnostics, search queries, indexing, sitemaps, links)
plus four non-destructive writes (`add_site`, `add_sitemap`, `recrawl_url`,
`start_verification`); `raw_request` is the escape hatch (GET/POST/DELETE). The
server talks to `https://api.webmaster.yandex.net/v4`; auth is a Yandex OAuth
token sent as `Authorization: OAuth <token>`, and almost every path lives under
`/user/{user-id}/...` — the client resolves the user id via `GET /v4/user` once
and caches it (or takes `YANDEX_USER_ID`).

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY call (needs YANDEX_OAUTH_TOKEN)
```

## Architecture

- `src/config.ts` — env → config. A missing `YANDEX_OAUTH_TOKEN` is NOT an error: the field
  stays `undefined` (an empty string reads as absent) and the server starts degraded, with the
  client raising `CredentialsError` at call time. `ConfigError` (with a `reason` code) is
  reserved for malformed values — today a non-numeric `YANDEX_USER_ID` — and is caught by
  `loadConfigOrDegraded` in `index.ts`. Also home to `CredentialsError` /
  `MISSING_TOKEN_MESSAGE` (opens with the historical startup error verbatim, then names the
  variable and the restart). Optional `YANDEX_USER_ID`, `YANDEX_WEBMASTER_HOST_ID`,
  `YANDEX_WEBMASTER_API_BASE`, `YANDEX_WEBMASTER_TIMEOUT_MS`, `YANDEX_WEBMASTER_MAX_RETRIES`.
- `src/client.ts` — one typed method per endpoint. Owns the wire vocabulary
  (`TOTAL_SHOWS`, `MOBILE_AND_TABLET`, `DNS`, ... via `map*` helpers), the user-id
  promise cache (`userId()`, failure not cached), the host path builder (`hostPath()`
  applies the config default and URL-encodes the id, failing fast without a fetch when
  both are missing) and query-string building (arrays become repeated params, undefined
  is dropped). `request()` first rejects a missing token with `CredentialsError` — before the
  request is built, the retries and fetch, which also stops the user-id auto-detection — then
  resolves the path against the base and rejects any path that
  escapes to a foreign origin (SSRF guard), retries 429 (except `QUOTA_EXCEEDED`) but
  5xx/network **only for GET** (a 502 after a committed write must not duplicate it), honors `Retry-After`,
  enforces an AbortController timeout that also covers reading the body, and throws
  `WebmasterError(status, body)`.
- `src/types.ts` — config + normalized unions; `WebmasterError` parses the API's
  `{error_code, error_message, ...}` body and appends follow-up hints for
  `HOST_NOT_VERIFIED` / `HOST_NOT_LOADED` / `HOST_NOT_INDEXED` (and
  `available_user_id` for `INVALID_USER_ID`).
- `src/tools/hosts.ts` — sites, summary, verification, diagnostics; `queries.ts` —
  popular queries + history; `indexing.ts` — crawl history, recrawl, important pages,
  sitemaps; `links.ts` — external links; `raw.ts` — `raw_request` (substitutes a
  `{user-id}` placeholder). `util.ts` — `ok`/`fail`, the `READ_ONLY`/`WRITE`/`DESTRUCTIVE`
  annotation constants and shared zod schema factories (`hostId`, `isoDate`).
- `src/index.ts` — wires every `register*` into the McpServer. `loadConfigOrDegraded()`
  catches `ConfigError`, pings `startup_failed` (fire-and-forget) and degrades the config to
  "no credentials"; an unconfigured start prepends `UNCONFIGURED_PREFIX` — plus
  `Проблема конфигурации: <message>` when a ConfigError was caught — to the initialize
  `instructions`, and `oninitialized` sends `server_start` for a configured install or
  `unconfigured_start` (with the reason) otherwise.
- `src/telemetry.ts` — anonymous usage pings (ids/names/versions only, never data or
  arguments; fire-and-forget, must never block or throw; opt-out `ASKADS_TELEMETRY=0`).
  `server_start` means "a usable install started"; `unconfigured_start` is a degraded start
  and `startup_failed` a malformed config caught at load — both carry a `reason` from a
  closed vocabulary (`missing_token`, `invalid_user_id`) — never a variable's name or value.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a red cross and no reason — telemetry across this line of servers showed that
  state accounted for nearly every unconfigured install, and almost none of them recovered.
  A missing token is a survivable state: start, answer initialize (with the unconfigured
  prefix in `instructions`) and tools/list, and let the first tool call fail with
  `CredentialsError`. There are no login tools: the token comes only from the environment, so
  the fix is the operator setting `YANDEX_OAUTH_TOKEN` and restarting the server.
  `config.test.ts`, `client.test.ts` and `test/dist-smoke.test.js` pin this.
- **Credential failures are not transport failures.** `CredentialsError` is thrown at the top
  of `request()` — before the request is built, the retry/backoff loop and fetch (every call,
  including the user-id auto-detection, funnels through there) — retrying a missing token
  burns seconds of backoff before the user sees the one message that helps. Pinned by
  "fetch must not be called" assertions in `client.test.ts`.
- **Writes are gated.** Only `add_site`, `add_sitemap`, `recrawl_url` and
  `start_verification` are writes; they carry `WRITE` (non-destructive, non-idempotent —
  a repeat is a 409). `raw_request` carries `DESTRUCTIVE` because DELETE endpoints are
  reachable through it. Everything else is `READ_ONLY`. `annotations.test.ts` pins the
  full tool → hints map.
- **Retry policy follows idempotency.** 429 is safe to retry (nothing committed) —
  except `QUOTA_EXCEEDED`, the daily recrawl quota that backoff cannot refill; 5xx and
  network errors are retried for GET only. Don't loosen this in `request()`.
- **Wire mapping lives in the client, not the tools.** Tools accept the normalized
  snake_case vocabulary (`total_shows`, `mobile_and_tablet`, `dns`, ...) and must not
  know the API's UPPER_CASE values — add any mapping in `client.ts`.
- **user_id and host_id resolution is the client's job.** Tools pass `host_id` through
  (possibly undefined); `hostPath()` applies `YANDEX_WEBMASTER_HOST_ID` and the cached
  user id. Tools never build `/user/...` paths themselves.
- **Validate inputs with zod** in `inputSchema`; reuse the shared schema **factories**
  in `util.ts` (a fresh schema per field avoids `$ref` dedup in the JSON schema —
  `date_from`/`date_to` share a shape inside one inputSchema).
- **Output compact JSON via `ok`** — the consumer is an LLM; pretty-printing burns
  tokens. Responses pass through verbatim (describe the fields in the tool
  `description`, the only place the external model reads — descriptions are in Russian).
- **int64 counts can be strings.** Yandex serializes some counts as JSON strings; don't
  assume number.

## Adding a tool

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. If it hits a new endpoint, add a method to `src/client.ts` with the wire mapping
   (and `hostPath()` when it is host-scoped).
3. Import and call the register fn in `src/index.ts`.
4. Add a `*.test.ts` using the mock-fetch (client) / fake-client (tools) harness — no
   network; extend the pinned lists in `annotations.test.ts` and
   `test/dist-smoke.test.js`.
5. `npm run typecheck && npm test`.

## Releasing

Keep the version in sync across **all** channels in one go — publishing to npm alone
silently drifts from the rest (`git push --follow-tags` pushes the tag but does **not**
create a GitHub Release; the registry is immutable per version, so even a metadata-only
change needs a bump):

1. Bump `version` in **three places, identically**: `package.json`, and in `server.json`
   **both** the root `version` **and** `packages[0].version`. `mcpName` in `package.json`
   must match `name` in `server.json`. Verify: `grep -n '"version"' package.json server.json`.
   > ⚠️ `mcp-publisher` publishes the **root** `server.json.version`. If you bump npm +
   > `packages[0].version` but leave the root stale, `npm publish` still succeeds, yet
   > `mcp-publisher publish` fails with a misleading `400 cannot publish duplicate version`.
2. `npm publish` (runs typecheck + tests + build via `prepublishOnly` / `prepare`).
3. `git commit`, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push origin main --follow-tags`.
4. **GitHub Release:** `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`.
5. **Official MCP registry:** `mcp-publisher publish` (see docs/PUBLISHING.md for the
   token-login caveat).

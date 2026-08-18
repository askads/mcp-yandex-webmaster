# Tools

The server wraps the Yandex Webmaster API v4. Most tools are read-only; four are
non-destructive writes (`add_site`, `add_sitemap`, `recrawl_url`,
`start_verification`) — they create things but never delete or overwrite. Inputs
are normalized snake_case; the client maps them to the API's wire values
(`TOTAL_SHOWS`, `MOBILE_AND_TABLET`, `DNS`, ...), resolves and caches the
`user-id` for every `/user/{user-id}/...` path and URL-encodes the `host_id`.

Every tool that touches a site takes `host_id` (the `https:example.com:443`-style
id from `list_sites`); it can be omitted when `YANDEX_WEBMASTER_HOST_ID` is set.

## Connection (in-chat login)

| Tool | Description |
|---|---|
| `auth_status` | Whether a token exists, where it came from (`env` / `stored`), when it expires and where the credentials file lives. Touches no network, never shows the token itself. |
| `start_login` | First step of the in-chat login: returns a Yandex OAuth URL. The user signs in and gets a confirmation code (valid for 10 minutes). |
| `finish_login` | Second step: exchanges the code for a token, stores it in `~/.config/mcp-yandex-webmaster/credentials.json` (mode `0600`) and immediately verifies it with a live call. Takes effect without a client restart. |
| `logout` | Deletes the stored token. Never touches `YANDEX_OAUTH_TOKEN` and does not revoke the grant on Yandex's side (that lives in Yandex ID). |

Notes:
- **The secret never leaves the machine.** The flow is OAuth + PKCE (S256): the
  `code_verifier` stays in the process, so the one-shot code passing through the
  chat is useless without it.
- **Source priority:** `YANDEX_OAUTH_TOKEN` beats the stored login. An env token
  is never refreshed or deleted by the server.

## Sites & verification

| Tool | Description |
|---|---|
| `get_user_id` | The token owner's `user_id` (`GET /v4/user`). The server injects it everywhere automatically; useful for diagnostics and `raw_request` paths. |
| `list_sites` | The user's sites: `host_id`, ASCII/Unicode URLs, `verified`, `main_mirror`. The starting point for everything else. |
| `add_site` | Add a site to the user's Webmaster list. Returns `{host_id}`. `409 HOST_ALREADY_ADDED`, `403 HOSTS_LIMIT_EXCEEDED`. |
| `get_site_summary` | SQI (site quality index), searchable/excluded page counts and problem counts by severity. |
| `get_verification_status` | Verification state, type, the UIN code to place on the site and `applicable_verifiers`. |
| `start_verification` | Start a rights check via `dns`, `html_file` or `meta_tag` (place the UIN first). `409 VERIFICATION_ALREADY_IN_PROGRESS`. |
| `get_site_diagnostics` | Detected site problems: type → `{severity, state, last_state_update}`. |

## Search queries

| Tool | Description |
|---|---|
| `get_popular_queries` | Top queries for a period (up to 3000 for the last week, pages of ≤500 via `offset`/`limit`): `{query_id, query_text, indicators}`. Sort with `order_by` (`total_shows`/`total_clicks`); pick `query_indicators` and a `device_type_indicator`. |
| `get_search_queries_history` | Site-wide indicator history: indicator → array of `{date, value}`. Shows/clicks/average positions over time. |

## Indexing & sitemaps

| Tool | Description |
|---|---|
| `get_indexing_history` | Robot crawl history: pages fetched per date, bucketed by `HTTP_2XX`..`HTTP_5XX` and `OTHER`. |
| `recrawl_url` | Queue a page for recrawl. Returns `{task_id, quota_remainder}` (daily per-site quota). `400 INVALID_URL`, `409 URL_ALREADY_ADDED`, `429 QUOTA_EXCEEDED`. |
| `list_important_urls` | Monitored "important pages" with per-page indexing and search status plus what changed. |
| `list_sitemaps` | Sitemaps known to the robot, cursor-paginated (`from` = last seen `sitemap_id`, `parent_id` walks index sitemaps). |
| `add_sitemap` | Add a sitemap by URL. Returns `{sitemap_id}`. `409 SITEMAP_ALREADY_ADDED`. |

## Links

| Tool | Description |
|---|---|
| `get_external_links` | Sample external links: `count` plus `{source_url, destination_url, discovery_date, source_last_access_date}` pages (`offset`/`limit`). |

Notes:
- **`host_id` comes from `list_sites`** and looks like `https:example.com:443` — it is not a URL.
- **Most statistics need verified rights** on the site: `404 HOST_NOT_VERIFIED` otherwise
  (the error message carries a follow-up hint); `HOST_NOT_LOADED` / `HOST_NOT_INDEXED`
  mean the data simply is not there yet.
- **Dates** (`date_from`/`date_to`) accept ISO 8601; responses carry timestamps like
  `2019-07-18T00:00:00.000+03:00`. Defaults: last week for query reports, today for
  indexing history.
- **int64 counts can arrive as JSON strings** — don't assume number.

## Escape hatch

| Tool | Description |
|---|---|
| `raw_request` | Call any Webmaster API v4 path directly (relative to `/v4`, e.g. `user/{user-id}/hosts/<host-id>/recrawl/quota` — `{user-id}` is substituted automatically). Methods: `GET` (default), `POST` (JSON `body`), `DELETE` (site/sitemap deletion — destructive!). A `path` that resolves to a foreign origin is rejected (SSRF guard), so the OAuth token cannot leak. |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `YANDEX_OAUTH_TOKEN` | no | — | Ready-made Yandex OAuth token with Webmaster access, sent as `Authorization: OAuth <token>` — for CI and automated installs where there is no chat; otherwise use the in-chat login. Beats the stored login; never refreshed or deleted by the server. Treat it as a secret. |
| `YANDEX_WEBMASTER_OAUTH_CLIENT_ID` | no | the A1-x-Tech app | ClientID of your own OAuth app for the in-chat login (Redirect URI must be `https://oauth.yandex.ru/verification_code`). |
| `YANDEX_USER_ID` | no | auto | Token owner's user id; skips the `GET /v4/user` roundtrip. |
| `YANDEX_WEBMASTER_HOST_ID` | no | — | Default `host_id` used when a tool call omits one. |
| `YANDEX_WEBMASTER_API_BASE` | no | `https://api.webmaster.yandex.net/v4` | API root override. |
| `YANDEX_WEBMASTER_TIMEOUT_MS` | no | `60000` | Per-request timeout, ms. |
| `YANDEX_WEBMASTER_MAX_RETRIES` | no | `3` | Retries on 429 (except the daily `QUOTA_EXCEEDED`) and 5xx/network (GET only). |

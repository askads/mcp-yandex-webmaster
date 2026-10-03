# Yandex Webmaster MCP

Work with Yandex Webmaster from Claude: site indexing, search-query analytics, sitemaps, diagnostics, external links and recrawl requests.

This plugin is an **unofficial, third-party client** published by AskAds. It is not
affiliated with, endorsed by, or operated by the owner of the API it talks to.

## What the plugin does

Enabling the plugin registers one MCP server named `yandex-webmaster`. Claude Code starts it by
running `npx -y mcp-yandex-webmaster@1.1.1`, which downloads that exact published version of the
`mcp-yandex-webmaster` npm package and runs it on your machine. The version is pinned, so the plugin never
pulls a newer release without an update to this plugin.

The server talks to the Yandex Webmaster API (api.webmaster.yandex.net) over HTTPS, using the credentials you enter when the plugin
is enabled. It sends nothing to AskAds except the telemetry described below.

## What it needs from you

The plugin asks for its credentials through the plugin configuration dialog, not through
environment variables, so nothing has to be exported in your shell. Sensitive values go to
your operating system's credential store rather than to `settings.json`.

- **Yandex OAuth token** (required) — OAuth token for the Yandex Webmaster API. Stored in your operating system's credential store, never in settings.json. Stored securely.
- **Yandex user id** — Webmaster user id the token belongs to. Leave empty to resolve it from the token.
- **Default host id** — Host to use when a request does not name one, for example https:example.com:443.
- **Anonymous telemetry** — Set to 0 to disable the anonymous usage telemetry the server sends by default. Leave as 1 to keep it on.

## Telemetry

The underlying server sends anonymous technical events by default: a random installation
identifier, the name of the tool that was called, and the versions of the server, the AI
app, Node.js and the operating system. Your access token, your account data, tool arguments
and the names and values of environment variables are **not** sent. Set the
**Anonymous telemetry** option to `0` to turn it off.

## Skills

`indexing-check` — Check how Yandex indexes a site: resolve the host id first, read diagnostics and indexing counts, and spend recrawl requests against their daily quota deliberately.

## Source and license

Source: https://github.com/askads/mcp-yandex-webmaster. Released under the MIT license.

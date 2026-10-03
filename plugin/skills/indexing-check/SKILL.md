---
name: indexing-check
description: Check how Yandex indexes a site: resolve the host id first, read diagnostics and indexing counts, and spend recrawl requests against their daily quota deliberately.
---

# Yandex Webmaster MCP

## What this server covers

Yandex Webmaster for a verified site: indexing state, search-query analytics, sitemaps,
site diagnostics, external links and recrawl requests.

## Resolve the host id first

Every call is scoped to a host id, and the host id is not the domain — it looks like
`https:example.com:443`. Resolve it from the host list before anything else. A host that is
not verified returns an explicit error rather than empty data, so read the error instead of
reporting "no data".

## Read diagnostics before conclusions

Indexing counts answer "how much", diagnostics answer "why". A drop in indexed pages next
to a clean diagnostics report means something different from the same drop next to a
server-error finding. Pull both before explaining a change.

## Recrawl requests are a scarce resource

Recrawl requests have a daily quota and do not guarantee a recrawl. Spend them on pages
that actually changed, name the pages you are submitting, and report how much of the quota
is left rather than submitting a list and hoping.

## Search queries

Query statistics lag behind reality by days, so a query missing today is not evidence that
it stopped working. Say which period the numbers cover.


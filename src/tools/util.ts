import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** Normalized device buckets for search-query reports; the client maps to the API's wire values. */
export const deviceTypeEnum = z.enum(["all", "desktop", "mobile_and_tablet", "mobile", "tablet"]);

/** Normalized query indicators; the client maps to TOTAL_SHOWS / TOTAL_CLICKS / AVG_*_POSITION. */
export const queryIndicatorEnum = z.enum([
  "total_shows",
  "total_clicks",
  "avg_show_position",
  "avg_click_position",
]);

/**
 * host_id of a site, optional because YANDEX_WEBMASTER_HOST_ID can supply the default.
 *
 * A FACTORY (not a shared const): reusing one zod object across two fields makes
 * zod-to-json-schema dedupe them into a `$ref`, which some tool-schema consumers
 * (OpenAI Apps review) don't dereference and flag as `any`. A fresh object per
 * field keeps each one inlined with its type + description.
 */
export const hostId = () =>
  z
    .string()
    .min(1)
    .optional()
    .describe(
      "Идентификатор сайта host_id вида «https:example.com:443» (получите из list_sites). " +
        "Можно не указывать, если задана переменная YANDEX_WEBMASTER_HOST_ID.",
    );

/**
 * An ISO 8601 date or datetime for date_from/date_to. The API documents the type
 * as datetime; a full timestamp with a timezone is the safest form to send.
 * A factory for the same `$ref` reason as {@link hostId} — date_from and date_to
 * live in one inputSchema.
 */
export const isoDate = () =>
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/,
      "Дата в формате ISO 8601, напр. 2026-08-01 или 2026-08-01T00:00:00+03:00",
    );

/** Wraps a value as a compact-JSON tool result (compact: the consumer is an LLM). */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: text ?? "null" }] };
}

export function fail(err: unknown): CallToolResult {
  let message = err instanceof Error ? err.message : String(err);
  // Surface the underlying cause (e.g. the network error behind a timeout) — no
  // secrets live in cause, and it makes failures far easier to diagnose.
  if (err instanceof Error && err.cause instanceof Error) message += ` (${err.cause.message})`;
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool. All four hints are set explicitly on every constant: some clients
 * (OpenAI Apps review) require readOnlyHint, destructiveHint and openWorldHint
 * on every tool.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * Non-destructive writes (add_site, add_sitemap, recrawl_url, start_verification):
 * they create something but never delete or overwrite; a repeat is a 409, not a
 * duplicate, so they are still not idempotent.
 */
export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/**
 * Idempotent, non-destructive write (finish_login): it overwrites the stored
 * credentials file, and re-applying the same input converges on the same state
 * — unlike the API writes above, where a repeat is a 409.
 */
export const WRITE_UPDATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * The raw escape hatch can reach DELETE endpoints (delete site / delete sitemap),
 * so it is flagged destructive on top of WRITE. Also carried by logout, which
 * deletes the stored credentials file.
 */
export const DESTRUCTIVE = {
  ...WRITE,
  destructiveHint: true,
} as const;

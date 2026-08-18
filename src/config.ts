import type { WebmasterConfig } from "./types.js";

/** Default Yandex Webmaster API v4 root. */
export const DEFAULT_BASE = "https://api.webmaster.yandex.net/v4";

/**
 * A malformed environment variable. Thrown instead of exiting on the spot so
 * index.ts can catch it, report the drop-off and start degraded instead of
 * dying; `reason` is the machine-readable code that ships with that ping
 * (never a variable's value). A *missing* token is NOT a ConfigError — see
 * {@link loadConfig}.
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

/**
 * What a tool call without a token reads. The first sentence is the historical
 * startup error, verbatim — the rest exists because the token comes only from
 * the environment, so the fix is an operator action plus a restart, never a
 * retry.
 */
export const MISSING_TOKEN_MESSAGE =
  "YANDEX_OAUTH_TOKEN is required (Yandex OAuth token with access to Yandex Webmaster). " +
  "This is not a network failure and retrying will not help: the operator must set this " +
  "environment variable in the MCP client's server config and restart the server — it is " +
  "read only at startup.";

/**
 * Raised when a tool call needs the OAuth token and none was configured. The
 * message is the whole point of the class: it is the only text the calling
 * model reads about the missing setup, so it names the fix (which variable,
 * and that a restart is needed) instead of the failure.
 */
export class CredentialsError extends Error {
  constructor(message: string = MISSING_TOKEN_MESSAGE) {
    super(message);
    this.name = "CredentialsError";
  }
}

/**
 * Builds the client config from environment variables.
 *
 * A missing token is NOT an error here: the server starts anyway and the
 * client raises {@link CredentialsError} on the first tool call, so an
 * unconfigured install completes the MCP handshake and carries the fix into
 * the session instead of dying before it with nothing to read. A malformed
 * value — a non-numeric YANDEX_USER_ID — still throws, because guessing what
 * the user meant is worse.
 *
 *   YANDEX_OAUTH_TOKEN           Yandex OAuth token with Webmaster access
 *   YANDEX_USER_ID               Override the user id (default: auto via GET /v4/user)
 *   YANDEX_WEBMASTER_HOST_ID     Default host_id, e.g. https:example.com:443
 *   YANDEX_WEBMASTER_API_BASE    API root override (default Yandex Webmaster API v4)
 *   YANDEX_WEBMASTER_TIMEOUT_MS  Per-request timeout (default 60000)
 *   YANDEX_WEBMASTER_MAX_RETRIES Retries on transient errors (default 3)
 */
export function loadConfig(): WebmasterConfig {
  let userId: number | undefined;
  const rawUserId = process.env.YANDEX_USER_ID;
  if (rawUserId) {
    const parsed = Number(rawUserId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ConfigError(
        "YANDEX_USER_ID must be a positive integer (or unset for auto-detection).",
        "invalid_user_id",
      );
    }
    userId = parsed;
  }

  const timeoutMs = Number(process.env.YANDEX_WEBMASTER_TIMEOUT_MS);
  const maxRetries = Number(process.env.YANDEX_WEBMASTER_MAX_RETRIES);

  return {
    // An empty string reads as absent, never as an empty credential.
    token: process.env.YANDEX_OAUTH_TOKEN || undefined,
    userId,
    hostId: process.env.YANDEX_WEBMASTER_HOST_ID || undefined,
    apiBase: process.env.YANDEX_WEBMASTER_API_BASE || DEFAULT_BASE,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}

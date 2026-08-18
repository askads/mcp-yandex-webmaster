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
 * Builds the client config from environment variables.
 *
 * A missing token is NOT an error here: the server starts anyway and the token
 * is resolved per request (env → stored credentials), so an unconfigured
 * install can log in from the chat instead of dying before the MCP handshake —
 * which is where it used to leave the user with a silent dead server and
 * nothing to read. A malformed value — a non-numeric YANDEX_USER_ID — still
 * throws, because guessing what the user meant is worse.
 *
 *   YANDEX_OAUTH_TOKEN           Yandex OAuth token with Webmaster access (optional:
 *                                the in-chat login stores its own token; env wins)
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

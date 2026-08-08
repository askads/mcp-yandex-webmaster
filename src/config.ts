import type { WebmasterConfig } from "./types.js";

/** Default Yandex Webmaster API v4 root. */
const DEFAULT_BASE = "https://api.webmaster.yandex.net/v4";

/**
 * A missing or malformed environment variable. Thrown instead of exiting on the
 * spot so index.ts can report the drop-off before the process dies; `reason` is
 * the machine-readable code that ships with that ping (never a variable's value).
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

function die(message: string, reason: string): never {
  throw new ConfigError(message, reason);
}

/**
 * Builds the client config from environment variables, throwing ConfigError if
 * a required one is missing.
 *
 *   YANDEX_OAUTH_TOKEN           Yandex OAuth token with Webmaster access (required)
 *   YANDEX_USER_ID               Override the user id (default: auto via GET /v4/user)
 *   YANDEX_WEBMASTER_HOST_ID     Default host_id, e.g. https:example.com:443
 *   YANDEX_WEBMASTER_API_BASE    API root override (default Yandex Webmaster API v4)
 *   YANDEX_WEBMASTER_TIMEOUT_MS  Per-request timeout (default 60000)
 *   YANDEX_WEBMASTER_MAX_RETRIES Retries on transient errors (default 3)
 */
export function loadConfig(): WebmasterConfig {
  const token = process.env.YANDEX_OAUTH_TOKEN;
  if (!token) {
    die(
      "YANDEX_OAUTH_TOKEN is required (Yandex OAuth token with access to Yandex Webmaster).",
      "missing_token",
    );
  }

  let userId: number | undefined;
  const rawUserId = process.env.YANDEX_USER_ID;
  if (rawUserId) {
    const parsed = Number(rawUserId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      die("YANDEX_USER_ID must be a positive integer (or unset for auto-detection).", "invalid_user_id");
    }
    userId = parsed;
  }

  const timeoutMs = Number(process.env.YANDEX_WEBMASTER_TIMEOUT_MS);
  const maxRetries = Number(process.env.YANDEX_WEBMASTER_MAX_RETRIES);

  return {
    token,
    userId,
    hostId: process.env.YANDEX_WEBMASTER_HOST_ID || undefined,
    apiBase: process.env.YANDEX_WEBMASTER_API_BASE || DEFAULT_BASE,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}

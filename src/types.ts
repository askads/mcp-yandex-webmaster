/**
 * The server talks to the Yandex Webmaster API v4
 * (https://api.webmaster.yandex.net/v4). Auth is a Yandex OAuth token sent as
 * `Authorization: OAuth <token>`. Almost every resource lives under
 * `/user/{user-id}/...`, where user-id is the token owner — the client resolves
 * it once via `GET /v4/user` and caches it (or takes YANDEX_USER_ID from the
 * config).
 */

/** Device filter for search-query reports, normalized; mapped to the API's wire values by the client. */
export type DeviceType = "all" | "desktop" | "mobile_and_tablet" | "mobile" | "tablet";

/** Search-query indicators, normalized; mapped by the client. */
export type QueryIndicator = "total_shows" | "total_clicks" | "avg_show_position" | "avg_click_position";

/** Sort order for the popular-queries report, normalized; mapped by the client. */
export type QueryOrder = "total_shows" | "total_clicks";

/** Verification methods accepted by POST /verification, normalized; mapped by the client. */
export type VerificationType = "dns" | "html_file" | "meta_tag";

export interface WebmasterConfig {
  /**
   * Yandex OAuth token, sent as `Authorization: OAuth <token>`. Treated as a
   * secret. Absent on a degraded start: the server still runs and the client
   * raises CredentialsError on the first call that needs the API.
   */
  token?: string;
  /** Token owner's user id. When absent the client fetches it via GET /v4/user and caches it. */
  userId?: number;
  /** Default host_id (e.g. "https:example.com:443") used when a tool call omits host_id. */
  hostId?: string;
  /** API root. Defaults to the Yandex Webmaster API v4. */
  apiBase: string;
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Max retries for transient errors (429 rate limit, except the daily QUOTA_EXCEEDED; 5xx/network for reads). Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled each retry. Defaults to 500. */
  retryBaseMs?: number;
}

/**
 * Follow-up hints for the error codes users hit most; appended to the message
 * so the calling LLM can explain what to do instead of echoing a bare code.
 */
const ERROR_HINTS: Record<string, string> = {
  HOST_NOT_VERIFIED: "подтвердите права на сайт (get_verification_status → start_verification)",
  HOST_NOT_LOADED: "данные о сайте ещё не загружены в Вебмастер — попробуйте позже",
  HOST_NOT_INDEXED: "сайт ещё не проиндексирован роботом",
  QUOTA_EXCEEDED: "суточная квота переобхода исчерпана — попробуйте завтра",
};

/**
 * The Webmaster API reports failures as a non-2xx HTTP status with a JSON body
 * ({ error_code, error_message, ...extras }). The parsed body is kept alongside
 * the status and a short readable message is derived.
 */
export class WebmasterError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${formatErrorBody(body)}`);
    this.name = "WebmasterError";
    this.status = status;
    this.body = body;
  }
}

/** Turns a parsed Webmaster API error body into a short, readable message. */
function formatErrorBody(body: unknown): string {
  if (body == null) return "(no body)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return String(body);
  const obj = body as Record<string, unknown>;

  // Webmaster API style: { error_code, error_message, ...extras }
  if (typeof obj.error_code === "string" || typeof obj.error_message === "string") {
    const code = typeof obj.error_code === "string" ? obj.error_code : undefined;
    const message = typeof obj.error_message === "string" ? obj.error_message : JSON.stringify(obj);
    const hint = code && ERROR_HINTS[code] ? ` — ${ERROR_HINTS[code]}` : "";
    // INVALID_USER_ID ships the id the token actually owns — surface it.
    const available =
      obj.available_user_id !== undefined ? ` (available_user_id: ${String(obj.available_user_id)})` : "";
    return `${code ? `[${code}] ` : ""}${message}${hint}${available}`.slice(0, 500);
  }

  return JSON.stringify(obj).slice(0, 500);
}

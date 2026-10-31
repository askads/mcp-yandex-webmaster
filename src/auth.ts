import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
  type StoredCredentials,
} from "./credentials.js";
import { oauthClientId, refreshTokens, type TokenResponse } from "./oauth.js";

/**
 * Raised when a call needs a token and none is available. Replaces the old
 * CredentialsError of the degraded-start flow: there is one class and one text
 * now that the fix has two paths. The message is the whole point of the class —
 * it is what the calling model reads and relays, so it names the fix (the
 * in-chat login, or the env variable plus a restart) instead of the failure.
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** Refresh this long before the stated expiry, so a call never races the clock. */
const REFRESH_LEEWAY_MS = 60_000;

export type TokenSource = "env" | "stored";

export interface AuthStatus {
  configured: boolean;
  source?: TokenSource;
  /** ISO date the stored access token expires; absent for env tokens and when unknown. */
  expiresAt?: string;
  /** ISO date the stored token was obtained; absent when the file has no usable value. */
  obtainedAt?: string;
  /** Stored fields that are present but are not epoch-ms timestamps. */
  unreadableFields?: string[];
  canRefresh: boolean;
  path: string;
  note?: string;
}

export const NOT_CONNECTED_MESSAGE =
  "Яндекс Вебмастер не подключён: нет токена доступа. " +
  "Это не сбой сети — повторный вызов не поможет, нужно подключение. " +
  "Вызовите инструмент start_login, покажите пользователю ссылку, попросите войти " +
  "под аккаунтом, которому в Вебмастере видны нужные сайты, и прислать код подтверждения, " +
  "затем передайте этот код в finish_login. " +
  "Альтернатива без диалога — задать переменную окружения YANDEX_OAUTH_TOKEN " +
  "в конфигурации MCP-клиента и перезапустить сервер.";

/**
 * Resolves the access token for every request. Two sources, in this order:
 *
 *   env    — YANDEX_OAUTH_TOKEN, the documented setup; never touched or refreshed
 *   stored — ~/.config/mcp-yandex-webmaster/credentials.json, written by finish_login
 *
 * env wins so an explicitly configured install (and CI) behaves exactly as before,
 * and the file is re-read on every call — that is what lets a login take effect
 * mid-session without restarting the client.
 */
export class TokenStore {
  constructor(
    private readonly envToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** True when a token exists without touching the network. */
  hasToken(): boolean {
    return Boolean(this.envToken) || Boolean(readCredentials());
  }

  async getToken(): Promise<string> {
    if (this.envToken) return this.envToken;

    const stored = readCredentials();
    if (!stored) throw new AuthRequiredError(NOT_CONNECTED_MESSAGE);

    if (!isExpired(stored)) return stored.access_token;

    if (!stored.refresh_token) {
      throw new AuthRequiredError(
        "Срок действия сохранённого токена Вебмастера истёк, а обновить его нечем. " +
          "Вызовите start_login и пройдите подключение заново.",
      );
    }
    const refreshed = await this.refresh(stored.refresh_token);
    return refreshed.access_token;
  }

  /**
   * Re-mints the access token from the stored refresh token. Called on expiry and
   * once more when the API answers 401 — a token can be revoked in Yandex ID
   * long before `expires_at`, and only the API knows that.
   */
  async refresh(refreshToken?: string): Promise<StoredCredentials> {
    const token = refreshToken ?? readCredentials()?.refresh_token;
    if (!token) {
      throw new AuthRequiredError(
        "Нет refresh-токена для обновления доступа — вызовите start_login заново.",
      );
    }
    const response = await refreshTokens({
      refreshToken: token,
      clientId: oauthClientId(),
      fetchImpl: this.fetchImpl,
    });
    // Yandex may omit refresh_token when it does not rotate it. Keep the one that
    // just worked — overwriting it with undefined would strand the user at the
    // next expiry with a re-login for no reason.
    return this.save({ ...response, refresh_token: response.refresh_token ?? token });
  }

  /** True when a stored refresh token exists — i.e. a retry after 401 is worth trying. */
  canRefresh(): boolean {
    return !this.envToken && Boolean(readCredentials()?.refresh_token);
  }

  /** Persists a token response; returns what was stored (never logged). */
  save(response: TokenResponse, now = Date.now()): StoredCredentials {
    const credentials: StoredCredentials = {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: expiresAtFrom(response.expires_in, now),
      obtained_at: now,
    };
    writeCredentials(credentials);
    return credentials;
  }

  logout(): boolean {
    return clearCredentials();
  }

  status(): AuthStatus {
    const stored = readCredentials();
    const path = credentialsPath();
    if (this.envToken) {
      return { configured: true, source: "env", canRefresh: false, path };
    }
    if (!stored) return { configured: false, canRefresh: false, path };
    // The file may be hand-written or from another tool: no field but
    // access_token is guaranteed, and new Date(bad).toISOString() throws.
    const expiresAt = isoDate(stored.expires_at);
    const obtainedAt = isoDate(stored.obtained_at);
    const unreadableFields = (["expires_at", "obtained_at"] as const).filter(
      (field) => stored[field] !== undefined && stored[field] !== null && !epochMs(stored[field]),
    );
    return {
      configured: true,
      source: "stored",
      expiresAt,
      obtainedAt,
      unreadableFields: unreadableFields.length > 0 ? unreadableFields : undefined,
      canRefresh: Boolean(stored.refresh_token),
      path,
      note: expiresAt
        ? undefined
        : "Срок действия сохранённого токена неизвестен: в файле нет читаемого expires_at. " +
          "Если инструменты ответят ошибкой авторизации, пройдите start_login и finish_login заново.",
    };
  }
}

/** The value as epoch ms when it is a number Date can represent, otherwise undefined. */
function epochMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function isoDate(value: unknown): string | undefined {
  const ms = epochMs(value);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function expiresAtFrom(expiresIn: unknown, now: number): number | undefined {
  return typeof expiresIn === "number" && expiresIn > 0 ? epochMs(now + expiresIn * 1000) : undefined;
}

/** An unknown expiry is not an expiry: the API's 401 triggers the refresh instead. */
function isExpired(stored: StoredCredentials, now = Date.now()): boolean {
  const expiresAt = epochMs(stored.expires_at);
  if (expiresAt === undefined) return false;
  return expiresAt - REFRESH_LEEWAY_MS <= now;
}

import type { DeviceType, QueryIndicator, QueryOrder, VerificationType, WebmasterConfig } from "./types.js";
import { WebmasterError } from "./types.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

/** Query-string values: scalars pass through, arrays become repeated params, undefined is dropped. */
export type QueryParams = Record<string, string | number | Array<string | number> | undefined>;

/** Normalized inputs for the popular-queries report. */
export interface PopularQueriesParams {
  hostId?: string;
  orderBy: QueryOrder;
  queryIndicators?: QueryIndicator[];
  deviceTypeIndicator?: DeviceType;
  dateFrom?: string;
  dateTo?: string;
  offset?: number;
  limit?: number;
}

/** Normalized inputs for the all-queries history report. */
export interface QueriesHistoryParams {
  hostId?: string;
  queryIndicators?: QueryIndicator[];
  deviceTypeIndicator?: DeviceType;
  dateFrom?: string;
  dateTo?: string;
}

/** Normalized inputs for the sitemap list. */
export interface SitemapsParams {
  hostId?: string;
  parentId?: string;
  limit?: number;
  from?: string;
}

/** Maps a normalized device bucket to the API's wire value. */
function mapDeviceType(d: DeviceType): string {
  return {
    all: "ALL",
    desktop: "DESKTOP",
    mobile_and_tablet: "MOBILE_AND_TABLET",
    mobile: "MOBILE",
    tablet: "TABLET",
  }[d];
}

/** Maps a normalized query indicator to the API's wire value. */
function mapIndicator(i: QueryIndicator): string {
  return {
    total_shows: "TOTAL_SHOWS",
    total_clicks: "TOTAL_CLICKS",
    avg_show_position: "AVG_SHOW_POSITION",
    avg_click_position: "AVG_CLICK_POSITION",
  }[i];
}

/** Maps a normalized sort order to the API's wire value. */
function mapOrder(o: QueryOrder): string {
  return { total_shows: "TOTAL_SHOWS", total_clicks: "TOTAL_CLICKS" }[o];
}

/** Maps a normalized verification method to the API's wire value. */
function mapVerificationType(v: VerificationType): string {
  return { dns: "DNS", html_file: "HTML_FILE", meta_tag: "META_TAG" }[v];
}

export class WebmasterClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  /** Lazy cache for the token owner's user id (see {@link userId}). */
  private userIdCache?: Promise<number>;

  constructor(private readonly config: WebmasterConfig) {
    this.base = config.apiBase.endsWith("/") ? config.apiBase : config.apiBase + "/";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `OAuth ${this.config.token}`,
      Accept: "application/json",
    };
    if (hasBody) h["Content-Type"] = "application/json";
    return h;
  }

  /** Backoff before a retry: honors Retry-After when present, else exponential (capped at 30s). */
  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = res ? Number(res.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30_000);
  }

  /**
   * fetch with an AbortController timeout. Reads the response body inside the
   * guarded zone so the timeout also covers a slow or drip-feeding body, not just
   * the initial headers, and returns the text alongside the response.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request to "${label}" timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Low-level request to a Webmaster API path relative to the /v4 base (e.g.
   * "user" or "user/123/hosts"). Retries 429 always; 5xx and network
   * errors/timeouts only for idempotent (GET) requests — the API has writes
   * (add site/sitemap, recrawl, verification) and a 502 after a committed write
   * must not duplicate it. Any other non-2xx throws a {@link WebmasterError}.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown>,
    query?: QueryParams,
  ): Promise<T> {
    // Guard method !== "GET" keeps undici from crashing on a GET-with-body.
    const hasBody = body !== undefined && method !== "GET";

    // Resolve the path against the API base, then reject anything that escaped to a
    // foreign origin (an absolute "https://evil/x" or a "\\evil/x" slipped through
    // raw_request) so the OAuth token can never leak to another host.
    const url = new URL(path.replace(/^\//, ""), this.base);
    if (url.origin !== new URL(this.base).origin) {
      throw new Error(`raw_request path must be a relative API path (resolved to foreign origin ${url.origin})`);
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) {
          url.searchParams.append(key, String(item));
        }
      }
    }
    const target = url.toString();

    const idempotent = method === "GET";

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(
          target,
          {
            method,
            headers: this.headers(hasBody),
            body: hasBody ? JSON.stringify(body) : undefined,
          },
          path,
        ));
      } catch (err) {
        // Network error or timeout: retry idempotent requests with backoff; on the
        // last attempt (or a non-idempotent method) rethrow the original error.
        if (idempotent && attempt < this.maxRetries) {
          await delay(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      // A 429 never committed anything, so it is safe to retry even for writes;
      // 5xx might have — gate those (and network errors above) to GET.
      const transient = res.status === 429 || (idempotent && res.status >= 500 && res.status < 600);
      if (transient && attempt < this.maxRetries) {
        await delay(this.backoffMs(attempt, res));
        continue;
      }

      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) throw new WebmasterError(res.status, data);
      return data as T;
    }
  }

  /**
   * The token owner's user id every /user/{user-id}/... path needs. Taken from
   * the config when set, otherwise fetched once via GET /v4/user and cached as a
   * promise (which also dedupes concurrent calls). A failed fetch is not cached.
   */
  async userId(): Promise<number> {
    if (this.config.userId !== undefined) return this.config.userId;
    if (!this.userIdCache) {
      this.userIdCache = this.request<{ user_id?: unknown }>("GET", "user")
        .then((data) => {
          const id = data?.user_id;
          if (typeof id !== "number") {
            throw new Error(`GET /user returned no numeric user_id: ${JSON.stringify(data).slice(0, 200)}`);
          }
          return id;
        })
        .catch((err) => {
          this.userIdCache = undefined;
          throw err;
        });
    }
    return this.userIdCache;
  }

  /**
   * Builds "user/{user-id}/hosts/{host-id}{suffix}". The host id comes from the
   * call or from the config default; missing both fails fast, before any fetch.
   * The host id is URL-encoded — it contains colons and comes from user input.
   */
  private async hostPath(hostId: string | undefined, suffix = ""): Promise<string> {
    const host = hostId ?? this.config.hostId;
    if (!host) {
      throw new Error(
        "host_id is required: pass it in the tool arguments (see list_sites) or set YANDEX_WEBMASTER_HOST_ID",
      );
    }
    const uid = await this.userId();
    return `user/${uid}/hosts/${encodeURIComponent(host)}${suffix}`;
  }

  /** GET /v4/user — the token owner's user id (uncached passthrough for the tool). */
  async user(): Promise<unknown> {
    return this.request("GET", "user");
  }

  /** GET /hosts — the user's sites with host_id, URLs, verification and main mirror. */
  async listSites(): Promise<unknown> {
    const uid = await this.userId();
    return this.request("GET", `user/${uid}/hosts`);
  }

  /** POST /hosts — add a site to the user's Webmaster list. */
  async addSite(p: { hostUrl: string }): Promise<unknown> {
    const uid = await this.userId();
    return this.request("POST", `user/${uid}/hosts`, { host_url: p.hostUrl });
  }

  /** GET /hosts/{host-id}/summary — SQI, page counts and problem counts. */
  async siteSummary(p: { hostId?: string }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/summary"));
  }

  /** GET /hosts/{host-id}/verification — verification state and the UIN code. */
  async verificationStatus(p: { hostId?: string }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/verification"));
  }

  /** POST /hosts/{host-id}/verification?verification_type=... — start a verification check. */
  async startVerification(p: { hostId?: string; verificationType: VerificationType }): Promise<unknown> {
    return this.request("POST", await this.hostPath(p.hostId, "/verification"), undefined, {
      verification_type: mapVerificationType(p.verificationType),
    });
  }

  /** GET /hosts/{host-id}/search-queries/popular — top queries by shows/clicks. */
  async popularQueries(p: PopularQueriesParams): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/search-queries/popular"), undefined, {
      order_by: mapOrder(p.orderBy),
      query_indicator: p.queryIndicators?.map(mapIndicator),
      device_type_indicator: p.deviceTypeIndicator ? mapDeviceType(p.deviceTypeIndicator) : undefined,
      date_from: p.dateFrom,
      date_to: p.dateTo,
      offset: p.offset,
      limit: p.limit,
    });
  }

  /** GET /hosts/{host-id}/search-queries/all/history — site-wide query indicators over time. */
  async searchQueriesHistory(p: QueriesHistoryParams): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/search-queries/all/history"), undefined, {
      query_indicator: p.queryIndicators?.map(mapIndicator),
      device_type_indicator: p.deviceTypeIndicator ? mapDeviceType(p.deviceTypeIndicator) : undefined,
      date_from: p.dateFrom,
      date_to: p.dateTo,
    });
  }

  /** GET /hosts/{host-id}/sitemaps — sitemap files known to the robot (cursor pagination). */
  async listSitemaps(p: SitemapsParams): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/sitemaps"), undefined, {
      parent_id: p.parentId,
      limit: p.limit,
      from: p.from,
    });
  }

  /** POST /hosts/{host-id}/user-added-sitemaps — add a sitemap by URL. */
  async addSitemap(p: { hostId?: string; url: string }): Promise<unknown> {
    return this.request("POST", await this.hostPath(p.hostId, "/user-added-sitemaps"), { url: p.url });
  }

  /** GET /hosts/{host-id}/indexing/history — crawled pages by HTTP code over time. */
  async indexingHistory(p: { hostId?: string; dateFrom?: string; dateTo?: string }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/indexing/history"), undefined, {
      date_from: p.dateFrom,
      date_to: p.dateTo,
    });
  }

  /** GET /hosts/{host-id}/diagnostics — detected site problems with severity and state. */
  async siteDiagnostics(p: { hostId?: string }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/diagnostics"));
  }

  /** GET /hosts/{host-id}/links/external/samples — sample external links to the site. */
  async externalLinks(p: { hostId?: string; offset?: number; limit?: number }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/links/external/samples"), undefined, {
      offset: p.offset,
      limit: p.limit,
    });
  }

  /** POST /hosts/{host-id}/recrawl/queue — queue a page for recrawl. */
  async recrawlUrl(p: { hostId?: string; url: string }): Promise<unknown> {
    return this.request("POST", await this.hostPath(p.hostId, "/recrawl/queue"), { url: p.url });
  }

  /** GET /hosts/{host-id}/important-urls — monitored pages with indexing/search status. */
  async importantUrls(p: { hostId?: string }): Promise<unknown> {
    return this.request("GET", await this.hostPath(p.hostId, "/important-urls"));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

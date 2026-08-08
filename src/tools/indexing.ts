import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebmasterClient } from "../client.js";
import { fail, hostId, isoDate, ok, READ_ONLY, WRITE } from "./util.js";

/** Tools for crawling and indexing: history, recrawl queue, important pages and sitemaps. */
export function registerIndexingTools(server: McpServer, client: WebmasterClient): void {
  server.registerTool(
    "get_indexing_history",
    {
      title: "История обхода сайта",
      annotations: READ_ONLY,
      description:
        "Возвращает историю обхода сайта роботом: indicators — объект с массивами точек {date, value} по " +
        "ключам HTTP_2XX, HTTP_3XX, HTTP_4XX, HTTP_5XX и OTHER (неподдерживаемый код или ошибка соединения). " +
        "Показывает, сколько страниц робот загрузил и с какими кодами. По умолчанию — данные за текущий день; " +
        "период задаётся date_from/date_to. Требует подтверждённых прав на сайт.",
      inputSchema: {
        host_id: hostId(),
        date_from: isoDate().optional().describe("Начало периода (ISO 8601)."),
        date_to: isoDate().optional().describe("Конец периода (ISO 8601)."),
      },
    },
    async ({ host_id, date_from, date_to }) => {
      try {
        return ok(await client.indexingHistory({ hostId: host_id, dateFrom: date_from, dateTo: date_to }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "recrawl_url",
    {
      title: "Отправить страницу на переобход",
      annotations: WRITE,
      description:
        "Отправляет страницу сайта в очередь на переобход роботом («Переобход страниц»). Возвращает " +
        "{task_id: UUID, quota_remainder: остаток суточной квоты} со статусом 202. Квота на сайт суточная " +
        "и зависит от сайта — показывайте пользователю quota_remainder. Ошибки: 400 INVALID_URL — URL не " +
        "принадлежит сайту или некорректен; 409 URL_ALREADY_ADDED — страница уже в очереди; " +
        "429 QUOTA_EXCEEDED — суточная квота исчерпана, попробуйте завтра.",
      inputSchema: {
        host_id: hostId(),
        url: z
          .string()
          .url("url должен быть полным URL страницы, напр. https://example.com/page")
          .describe("Полный URL страницы этого сайта, напр. «https://example.com/page»."),
      },
    },
    async ({ host_id, url }) => {
      try {
        return ok(await client.recrawlUrl({ hostId: host_id, url }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_important_urls",
    {
      title: "Мониторинг важных страниц",
      annotations: READ_ONLY,
      description:
        "Возвращает отслеживаемые «важные страницы» сайта: urls — массив {url, update_date, " +
        "change_indicators (что изменилось: INDEXING_HTTP_CODE/SEARCH_STATUS/TITLE/DESCRIPTION), " +
        "indexing_status {status, http_code, access_date} и search_status {title, description, searchable, " +
        "excluded_url_status, target_url, ...}}. Список страниц настраивается в интерфейсе Вебмастера. " +
        "Требует подтверждённых прав на сайт.",
      inputSchema: { host_id: hostId() },
    },
    async ({ host_id }) => {
      try {
        return ok(await client.importantUrls({ hostId: host_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_sitemaps",
    {
      title: "Список sitemap",
      annotations: READ_ONLY,
      description:
        "Возвращает sitemap-файлы сайта, известные роботу: sitemaps — массив {sitemap_id, sitemap_url, " +
        "last_access_date, errors_count, urls_count, children_count, sources (ROBOTS_TXT/WEBMASTER/" +
        "INDEX_SITEMAP), sitemap_type (SITEMAP/INDEX_SITEMAP)}. Пагинация курсором: передайте в from " +
        "последний sitemap_id предыдущей страницы; дерево индексных sitemap обходится через parent_id. " +
        "Требует подтверждённых прав на сайт.",
      inputSchema: {
        host_id: hostId(),
        parent_id: z
          .string()
          .min(1)
          .optional()
          .describe("ID родительского индексного sitemap — вернуть его дочерние файлы."),
        limit: z.number().int().min(1).max(100).optional().describe("Размер страницы (1..100, по умолчанию 10)."),
        from: z
          .string()
          .min(1)
          .optional()
          .describe("Курсор: sitemap_id, ПОСЛЕ которого продолжить выборку."),
      },
    },
    async ({ host_id, parent_id, limit, from }) => {
      try {
        return ok(await client.listSitemaps({ hostId: host_id, parentId: parent_id, limit, from }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_sitemap",
    {
      title: "Добавить sitemap",
      annotations: WRITE,
      description:
        "Добавляет sitemap-файл вручную (аналог раздела «Файлы Sitemap» в интерфейсе Вебмастера). " +
        "Возвращает {\"sitemap_id\": строка} со статусом 201. Ошибка 409 SITEMAP_ALREADY_ADDED — такой " +
        "sitemap уже добавлен. Требует подтверждённых прав на сайт.",
      inputSchema: {
        host_id: hostId(),
        url: z
          .string()
          .url("url должен быть полным URL sitemap-файла")
          .describe("Полный URL sitemap-файла, напр. «https://example.com/sitemap.xml»."),
      },
    },
    async ({ host_id, url }) => {
      try {
        return ok(await client.addSitemap({ hostId: host_id, url }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

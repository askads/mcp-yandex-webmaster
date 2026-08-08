import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebmasterClient } from "../client.js";
import { deviceTypeEnum, fail, hostId, isoDate, ok, queryIndicatorEnum, READ_ONLY } from "./util.js";

const queryIndicators = () =>
  z
    .array(queryIndicatorEnum)
    .optional()
    .describe(
      "Какие показатели вернуть: total_shows (показы), total_clicks (клики), avg_show_position " +
        "(средняя позиция показа), avg_click_position (средняя позиция клика). Можно несколько.",
    );

const deviceType = () =>
  deviceTypeEnum
    .optional()
    .describe("Фильтр по устройствам: all (по умолчанию), desktop, mobile_and_tablet, mobile, tablet.");

/** Tools for search-query analytics: the popular top and site-wide history. */
export function registerQueryTools(server: McpServer, client: WebmasterClient): void {
  server.registerTool(
    "get_popular_queries",
    {
      title: "Популярные поисковые запросы",
      annotations: READ_ONLY,
      description:
        "Возвращает ТОП поисковых запросов сайта за период: queries — массив {query_id, query_text, " +
        "indicators: {TOTAL_SHOWS, TOTAL_CLICKS, AVG_SHOW_POSITION, AVG_CLICK_POSITION}}, плюс date_from/" +
        "date_to и count. В топ попадает до 3000 запросов за последнюю неделю, выдача — до 500 за раз " +
        "(листайте offset/limit). По умолчанию период — последняя неделя. Требует подтверждённых прав; " +
        "404 HOST_NOT_INDEXED — сайт ещё не проиндексирован.",
      inputSchema: {
        host_id: hostId(),
        order_by: z
          .enum(["total_shows", "total_clicks"])
          .describe("Сортировка топа: total_shows (по показам) или total_clicks (по кликам)."),
        query_indicators: queryIndicators(),
        device_type_indicator: deviceType(),
        date_from: isoDate().optional().describe("Начало периода (ISO 8601). По умолчанию — последняя неделя."),
        date_to: isoDate().optional().describe("Конец периода (ISO 8601). По умолчанию — сегодня."),
        offset: z.number().int().min(0).optional().describe("Смещение выдачи (>= 0, по умолчанию 0)."),
        limit: z.number().int().min(1).max(500).optional().describe("Размер страницы (1..500, по умолчанию 500)."),
      },
    },
    async ({ host_id, order_by, query_indicators, device_type_indicator, date_from, date_to, offset, limit }) => {
      try {
        return ok(
          await client.popularQueries({
            hostId: host_id,
            orderBy: order_by,
            queryIndicators: query_indicators,
            deviceTypeIndicator: device_type_indicator,
            dateFrom: date_from,
            dateTo: date_to,
            offset,
            limit,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_search_queries_history",
    {
      title: "История показателей запросов",
      annotations: READ_ONLY,
      description:
        "Возвращает историю суммарных показателей по ВСЕМ поисковым запросам сайта: indicators — объект, " +
        "где ключ — показатель (TOTAL_SHOWS и т.д.), значение — массив точек {date, value}. Подходит для " +
        "динамики видимости сайта: показы, клики и средние позиции по датам. По умолчанию период — " +
        "последняя неделя. Требует подтверждённых прав на сайт.",
      inputSchema: {
        host_id: hostId(),
        query_indicators: queryIndicators(),
        device_type_indicator: deviceType(),
        date_from: isoDate().optional().describe("Начало периода (ISO 8601). По умолчанию — последняя неделя."),
        date_to: isoDate().optional().describe("Конец периода (ISO 8601). По умолчанию — сегодня."),
      },
    },
    async ({ host_id, query_indicators, device_type_indicator, date_from, date_to }) => {
      try {
        return ok(
          await client.searchQueriesHistory({
            hostId: host_id,
            queryIndicators: query_indicators,
            deviceTypeIndicator: device_type_indicator,
            dateFrom: date_from,
            dateTo: date_to,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}

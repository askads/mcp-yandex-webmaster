import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebmasterClient } from "../client.js";
import { fail, hostId, ok, READ_ONLY } from "./util.js";

/** Tools for the site's link profile. */
export function registerLinkTools(server: McpServer, client: WebmasterClient): void {
  server.registerTool(
    "get_external_links",
    {
      title: "Внешние ссылки на сайт",
      annotations: READ_ONLY,
      description:
        "Возвращает примеры внешних ссылок на сайт: count — общее число ссылок (int64, может прийти " +
        "строкой) и links — массив {source_url (откуда ссылаются), destination_url (куда), discovery_date, " +
        "source_last_access_date}. Листайте offset/limit. Требует подтверждённых прав на сайт.",
      inputSchema: {
        host_id: hostId(),
        offset: z.number().int().min(0).optional().describe("Смещение выдачи (>= 0, по умолчанию 0)."),
        limit: z.number().int().min(1).max(100).optional().describe("Размер страницы (1..100, по умолчанию 10)."),
      },
    },
    async ({ host_id, offset, limit }) => {
      try {
        return ok(await client.externalLinks({ hostId: host_id, offset, limit }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

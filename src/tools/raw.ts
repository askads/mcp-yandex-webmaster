import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HttpMethod, WebmasterClient } from "../client.js";
import { DESTRUCTIVE, fail, ok } from "./util.js";

export function registerRawTool(server: McpServer, client: WebmasterClient): void {
  server.registerTool(
    "raw_request",
    {
      // The Webmaster API has write and DELETE endpoints reachable through this
      // hatch (delete site, delete sitemap), hence the destructive annotation.
      annotations: DESTRUCTIVE,
      title: "Прямой вызов Webmaster API",
      description:
        "Прямой вызов любого пути Yandex Webmaster API v4 — для эндпоинтов без отдельного инструмента " +
        "(информация о sitemap, квота переобхода GET user/{user-id}/hosts/{host-id}/recrawl/quota, статус " +
        "задачи переобхода, владельцы сайта, удаление сайта/sitemap и т.п.). Путь указывается относительно " +
        "/v4, напр. «user/{user-id}/hosts» — плейсхолдер {user-id} сервер подставит сам. Query-параметры " +
        "можно включить прямо в path («...?limit=20»). body отправляется как JSON и используется только " +
        "с POST. ВНИМАНИЕ: DELETE удаляет безвозвратно.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Путь API относительно /v4, напр. «user/{user-id}/hosts/https%3Aexample.com%3A443/recrawl/quota». " +
              "{user-id} подставляется автоматически.",
          ),
        method: z
          .enum(["GET", "POST", "DELETE"])
          .optional()
          .describe("HTTP-метод. По умолчанию GET."),
        body: z.record(z.any()).optional().describe("JSON-тело запроса (только для POST)."),
      },
    },
    async ({ path, method, body }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        const resolved = /\{user[-_]id\}/.test(path)
          ? path.replace(/\{user[-_]id\}/g, String(await client.userId()))
          : path;
        return ok(await client.request(m, resolved, body));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebmasterClient } from "../client.js";
import { fail, hostId, ok, READ_ONLY, WRITE } from "./util.js";

/** Tools for the user's sites: list/add, summary, verification and diagnostics. */
export function registerHostTools(server: McpServer, client: WebmasterClient): void {
  server.registerTool(
    "get_user_id",
    {
      title: "ID пользователя",
      annotations: READ_ONLY,
      description:
        "Возвращает идентификатор пользователя (user_id) — владельца OAuth-токена: {\"user_id\": число}. " +
        "Сервер подставляет user_id во все остальные вызовы автоматически, так что обычно этот инструмент " +
        "нужен только для диагностики (например, чтобы задать YANDEX_USER_ID) или для путей raw_request.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.user());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_sites",
    {
      title: "Список сайтов",
      annotations: READ_ONLY,
      description:
        "Возвращает список сайтов пользователя в Яндекс Вебмастере: массив hosts с полями host_id " +
        "(идентификатор вида «https:example.com:443» — он нужен всем остальным инструментам), " +
        "ascii_host_url/unicode_host_url, verified (подтверждены ли права) и main_mirror (главное зеркало, " +
        "если сайт — не главное). С этого инструмента стоит начинать любую работу с Вебмастером.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.listSites());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_site",
    {
      title: "Добавить сайт",
      annotations: WRITE,
      description:
        "Добавляет сайт в список пользователя в Яндекс Вебмастере. Возвращает {\"host_id\": строка}. " +
        "После добавления права на сайт нужно подтвердить (get_verification_status → start_verification). " +
        "Ошибки: 409 HOST_ALREADY_ADDED — сайт уже в списке; 403 HOSTS_LIMIT_EXCEEDED — превышен лимит сайтов.",
      inputSchema: {
        host_url: z
          .string()
          .url("host_url должен быть полным URL, напр. https://example.com")
          .describe("URI добавляемого сайта, напр. «https://example.com»."),
      },
    },
    async ({ host_url }) => {
      try {
        return ok(await client.addSite({ hostUrl: host_url }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_site_summary",
    {
      title: "Сводка по сайту",
      annotations: READ_ONLY,
      description:
        "Возвращает сводную статистику сайта: sqi (ИКС — индекс качества сайта), searchable_pages_count " +
        "(страницы в поиске), excluded_pages_count (исключённые страницы) и site_problems — число проблем " +
        "по категориям FATAL/CRITICAL/POSSIBLE_PROBLEM/RECOMMENDATION. Требует подтверждённых прав на сайт.",
      inputSchema: { host_id: hostId() },
    },
    async ({ host_id }) => {
      try {
        return ok(await client.siteSummary({ hostId: host_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_verification_status",
    {
      title: "Статус подтверждения прав",
      annotations: READ_ONLY,
      description:
        "Возвращает состояние подтверждения прав на сайт: verification_state (NONE/VERIFIED/IN_PROGRESS/" +
        "VERIFICATION_FAILED/INTERNAL_ERROR), verification_type, verification_uin — код UIN, который нужно " +
        "разместить на сайте перед запуском start_verification, applicable_verifiers (доступные способы), " +
        "latest_verification_time и fail_info при неудаче.",
      inputSchema: { host_id: hostId() },
    },
    async ({ host_id }) => {
      try {
        return ok(await client.verificationStatus({ hostId: host_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "start_verification",
    {
      title: "Запустить подтверждение прав",
      annotations: WRITE,
      description:
        "Запускает проверку прав на сайт выбранным способом. Перед вызовом разместите UIN-код из " +
        "get_verification_status: dns — TXT-запись «yandex-verification: <UIN>»; html_file — файл " +
        "yandex_<UIN>.html в корне сайта; meta_tag — <meta name=\"yandex-verification\" content=\"<UIN>\"> " +
        "на главной. Ответ — как у get_verification_status (verification_state обычно IN_PROGRESS). " +
        "Ошибка 409 VERIFICATION_ALREADY_IN_PROGRESS — проверка уже идёт.",
      inputSchema: {
        host_id: hostId(),
        verification_type: z
          .enum(["dns", "html_file", "meta_tag"])
          .describe("Способ подтверждения: dns (TXT-запись), html_file (файл в корне) или meta_tag (мета-тег)."),
      },
    },
    async ({ host_id, verification_type }) => {
      try {
        return ok(await client.startVerification({ hostId: host_id, verificationType: verification_type }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_site_diagnostics",
    {
      title: "Диагностика сайта",
      annotations: READ_ONLY,
      description:
        "Возвращает диагностику сайта — объект problems, где ключ — тип проблемы, а значение — " +
        "{severity: FATAL/CRITICAL/POSSIBLE_PROBLEM/RECOMMENDATION, state: PRESENT/ABSENT/UNDEFINED, " +
        "last_state_update}. Показывает, что именно Вебмастер считает проблемой сайта прямо сейчас. " +
        "Требует подтверждённых прав на сайт.",
      inputSchema: { host_id: hostId() },
    },
    async ({ host_id }) => {
      try {
        return ok(await client.siteDiagnostics({ hostId: host_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

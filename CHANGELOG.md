# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

## [1.0.1] — 2026-08-12

### Добавлено

- Инструкции сервера. В ответе MCP `initialize` теперь едет короткая справка для вызывающей
  модели: чем этот API является и чем не является, чего он не умеет, а также квоты, правила
  повторов и обманчивые ошибки, влияющие на то, как им пользоваться. Раньше это знание жило
  только в README, который модель не читает.

## [1.0.0] — 2026-08-11

### Изменено

- Объявлен стабильным. Набор инструментов, схемы входных данных и переменные окружения версии
  0.1.x переносятся без изменений — релиз фиксирует стабильность API, а не новое поведение.

## [0.1.0] — 2026-08-09

### Добавлено
- Первый рабочий релиз (вместо npm-заглушки 0.0.1). MCP-сервер для Yandex Webmaster
  API v4 (OAuth-токен, авто-определение `user_id` через `GET /v4/user` с кешем),
  16 инструментов:
  - сайты и права: `get_user_id`, `list_sites`, `add_site`, `get_site_summary`,
    `get_verification_status`, `start_verification`, `get_site_diagnostics`;
  - поисковые запросы: `get_popular_queries`, `get_search_queries_history`;
  - индексация и sitemap: `get_indexing_history`, `recrawl_url`,
    `list_important_urls`, `list_sitemaps`, `add_sitemap`;
  - ссылки: `get_external_links`;
  - escape hatch: `raw_request` (GET/POST/DELETE, подстановка `{user-id}`,
    SSRF-гард на относительные пути).
- Ретраи с бэкоффом (учёт `Retry-After`): 429 — кроме `QUOTA_EXCEEDED` (суточную
  квоту переобхода бэкофф не вернёт), 5xx/сетевые — только для чтения (запись
  после 5xx не дублируется); таймаут покрывает и чтение тела;
  `WebmasterError(status, body)` с разбором `{error_code, error_message}` и
  подсказками для `HOST_NOT_VERIFIED` / `HOST_NOT_LOADED` / `HOST_NOT_INDEXED` /
  `QUOTA_EXCEEDED`.
- Аннотации на каждом туле: `READ_ONLY` / `WRITE` (создающие операции) /
  `DESTRUCTIVE` (`raw_request` — через него доступны DELETE-ручки).
- Анонимная телеметрия использования (`server_start`, `tool_call`,
  `startup_failed`; отключение `ASKADS_TELEMETRY=0`).
- Тесты: клиент (маппинг wire-значений, кеш user_id, ретраи, таймаут, SSRF),
  тулы, аннотации (закреплённая карта тул → хинты), конфиг (reason-коды),
  телеметрия и dist-smoke с реальным MCP-хендшейком по stdio.
- Документация: README, docs/TOOLS.md, docs/DEVELOPMENT.md, docs/PUBLISHING.md,
  CLAUDE.md; server.json + glama.json; CI (Node 20/22/24) и ежедневный health-check.

[Unreleased]: https://github.com/askads/mcp-yandex-webmaster/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/askads/mcp-yandex-webmaster/releases/tag/v1.0.1
[1.0.0]: https://github.com/askads/mcp-yandex-webmaster/releases/tag/v1.0.0
[0.1.0]: https://github.com/askads/mcp-yandex-webmaster/releases/tag/v0.1.0

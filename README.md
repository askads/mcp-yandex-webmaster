# Yandex Webmaster MCP

[![npm](https://img.shields.io/npm/v/mcp-yandex-webmaster)](https://www.npmjs.com/package/mcp-yandex-webmaster)
[![CI](https://github.com/askads/mcp-yandex-webmaster/actions/workflows/ci.yml/badge.svg)](https://github.com/askads/mcp-yandex-webmaster/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP-сервер для **Яндекс Вебмастера**: спрашивайте состояние сайта в поиске Яндекса —
индексацию, поисковые запросы, ИКС, диагностику проблем, sitemap и внешние ссылки — из
Claude, Cursor, Codex и других AI-клиентов на естественном языке.

Ассистент сам находит нужный сайт, сверяет динамику показов и кликов, разбирает проблемы
из «Диагностики», отправляет страницы на переобход и следит за важными страницами — то,
что в вебе Вебмастера приходится собирать по нескольким разделам вручную.

## Быстрый старт

1. [Получите OAuth-токен](#получение-доступа) Яндекса с доступом к Вебмастеру.
2. Добавьте сервер — например, в Claude Code ([другие клиенты](#установка)):

   ```bash
   claude mcp add yandex-webmaster \
     -e YANDEX_OAUTH_TOKEN=ваш_токен \
     -- npx -y mcp-yandex-webmaster
   ```

3. Спросите ассистента: «Какие проблемы Вебмастер видит на моём сайте и как менялись показы за неделю?»

## Что умеет

- **Сайты** — `list_sites` / `add_site`: список сайтов с host_id и статусом прав, добавление нового.
- **Права на сайт** — `get_verification_status` / `start_verification`: UIN-код и запуск проверки
  (DNS-запись, HTML-файл или мета-тег).
- **Сводка и диагностика** — `get_site_summary` (ИКС, страницы в поиске/исключённые, счётчик проблем)
  и `get_site_diagnostics` (какие именно проблемы найдены и какой серьёзности).
- **Поисковые запросы** — `get_popular_queries` (ТОП запросов с показами, кликами и позициями) и
  `get_search_queries_history` (динамика показателей по датам).
- **Индексация** — `get_indexing_history` (обход робота по HTTP-кодам), `recrawl_url`
  (переобход страницы с суточной квотой), `list_important_urls` (мониторинг важных страниц).
- **Sitemap** — `list_sitemaps` / `add_sitemap`.
- **Ссылки** — `get_external_links`: примеры внешних ссылок на сайт.
- **Универсальный `raw_request`** — прямой вызов любого пути API (квота переобхода, статус задачи,
  владельцы сайта, удаление сайта/sitemap и т.д.).
- **Устойчивость** — ретраи на 429 (и на 5xx/сетевые для чтения) с бэкоффом и таймаут запроса;
  понятные подсказки для частых ошибок (`HOST_NOT_VERIFIED`, `HOST_NOT_LOADED`, `HOST_NOT_INDEXED`).

## Примеры запросов

Попросите ассистента на русском — например:

- «Покажи мои сайты в Вебмастере и их ИКС»
- «Какие критичные проблемы сейчас видит диагностика на example.com?»
- «По каким запросам сайт чаще всего показывался за последнюю неделю?»
- «Отправь страницу https://example.com/new-page на переобход»

## Доступ к API

Сервер работает через **Yandex Webmaster API v4** (`api.webmaster.yandex.net/v4`,
авторизация OAuth-токеном Яндекса: заголовок `Authorization: OAuth <токен>`). Токен
выдаётся пользователю Яндекса и открывает те же сайты, что видны этому пользователю в
[веб-интерфейсе Вебмастера](https://webmaster.yandex.ru); для статистики нужны
подтверждённые права на сайт. `user_id` владельца токена сервер определяет сам через
`GET /v4/user` и кеширует.

## Установка

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add yandex-webmaster \
  -e YANDEX_OAUTH_TOKEN=ваш_токен \
  -- npx -y mcp-yandex-webmaster
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "yandex-webmaster": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-webmaster"],
      "env": { "YANDEX_OAUTH_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "yandex-webmaster": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-webmaster"],
      "env": { "YANDEX_OAUTH_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json` — ключ `servers` (не `mcpServers`)

```json
{
  "servers": {
    "yandex-webmaster": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-yandex-webmaster"],
      "env": { "YANDEX_OAUTH_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

## Получение доступа

1. Зарегистрируйте приложение на [oauth.yandex.ru](https://oauth.yandex.ru): «Создать
   приложение», в правах доступа отметьте доступ к **API Яндекс Вебмастера**.
2. Получите OAuth-токен для своего аккаунта — проще всего по
   [инструкции Яндекс OAuth](https://yandex.ru/dev/id/doc/ru/access) (для личного
   использования подойдёт «отладочный» способ: открыть
   `https://oauth.yandex.ru/authorize?response_type=token&client_id=<id_приложения>`
   и скопировать токен из адресной строки).
3. Запишите токен в `YANDEX_OAUTH_TOKEN`. Опционально: `YANDEX_WEBMASTER_HOST_ID` — host_id
   сайта по умолчанию (узнайте его вопросом «покажи мои сайты» или из `list_sites`), чтобы
   не называть сайт в каждом запросе.

⚠️ Токен хранится **открытым текстом** в конфиге клиента — относитесь как к паролю.
Токен даёт доступ ко всем сайтам аккаунта в Вебмастере.

## Настройка

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `YANDEX_OAUTH_TOKEN` | да | — | OAuth-токен Яндекса с доступом к Вебмастеру. |
| `YANDEX_USER_ID` | нет | автоопределение | user_id владельца токена (иначе — через `GET /v4/user`). |
| `YANDEX_WEBMASTER_HOST_ID` | нет | — | host_id сайта по умолчанию, напр. `https:example.com:443`. |
| `YANDEX_WEBMASTER_API_BASE` | нет | `https://api.webmaster.yandex.net/v4` | Корень API (override). |
| `YANDEX_WEBMASTER_TIMEOUT_MS` | нет | `60000` | Таймаут запроса, мс. |
| `YANDEX_WEBMASTER_MAX_RETRIES` | нет | `3` | Повторы при 429 (и 5xx/сетевых для чтения). |

## Требования

- Node.js 20+ (запускается через `npx`, отдельная установка не нужна).
- OAuth-токен Яндекса с доступом к Вебмастеру — см. [Получение доступа](#получение-доступа).

## Ограничения

- **Есть изменяющие операции.** `add_site`, `add_sitemap`, `recrawl_url` и
  `start_verification` меняют состояние (создают, но ничего не удаляют); удаление
  сайта/sitemap доступно только через `raw_request` с методом `DELETE`.
- **Статистика — только для подтверждённых сайтов.** Без прав на сайт API отвечает
  `HOST_NOT_VERIFIED`; сервер подсказывает, что делать.
- **Квоты.** Переобход ограничен суточной квотой на сайт (ответ содержит
  `quota_remainder`; превышение — `429 QUOTA_EXCEEDED`); общий rate limit API отдаёт
  `429 TOO_MANY_REQUESTS_ERROR` — сервер ретраит с бэкоффом.

## Документация

- [Все инструменты](https://github.com/askads/mcp-yandex-webmaster/blob/main/docs/TOOLS.md) — полный список с описанием.
- [Разработка](https://github.com/askads/mcp-yandex-webmaster/blob/main/docs/DEVELOPMENT.md) — сборка, тесты, smoke-проверка.
- [Публикация](https://github.com/askads/mcp-yandex-webmaster/blob/main/docs/PUBLISHING.md) — релиз и листинг в каталогах MCP.

## Смотрите также

- **[Ask Ads](https://askads.ru)** — чат-аналитик и «Сторож» рекламных кабинетов от авторов
  этого сервера: алерты о сливах бюджета и поломках трекинга — в Telegram.
- **[askads/claude-plugins](https://github.com/askads/claude-plugins)** — маркетплейс плагинов
  Claude: серверы Ask Ads ставятся одной командой, токены спрашиваются при включении.
- **[mcp-yandex-wordstat](https://github.com/askads/mcp-yandex-wordstat)** — статистика
  поискового спроса (Вордстат) тем же способом.

## Поддержка

Вопросы, идеи и доработки — пишите в Telegram: [@gistrec](http://t.me/gistrec).

## Лицензия

MIT — см. [LICENSE](./LICENSE).

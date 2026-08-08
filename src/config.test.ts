import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, loadConfig } from "./config.js";

const ALL_VARS = [
  "YANDEX_OAUTH_TOKEN",
  "YANDEX_USER_ID",
  "YANDEX_WEBMASTER_HOST_ID",
  "YANDEX_WEBMASTER_API_BASE",
  "YANDEX_WEBMASTER_TIMEOUT_MS",
  "YANDEX_WEBMASTER_MAX_RETRIES",
];

/**
 * The reason codes below are the vocabulary the dashboard groups by — renaming
 * one silently splits a bar in two, so they are pinned here.
 */
function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const full: Record<string, string | undefined> = Object.fromEntries(ALL_VARS.map((k) => [k, undefined]));
  Object.assign(full, vars);
  const saved = new Map(Object.keys(full).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(full)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function reasonOf(vars: Record<string, string | undefined>): string {
  let caught: unknown;
  withEnv(vars, () => {
    try {
      loadConfig();
    } catch (err) {
      caught = err;
    }
  });
  assert.ok(caught instanceof ConfigError, "config problems must throw ConfigError, not exit");
  return caught.reason;
}

test("a missing OAuth token reports missing_token", () => {
  assert.equal(reasonOf({ YANDEX_OAUTH_TOKEN: undefined }), "missing_token");
});

test("a malformed YANDEX_USER_ID reports invalid_user_id", () => {
  assert.equal(reasonOf({ YANDEX_OAUTH_TOKEN: "tok", YANDEX_USER_ID: "abc" }), "invalid_user_id");
  assert.equal(reasonOf({ YANDEX_OAUTH_TOKEN: "tok", YANDEX_USER_ID: "-5" }), "invalid_user_id");
});

test("a token alone is enough; everything else has a default", () => {
  withEnv({ YANDEX_OAUTH_TOKEN: "tok" }, () => {
    const config = loadConfig();
    assert.equal(config.token, "tok");
    assert.equal(config.userId, undefined);
    assert.equal(config.hostId, undefined);
    assert.equal(config.apiBase, "https://api.webmaster.yandex.net/v4");
    assert.equal(config.timeoutMs, 60_000);
    assert.equal(config.maxRetries, 3);
  });
});

test("optional variables land in the config when set", () => {
  withEnv(
    {
      YANDEX_OAUTH_TOKEN: "tok",
      YANDEX_USER_ID: "123",
      YANDEX_WEBMASTER_HOST_ID: "https:example.com:443",
      YANDEX_WEBMASTER_API_BASE: "http://localhost:8080/v4",
      YANDEX_WEBMASTER_TIMEOUT_MS: "1000",
      YANDEX_WEBMASTER_MAX_RETRIES: "0",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.userId, 123);
      assert.equal(config.hostId, "https:example.com:443");
      assert.equal(config.apiBase, "http://localhost:8080/v4");
      assert.equal(config.timeoutMs, 1000);
      assert.equal(config.maxRetries, 0);
    },
  );
});

test("garbage numbers silently fall back to the defaults", () => {
  withEnv(
    { YANDEX_OAUTH_TOKEN: "tok", YANDEX_WEBMASTER_TIMEOUT_MS: "soon", YANDEX_WEBMASTER_MAX_RETRIES: "-1" },
    () => {
      const config = loadConfig();
      assert.equal(config.timeoutMs, 60_000);
      assert.equal(config.maxRetries, 3);
    },
  );
});

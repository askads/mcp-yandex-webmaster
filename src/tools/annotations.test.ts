import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHostTools } from "./hosts.js";
import { registerQueryTools } from "./queries.js";
import { registerIndexingTools } from "./indexing.js";
import { registerLinkTools } from "./links.js";
import { registerRawTool } from "./raw.js";
import { DESTRUCTIVE, READ_ONLY, WRITE } from "./util.js";

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Registers every tool against a fake server, capturing each tool's annotations. */
function collectAnnotations(): Record<string, Annotations | undefined> {
  const annotations: Record<string, Annotations | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Annotations }) => {
      annotations[name] = cfg.annotations;
    },
  };
  // Registration reads the client only inside handlers, so a stub is fine here.
  registerHostTools(server as never, {} as never);
  registerQueryTools(server as never, {} as never);
  registerIndexingTools(server as never, {} as never);
  registerLinkTools(server as never, {} as never);
  registerRawTool(server as never, {} as never);
  return annotations;
}

const ANN = collectAnnotations();

/**
 * The full tool → hints map, pinned. The Webmaster API has writes, so a single
 * "everything is read-only" invariant would be wrong: adds/recrawl/verification
 * are non-destructive writes and the raw hatch can reach DELETE endpoints.
 */
const EXPECTED: Record<string, Annotations> = {
  get_user_id: READ_ONLY,
  list_sites: READ_ONLY,
  add_site: WRITE,
  get_site_summary: READ_ONLY,
  get_verification_status: READ_ONLY,
  start_verification: WRITE,
  get_site_diagnostics: READ_ONLY,
  get_popular_queries: READ_ONLY,
  get_search_queries_history: READ_ONLY,
  get_indexing_history: READ_ONLY,
  recrawl_url: WRITE,
  list_important_urls: READ_ONLY,
  list_sitemaps: READ_ONLY,
  add_sitemap: WRITE,
  get_external_links: READ_ONLY,
  raw_request: DESTRUCTIVE,
};

test("registers all sixteen tools with annotations", () => {
  assert.deepEqual(Object.keys(ANN).sort(), Object.keys(EXPECTED).sort());
  for (const [name, a] of Object.entries(ANN)) {
    assert.ok(a, `${name} is missing annotations`);
  }
});

test("every tool carries its expected hints, all four set explicitly", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(ANN[name], expected, `${name} annotations drifted`);
  }
});

test("reads are idempotent and non-destructive; writes are neither", () => {
  for (const [name, a] of Object.entries(ANN)) {
    if (a?.readOnlyHint) {
      assert.equal(a.destructiveHint, false, `${name} is read-only, must be non-destructive`);
      assert.equal(a.idempotentHint, true, `${name} is read-only, must be idempotent`);
    } else {
      assert.equal(a?.idempotentHint, false, `${name} is a write, a repeat is a 409 — not idempotent`);
    }
    assert.equal(a?.openWorldHint, true, `${name} should set openWorldHint`);
  }
});

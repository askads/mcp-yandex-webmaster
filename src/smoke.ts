import { AuthRequiredError } from "./auth.js";
import { ConfigError, loadConfig } from "./config.js";
import { WebmasterClient } from "./client.js";

/** Live READ-ONLY smoke check: resolves the user id and lists the user's sites. */
async function main(): Promise<void> {
  const client = new WebmasterClient(loadConfig());
  const result = await client.listSites();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  // A missing or malformed token setup is a user error, not a bug: no stack.
  const userError = err instanceof ConfigError || err instanceof AuthRequiredError;
  console.error("smoke failed:", userError ? err.message : err);
  process.exit(1);
});

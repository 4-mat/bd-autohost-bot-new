// Standalone slash-command registration: `bun run register` (or `npm run
// register`). Registers guild commands when GUILD_ID is set (instant, ideal
// for setup/testing) or global commands otherwise.
import { loadConfig, assertConfig } from "./config.js";
import { registerCommands } from "./commands.js";

try {
  const cfg = assertConfig(loadConfig());
  await registerCommands(cfg);
  console.log("[register] done");
  process.exit(0);
} catch (e) {
  console.error("[register] failed:", (e as Error).message);
  process.exit(1);
}

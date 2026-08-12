// Centralized env config for the bot. All secrets come from the environment
// (Render env vars, .env when running locally via `tsx --env-file` or export).

export interface Config {
  discordToken: string;
  clientId: string;
  guildId?: string;
  githubToken: string;
  githubRepo: string;
  roleId?: string;
  roleName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    discordToken: env.DISCORD_TOKEN ?? "",
    clientId: env.CLIENT_ID ?? "",
    guildId: env.GUILD_ID || undefined,
    githubToken: env.GITHUB_TOKEN ?? "",
    githubRepo: env.GITHUB_REPO || "4-mat/bd-autohost-bot-new",
    roleId: env.ROLE_ID || undefined,
    roleName: env.ROLE_NAME || "super turbo",
  };
}

export function assertConfig(cfg: Config): Config {
  const missing: string[] = [];
  if (!cfg.discordToken) missing.push("DISCORD_TOKEN");
  if (!cfg.clientId) missing.push("CLIENT_ID");
  if (!cfg.githubToken) missing.push("GITHUB_TOKEN");
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  return cfg;
}

import type { GuildMember, Message } from "discord.js";
import type { Config } from "./config.js";

/**
 * Role gate: allow only members holding the configured role (by ID if
 * ROLE_ID is set, otherwise by name). Returns true for authorized members.
 */
export function hasAccessRole(
  cfg: Config,
  member: GuildMember | null | undefined,
): boolean {
  if (!member) return false;
  if (cfg.roleId) {
    return member.roles.cache.has(cfg.roleId);
  }
  const wanted = cfg.roleName.toLowerCase().trim();
  if (!wanted) return true; // no role configured → everyone
  return member.roles.cache.some((r) => r.name.toLowerCase() === wanted);
}

/** Reply helper that works for both slash and message contexts. */
export function unauthorizedReplyText(): string {
  return "You don't have permission to use this bot (requires the configured role).";
}

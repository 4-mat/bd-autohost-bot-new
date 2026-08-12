import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import type { Config } from "./config.js";

/**
 * Role gate: allow only members holding the configured role (by ID if
 * ROLE_ID is set, otherwise by name). Returns true for authorized members.
 *
 * Accepts both the hydrated `GuildMember` (slash/button interactions) and the
 * raw `APIInteractionGuildMember` shape (uncached guilds), whose `roles` is
 * a plain array of role IDs.
 */
export function hasAccessRole(
  cfg: Config,
  member: GuildMember | APIInteractionGuildMember | null | undefined,
): boolean {
  if (!member) return false;

  if (cfg.roleId) {
    // GuildMember -> Role objects (`.cache`); API member -> string[] of IDs.
    if ("cache" in member.roles) return member.roles.cache.has(cfg.roleId);
    return member.roles.includes(cfg.roleId);
  }

  const wanted = cfg.roleName.toLowerCase().trim();
  // Fail closed: a blank role name denies everyone; only the explicit
  // opt-in ROLE_NAME="*" grants access to all members.
  if (!wanted) return false;
  if (wanted === "*") return true;

  if ("cache" in member.roles) {
    return member.roles.cache.some((r) => r.name.toLowerCase() === wanted);
  }
  // API member carries only role IDs — a name check is impossible, so
  // without a role ID configured this member is denied.
  return false;
}

/** Reply helper that works for both slash and message contexts. */
export function unauthorizedReplyText(): string {
  return "You don't have permission to use this bot (requires the configured role).";
}

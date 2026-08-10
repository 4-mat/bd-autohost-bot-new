import {
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from "discord.js";
import type { Config } from "./config.js";

export type CommandJSON = RESTPostAPIContextMenuApplicationCommandsJSONBody;

export const commandDefs = [
  new SlashCommandBuilder()
    .setName("issue")
    .setDescription("Create a GitHub issue on the bot repo")
    .addStringOption((o) =>
      o.setName("title").setDescription("Issue title").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("body").setDescription("Issue body / details").setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("labels")
        .setDescription("Comma-separated labels (e.g. bug, enhancement)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("bug")
    .setDescription("Report a bug (creates a labeled GitHub issue)")
    .addStringOption((o) =>
      o.setName("title").setDescription("Bug title").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("body")
        .setDescription("What happened / steps to reproduce")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("feature")
    .setDescription("Request a feature (creates a labeled GitHub issue)")
    .addStringOption((o) =>
      o.setName("title").setDescription("Feature title").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("body")
        .setDescription("What should it do?")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("map")
    .setDescription("Propose a new map (creates a 'Map: X' issue → PR via the map workflow)")
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("Map id — lowercase letters, digits, - or _ (no spaces)")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("grid")
        .setDescription(
          "The map grid — one row of terrain codes per line, e.g.\n..r..\n.....\n.w+w.\n.....\n..r..",
        )
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("modes")
        .setDescription("Comma-separated game modes (ffa, ntr, jugg, pvp, 1v1)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("ability")
    .setDescription("Propose an Ability Editor change (creates an 'Ability: ...' issue → PR)")
    .addStringOption((o) =>
      o.setName("name").setDescription("Class or weapon name").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("entry")
        .setDescription(
          'JSON for the entry, e.g. {"stats":{"hp":"80","atk":"7"},"description":"...","abilities":[]}',
        )
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("kind")
        .setDescription("class or weapon (default class)")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("add (new entry) or update (existing entry) — default add")
        .setRequired(false),
    ),
].map((c) => c.toJSON());

export async function registerCommands(cfg: Config): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(cfg.discordToken);
  if (cfg.guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
      body: commandDefs,
    });
    console.log(`[commands] registered ${commandDefs.length} guild commands (guild ${cfg.guildId})`);
  } else {
    await rest.put(Routes.applicationCommands(cfg.clientId), {
      body: commandDefs,
    });
    console.log(`[commands] registered ${commandDefs.length} global commands`);
  }
}

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
    .setName("ability")
    .setDescription("Propose an Ability Editor change (creates an 'Ability: ...' issue → PR)")
    .addStringOption((o) =>
      o.setName("name").setDescription("Class or weapon name").setRequired(true),
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
    )
    .addStringOption((o) =>
      o
        .setName("entry")
        .setDescription(
          'JSON for the entry, e.g. {"stats":{"hp":"80","atk":"7"},"description":"...","abilities":[]}',
        )
        .setRequired(true),
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

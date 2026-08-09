import {
  Client,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { loadConfig, assertConfig } from "./config.js";
import { createGithubClient, GithubError } from "./github.js";
import { registerCommands } from "./commands.js";
import { hasAccessRole, unauthorizedReplyText } from "./roles.js";
import {
  buildProposalPayload,
  normalizeKind,
  normalizeMode,
  proposalIssueBody,
  proposalTitle,
} from "./proposal.js";

const cfg = assertConfig(loadConfig());
const github = createGithubClient({
  token: cfg.githubToken,
  repo: cfg.githubRepo,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------------------------------------------------------------------------
// Shared issue-creation logic (used by slash + text handlers)
// ---------------------------------------------------------------------------

async function createPlainIssue(
  title: string,
  body: string,
  labels: string[],
): Promise<string> {
  const issue = await github.createIssue({
    title,
    body: body || undefined,
    labels: labels.length ? labels : undefined,
  });
  return issue.html_url;
}

async function createProposalIssue(
  name: string,
  kindRaw: string,
  modeRaw: string,
  entryRaw: string,
): Promise<string> {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(entryRaw) as Record<string, unknown>;
  } catch {
    throw new Error(
      "The `entry` JSON didn't parse. Use valid JSON, e.g. {\"stats\":{\"hp\":\"80\"},\"abilities\":[]}",
    );
  }
  const kind = normalizeKind(kindRaw);
  const mode = normalizeMode(modeRaw);
  const proposal = { mode, kind, name, entry };
  const payload = buildProposalPayload(proposal);
  const issue = await github.createIssue({
    title: proposalTitle(name),
    body: proposalIssueBody(proposal, payload),
  });
  return issue.html_url;
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function handleSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member;
  if (!hasAccessRole(cfg, member as never)) {
    await interaction.reply({
      content: unauthorizedReplyText(),
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "issue") {
    const title = interaction.options.getString("title", true);
    const body = interaction.options.getString("body") ?? "";
    const labelsRaw = interaction.options.getString("labels") ?? "";
    const labels = labelsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await interaction.deferReply({ ephemeral: false });
    try {
      const url = await createPlainIssue(title, body, labels);
      await interaction.editReply(`✅ Created issue **${title}**\n${url}`);
    } catch (e) {
      const msg = e instanceof GithubError ? e.detail || e.message : (e as Error).message;
      await interaction.editReply(`❌ Could not create issue: ${msg}`);
    }
    return;
  }

  if (interaction.commandName === "ability") {
    const name = interaction.options.getString("name", true);
    const kind = interaction.options.getString("kind") ?? "";
    const mode = interaction.options.getString("mode") ?? "";
    const entry = interaction.options.getString("entry", true);

    await interaction.deferReply({ ephemeral: false });
    try {
      const url = await createProposalIssue(name, kind, mode, entry);
      await interaction.editReply(
        `✅ Proposed **${name}** — this opens an issue that the workflow turns into a PR.\n${url}`,
      );
    } catch (e) {
      const msg = e instanceof GithubError ? e.detail || e.message : (e as Error).message;
      await interaction.editReply(`❌ Could not create proposal: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Plain-text commands (!issue / !ability)
// ---------------------------------------------------------------------------

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith("!issue") && !content.startsWith("!ability")) return;

  const member = message.member;
  if (!hasAccessRole(cfg, member)) {
    await message.reply(unauthorizedReplyText());
    return;
  }

  const rest = content.slice(1).trim(); // strip "!"

  if (rest.startsWith("issue")) {
    const body = rest.slice("issue".length).trim();
    const [title, details] = body.split("|").map((s) => s.trim());
    if (!title) {
      await message.reply("Usage: `!issue <title> | <optional details>`");
      return;
    }
    try {
      const url = await createPlainIssue(title, details ?? "", []);
      await message.reply(`✅ Created issue **${title}**\n${url}`);
    } catch (e) {
      await message.reply(`❌ Could not create issue: ${(e as Error).message}`);
    }
    return;
  }

  if (rest.startsWith("ability")) {
    const body = rest.slice("ability".length).trim();
    const parts = body.split("|").map((s) => s.trim());
    // !ability Name | entry-json [| mode] [| kind]
    const [name, entryRaw, mode = "add", kind = "class"] = parts;
    if (!name || !entryRaw) {
      await message.reply(
        "Usage: `!ability <Name> | <entry JSON> | add|update | class|weapon`",
      );
      return;
    }
    try {
      const url = await createProposalIssue(name, kind, mode, entryRaw);
      await message.reply(
        `✅ Proposed **${name}** — this opens an issue that the workflow turns into a PR.\n${url}`,
      );
    } catch (e) {
      await message.reply(`❌ Could not create proposal: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

client.once("ready", async () => {
  console.log(`[bot] logged in as ${client.user?.tag}`);
  try {
    await registerCommands(cfg);
  } catch (e) {
    console.error("[bot] command registration failed:", (e as Error).message);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlash(interaction);
  } catch (e) {
    console.error("[bot] slash handler error:", (e as Error).message);
    if (!interaction.replied) {
      await interaction
        .reply({ content: "❌ Something went wrong.", ephemeral: true })
        .catch(() => {});
    }
  }
});

client.on("messageCreate", (message) => {
  handleMessage(message).catch((e) =>
    console.error("[bot] message handler error:", (e as Error).message),
  );
});

client.login(cfg.discordToken).catch((e) => {
  console.error("[bot] login failed:", (e as Error).message);
  process.exit(1);
});

import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import { randomUUID } from "node:crypto";
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
import { buildMapProposal } from "./map.js";

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
// Rate limiting (simple per-user cooldown between issue-creating commands)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MS = 10_000;
const lastCommandAt = new Map<string, number>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const last = lastCommandAt.get(userId) ?? 0;
  if (now - last < RATE_LIMIT_MS) return true;
  lastCommandAt.set(userId, now);
  return false;
}

// ---------------------------------------------------------------------------
// Pending confirmations (preview embed + Confirm/Cancel buttons)
// ---------------------------------------------------------------------------

interface PendingAction {
  ownerId: string; // Discord user id of the command invoker
  run: () => Promise<string>; // returns the created issue URL
}

const PENDING_TTL_MS = 2 * 60_000;
const pendingActions = new Map<string, PendingAction>();

function stagePending(ownerId: string, action: () => Promise<string>): string {
  const nonce = randomUUID();
  pendingActions.set(nonce, { ownerId, run: action });
  setTimeout(() => pendingActions.delete(nonce), PENDING_TTL_MS);
  return nonce;
}

function confirmRow(nonce: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm:${nonce}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancel:${nonce}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );
}

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

function friendlyError(e: unknown): string {
  if (e instanceof GithubError) return e.detail || e.message;
  return (e as Error).message;
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

  const userId = interaction.user.id;
  if (rateLimited(userId)) {
    await interaction.reply({
      content: "⏳ Please wait a few seconds between commands.",
      ephemeral: true,
    });
    return;
  }

  const cmd = interaction.commandName;

  // Plain issues (created immediately — low risk).
  if (cmd === "issue" || cmd === "bug" || cmd === "feature") {
    const title = interaction.options.getString("title", true);
    const body = interaction.options.getString("body") ?? "";
    const labels = cmd === "issue"
      ? (interaction.options.getString("labels") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : cmd === "bug"
        ? ["bug"]
        : ["enhancement"];

    await interaction.deferReply({ ephemeral: false });
    try {
      const url = await createPlainIssue(title, body, labels);
      await interaction.editReply(`✅ Created issue **${title}**\n${url}`);
    } catch (e) {
      await interaction.editReply(`❌ Could not create issue: ${friendlyError(e)}`);
    }
    return;
  }

  // Ability proposals (preview + confirm).
  if (cmd === "ability") {
    const name = interaction.options.getString("name", true);
    const kind = normalizeKind(interaction.options.getString("kind"));
    const mode = normalizeMode(interaction.options.getString("mode"));
    const entryRaw = interaction.options.getString("entry", true);

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(entryRaw) as Record<string, unknown>;
    } catch {
      await interaction.reply({
        content:
          "❌ The `entry` JSON didn't parse. Use valid JSON, e.g. {\"stats\":{\"hp\":\"80\"},\"abilities\":[]}",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: false });
    const nonce = stagePending(userId, () =>
      createProposalIssue(name, kind, mode, entryRaw),
    );
    const embed = new EmbedBuilder()
      .setTitle("Confirm ability proposal")
      .setDescription(
        `**${mode === "update" ? "Update" : "Add"}** ${kind} **${name}**\n\nThis opens an issue the editor workflow turns into a PR.`,
      )
      .addFields({
        name: "Entry",
        value: `\`\`\`json\n${JSON.stringify(entry, null, 2).slice(0, 1024)}\n\`\`\``,
      })
      .setColor(0x2b6cb0);
    await interaction.editReply({
      embeds: [embed],
      components: [confirmRow(nonce)],
    });
    return;
  }

  // Map proposals (preview + confirm, validated server-side).
  if (cmd === "map") {
    const name = interaction.options.getString("name", true);
    const modes = interaction.options.getString("modes") ?? "";
    const grid = interaction.options.getString("grid", true);

    let proposal;
    try {
      proposal = buildMapProposal(name, modes, grid);
    } catch (e) {
      await interaction.reply({
        content: `❌ ${friendlyError(e)}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: false });
    const nonce = stagePending(userId, async () => {
      const issue = await github.createIssue({
        title: proposal.title,
        body: proposal.body,
      });
      return issue.html_url;
    });
    const embed = new EmbedBuilder()
      .setTitle("Confirm map proposal")
      .setDescription(
        `**${proposal.name}** (${proposal.rows}×${proposal.cols})${
          proposal.modes.length ? ` · modes: ${proposal.modes.join(", ")}` : ""
        }\n\nThis opens an issue the map workflow turns into a PR.`,
      )
      .addFields({ name: "Map", value: `\`\`\`txt\n${grid.slice(0, 1024)}\n\`\`\`` })
      .setColor(0x38a169);
    await interaction.editReply({
      embeds: [embed],
      components: [confirmRow(nonce)],
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Button confirmations
// ---------------------------------------------------------------------------

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action, nonce] = interaction.customId.split(":");
  const pending = pendingActions.get(nonce);
  if (!pending) {
    await interaction.reply({
      content: "This confirmation expired (2 minutes). Please run the command again.",
      ephemeral: true,
    });
    return;
  }
  // Only the invoker may confirm/cancel their own proposal; also enforce the
  // role gate so a roleless bystander can't click Confirm on a public preview.
  if (interaction.user.id !== pending.ownerId) {
    await interaction.reply({
      content: "Only the person who ran the command can confirm or cancel this.",
      ephemeral: true,
    });
    return;
  }
  const member = interaction.member;
  if (!hasAccessRole(cfg, member as never)) {
    await interaction.reply({
      content: unauthorizedReplyText(),
      ephemeral: true,
    });
    return;
  }
  pendingActions.delete(nonce);
  const { run } = pending;

  if (action === "cancel") {
    await interaction.update({ content: "❌ Cancelled.", embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();
  try {
    const url = await run();
    await interaction.editReply({
      content: `✅ Done — the workflow turns this into a PR.\n${url}`,
      embeds: [],
      components: [],
    });
  } catch (e) {
    await interaction.editReply({
      content: `❌ Could not create: ${friendlyError(e)}`,
      embeds: [],
      components: [],
    });
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

  if (rateLimited(message.author.id)) {
    await message.reply("⏳ Please wait a few seconds between commands.");
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
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
    }
  } catch (e) {
    console.error("[bot] interaction handler error:", (e as Error).message);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
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

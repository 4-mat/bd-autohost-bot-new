import {
  Client,
  Events,
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
  parseEntryJson,
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

/** True while the user is inside the cooldown window. Check only — it never
 *  records a timestamp, so failed input parsing doesn't start a cooldown. */
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  // Prune stale entries so the map can't grow for the worker's lifetime.
  for (const [id, ts] of lastCommandAt) {
    if (now - ts >= RATE_LIMIT_MS) lastCommandAt.delete(id);
  }
  return now - (lastCommandAt.get(userId) ?? 0) < RATE_LIMIT_MS;
}

/** Record that a command reached the issue-creating path (right before the
 *  GitHub write), so the cooldown bounds real GitHub writes, not parsing. */
function recordIssue(userId: string): void {
  lastCommandAt.set(userId, Date.now());
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
  userId: string,
  title: string,
  body: string,
  labels: string[],
): Promise<string> {
  recordIssue(userId);
  const issue = await github.createIssue({
    title,
    body: body || undefined,
    labels: labels.length ? labels : undefined,
  });
  return issue.html_url;
}

async function createProposalIssue(
  userId: string,
  name: string,
  kindRaw: string,
  modeRaw: string,
  entryRaw: string,
): Promise<string> {
  const kind = normalizeKind(kindRaw);
  if (!kind) throw new Error("`kind` must be class or weapon.");
  const mode = normalizeMode(modeRaw);
  if (!mode) throw new Error("`mode` must be add or update.");

  let entry: Record<string, unknown>;
  try {
    entry = parseEntryJson(entryRaw);
  } catch {
    throw new Error(
      'The `entry` JSON didn\'t parse or isn\'t an object. Use valid JSON, e.g. {"stats":{"hp":"80"},"abilities":[]}',
    );
  }
  const proposal = { mode, kind, name, entry };
  const payload = buildProposalPayload(proposal);
  recordIssue(userId);
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

async function handleSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member;
  if (!hasAccessRole(cfg, member)) {
    await interaction.reply({
      content: unauthorizedReplyText(),
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  if (isRateLimited(userId)) {
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
    const labels =
      cmd === "issue"
        ? (interaction.options.getString("labels") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : cmd === "bug"
          ? ["bug"]
          : ["enhancement"];

    await interaction.deferReply({ ephemeral: false });
    try {
      const url = await createPlainIssue(userId, title, body, labels);
      await interaction.editReply(`✅ Created issue **${title}**\n${url}`);
    } catch (e) {
      console.error("[bot] create issue failed:", friendlyError(e));
      await interaction.editReply(
        "❌ Could not create the issue. The error was logged; a private follow-up has the details.",
      );
      await interaction
        .followUp({
          content: `Details: ${friendlyError(e).slice(0, 500)}`,
          ephemeral: true,
        })
        .catch(() => {});
    }
    return;
  }

  // Ability proposals (preview + confirm).
  if (cmd === "ability") {
    const name = interaction.options.getString("name", true);
    const kind = normalizeKind(interaction.options.getString("kind"));
    const mode = normalizeMode(interaction.options.getString("mode"));
    if (!kind || !mode) {
      await interaction.reply({
        content:
          "❌ `kind` must be class or weapon; `mode` must be add or update.",
        ephemeral: true,
      });
      return;
    }
    const entryRaw = interaction.options.getString("entry", true);

    let entry: Record<string, unknown>;
    try {
      entry = parseEntryJson(entryRaw);
    } catch {
      await interaction.reply({
        content:
          '❌ The `entry` JSON didn\'t parse or isn\'t an object. Use valid JSON, e.g. {"stats":{"hp":"80"},"abilities":[]}',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: false });
    const nonce = stagePending(userId, () =>
      createProposalIssue(userId, name, kind, mode, entryRaw),
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
      recordIssue(userId);
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
      .addFields({
        name: "Map",
        value: `\`\`\`txt\n${grid.slice(0, 1024)}\n\`\`\``,
      })
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
      content:
        "This confirmation expired (2 minutes). Please run the command again.",
      ephemeral: true,
    });
    return;
  }
  // Only the invoker may confirm/cancel their own proposal; also enforce the
  // role gate so a roleless bystander can't click Confirm on a public preview.
  if (interaction.user.id !== pending.ownerId) {
    await interaction.reply({
      content:
        "Only the person who ran the command can confirm or cancel this.",
      ephemeral: true,
    });
    return;
  }
  const member = interaction.member;
  if (!hasAccessRole(cfg, member)) {
    await interaction.reply({
      content: unauthorizedReplyText(),
      ephemeral: true,
    });
    return;
  }
  // Enforce the same cooldown here: the command-time check happens before the
  // write is staged, so without this a user could confirm two staged previews
  // back-to-back (two GitHub writes inside the cooldown window).
  if (isRateLimited(interaction.user.id)) {
    await interaction.reply({
      content: "⏳ Please wait a few seconds between commands.",
      ephemeral: true,
    });
    return;
  }
  pendingActions.delete(nonce);
  const { run } = pending;

  if (action === "cancel") {
    await interaction.update({
      content: "❌ Cancelled.",
      embeds: [],
      components: [],
    });
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
    console.error("[bot] confirm failed:", friendlyError(e));
    await interaction.editReply({
      content:
        "❌ Could not create the proposal. The error was logged; a private follow-up has the details.",
      embeds: [],
      components: [],
    });
    await interaction
      .followUp({
        content: `Details: ${friendlyError(e).slice(0, 500)}`,
        ephemeral: true,
      })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Plain-text commands (!issue / !ability)
// ---------------------------------------------------------------------------

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith("!")) return;

  // Unknown ! command — never leave the user without an answer.
  if (!content.startsWith("!issue") && !content.startsWith("!ability")) {
    await message.reply(
      "🤖 I handle: `!issue <title> | <details>`, `!ability <Name> | <entry JSON> | add|update | class|weapon`, and the slash commands `/issue`, `/bug`, `/feature`, `/map`, `/ability`.",
    );
    return;
  }

  const member = message.member;
  if (!hasAccessRole(cfg, member)) {
    await message.reply(unauthorizedReplyText());
    return;
  }

  if (isRateLimited(message.author.id)) {
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
      const reporter = `**Reported by:** @${message.author.username} on Discord`;
      const body = [reporter, details].filter(Boolean).join("\n\n");
      const url = await createPlainIssue(message.author.id, title, body, []);
      await message.reply(`✅ Created issue **${title}**\n${url}`);
    } catch (e) {
      if (e instanceof GithubError) {
        console.error("[bot] create issue failed:", friendlyError(e));
        await message.reply(
          "❌ Could not create the issue — details logged server-side.",
        );
      } else {
        await message.reply(`❌ ${friendlyError(e)}`);
      }
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
      const url = await createProposalIssue(
        message.author.id,
        name,
        kind,
        mode,
        entryRaw,
      );
      await message.reply(
        `✅ Proposed **${name}** — this opens an issue that the workflow turns into a PR.\n${url}`,
      );
    } catch (e) {
      if (e instanceof GithubError) {
        console.error("[bot] create proposal failed:", friendlyError(e));
        await message.reply(
          "❌ Could not create the proposal — details logged server-side.",
        );
      } else {
        await message.reply(`❌ ${friendlyError(e)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, async () => {
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
    // Always tell the user the outcome — including when the handler threw
    // after deferring (otherwise the interaction just hangs silently). The
    // public response stays generic; error details go to the invoker only.
    if (!interaction.isRepliable()) return;
    const content = "❌ Something went wrong.";
    if (interaction.deferred) {
      await interaction.editReply({ content }).catch(() => {});
      await interaction
        .followUp({
          content: `Details: ${friendlyError(e).slice(0, 500)}`,
          ephemeral: true,
        })
        .catch(() => {});
    } else if (!interaction.replied) {
      await interaction.reply({ content, ephemeral: true }).catch(() => {});
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

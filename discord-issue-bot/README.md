# Discord Issue Bot

A small Discord bot that creates GitHub issues on `4-mat/bd-autohost-bot-new` —
plain issues, bug/feature reports, **and** Ability Editor proposals (the
`Ability: ...` issues that PR #181's `ability-pr.yml` workflow turns into PRs)
and map proposals (the `Map: ...` issues that `map-pr.yml` turns into PRs).

It is completely separate from the Pokémon Showdown autohost bot.

## Commands

| Command | What it does |
| --- | --- |
| `/issue title: <t> [body: <b>] [labels: bug, enhancement]` | Creates a normal GitHub issue |
| `!issue <title> \| <optional details>` | Text fallback for the above |
| `/bug title: <t> [body: <b>]` | Creates a GitHub issue labeled `bug` |
| `/feature title: <t> [body: <b>]` | Creates a GitHub issue labeled `enhancement` |
| `/ability name: <n> [kind: class\|weapon] [mode: add\|update] entry: <json>` | Proposes a class/weapon entry — shows a **preview + Confirm/Cancel buttons**, then opens an `Ability: <n>` issue with the ```json payload the editor workflow consumes |
| `!ability <Name> \| <entry JSON> \| add\|update \| class\|weapon` | Text fallback for the above (creates immediately, no preview) |
| `/map name: <id> [modes: ntr, ffa] grid: <rows>` | Proposes a new map — the grid is **validated with the same `mapcore.cjs` parser the CI uses**, then a preview + Confirm/Cancel is shown and a `Map: <id>` issue is opened for the map workflow |

All commands require the configured Discord role (see `ROLE_ID` / `ROLE_NAME`
below; default role name `super turbo`). A short per-user rate limit (10s)
applies between issue-creating commands.

`/ability` and `/map` previews expire after 2 minutes — run the command again
if the buttons stop responding.

## Setup

1. **Create the Discord bot** at <https://discord.com/developers/applications>:
   - New application → Bot → copy the token.
   - Under **OAuth2 → General**, copy the Client ID.
   - Privileged Gateway Intent **Message Content** must be enabled (the
     `!issue` / `!ability` text commands need it).
   - Invite the bot to your server with the `applications.commands` scope
     (e.g. via the OAuth2 URL generator).

2. **GitHub token**: a personal access token (or fine-grained token scoped to
   this repo) with **Issues: write** permission.

3. Copy `.env.example` → `.env` and fill it in.

4. Run locally:

   ```bash
   bun install
   bun run register   # registers slash commands (instant if GUILD_ID is set)
   bun run dev
   ```

## Environment variables

| Variable | Description |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client ID |
| `GUILD_ID` | Guild to register slash commands in (instant updates; omit for global) |
| `GITHUB_TOKEN` | GitHub token with issues:write |
| `GITHUB_REPO` | Target repo, default `4-mat/bd-autohost-bot-new` |
| `ROLE_ID` | Role ID allowed to use the bot (takes precedence) |
| `ROLE_NAME` | Role name allowed to use the bot, default `super turbo` |

## Deploying 24/7 for free (Oracle Cloud)

See **`DEPLOY_GUIDE.html`** for the full interactive walkthrough — or follow the
short version here. Oracle Cloud is the only
genuinely free, reliable 24/7 option that keeps the `!` text commands
(Render's free tier sleeps after 15 minutes idle and its always-on worker
plan costs $7/mo). On an Oracle Always Free Ubuntu VM:

> **Where the deploy kit lives:** `DEPLOY_GUIDE.html` and the `deploy/`
> scripts are kept out of git by design (repo policy — they contain no
> secrets; the bootstrap prompts for env values and never echoes them).
> They ship with the maintainer's checkout of this branch (same files used
> to set up the live bot). On a fresh clone, copy them from the machine
> that originally ran the setup, or ask the maintainer for the current
> kit (matching this commit). Step 2's `scp` expects them locally.

1. On the VM, clone the branch (it includes the `mapeditor/` folder the bot
   needs at runtime for map validation):

   ```bash
   git clone -b feat/discord-issue-bot-v2 https://github.com/4-mat/bd-autohost-bot-new.git
   cd bd-autohost-bot-new/discord-issue-bot
   ```

2. Once the clone finishes, from the `discord-issue-bot/` folder on your
   machine copy the local deploy kit into the clone — the `deploy/` scripts
   are kept out of git, they live next to the deploy guide:

   ```bash
   scp -i ~/.ssh/oci_key -r deploy ubuntu@<PUBLIC_IP>:~/bd-autohost-bot-new/discord-issue-bot/
   ```

3. Back in the VM, run the one-shot bootstrap (installs Node 20 + pm2,
   prompts for the env values with secrets un-echoed, starts the bot with
   auto-restart, enables boot persistence, and installs the OCI
   idle-keepalive cron):

   ```bash
   bash deploy/oci-bootstrap.sh
   ```

## Deploying to Render

`render.yaml` already includes a **worker** service (`bd-discord-issue-bot`):

- **Build:** `cd discord-issue-bot && npm install`
- **Start:** `cd discord-issue-bot && npx tsx src/index.ts`
- **Env vars:** the ones above; secrets (`DISCORD_TOKEN`, `CLIENT_ID`,
  `GUILD_ID`, `GITHUB_TOKEN`, `ROLE_ID`) are marked `sync: false` so they're
  filled in from the Render dashboard and never read from the repo.
- The bot folder must be committed to the repo for Render to pick it up (the
  `mapeditor/` folder is already tracked and is required at runtime for map
  validation).

## Notes

- The proposal payload matches the format `scripts/apply-editor-proposal.ts`
  (PR #181) validates. The workflow still validates and rejects bad payloads —
  the bot just opens the issue.
- Map proposals are validated at submit time by the exact same
  `mapeditor/mapcore.cjs` parser the `map-pr.yml` workflow and the bot's
  `maps/` import use, so invalid maps are rejected in Discord before an issue
  is ever created.
- Role gate is evaluated per command; a 10s per-user rate limit prevents spam.

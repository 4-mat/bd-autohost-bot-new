# Discord Issue Bot

A small Discord bot that creates GitHub issues on `4-mat/bd-autohost-bot-new` —
plain issues **and** Ability Editor proposals (the `Ability: ...` issues that
PR #181's `ability-pr.yml` workflow turns into PRs).

It is completely separate from the Pokémon Showdown autohost bot.

## Commands

| Command | What it does |
| --- | --- |
| `/issue title: <t> [body: <b>] [labels: bug, enhancement]` | Creates a normal GitHub issue |
| `!issue <title> \| <optional details>` | Text fallback for the above |
| `/ability name: <n> [kind: class\|weapon] [mode: add\|update] entry: <json>` | Proposes a class/weapon entry — opens an `Ability: <n>` issue with the ```json payload the editor workflow consumes |
| `!ability <Name> \| <entry JSON> \| add\|update \| class\|weapon` | Text fallback for the above |

All commands require the configured Discord role (see `ROLE_ID` / `ROLE_NAME`
below; default role name `super turbo`).

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

## Deploying to Render

Add a worker service pointing at the repo root (`render.yaml` already includes
one):

- **Build:** `cd discord-issue-bot && npm install`
- **Start:** `cd discord-issue-bot && npx tsx src/index.ts`
- **Env vars:** the ones above (secrets marked *sync: false* in `render.yaml`).

## Notes

- The proposal payload matches the format `scripts/apply-editor-proposal.ts`
  (PR #181) validates. The workflow still validates and rejects bad payloads —
  the bot just opens the issue.
- Role gate is evaluated per command; there is no rate limiting — add some if
  the server is large/public.

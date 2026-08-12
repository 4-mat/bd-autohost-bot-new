# Major Release Guide

How to ship a **major release** so the Discord announcement actually pings the
`super turbo` role — and how the ping works under the hood.

## What counts as a major release

The Discord notification workflow (`.github/workflows/discord-release.yml`)
fires on **every** GitHub release that is:

- published as `released`, and
- the tag ends in `.0.0` (e.g. `v2.0.0`, `v1.0.0`), **or** is the initial
  release tag `0.1.0` / `v0.1.0`.

Patch and minor tags (`.1.0`, `.2.3`, etc.) do **not** trigger it.

## The short version

1. Tag the release as a major: `X.0.0` (or `0.1.0` for the first release).
2. Publish it on GitHub as a **release** (not a pre-release / draft — draft
   and pre-releases don't fire the `released` event).
3. The workflow posts the announcement to the Discord webhook **with the
   `super turbo` role mention in the message `content`**, which pings the role.

## How the role ping actually works

Discord **ignores role mentions inside embed fields**. A mention only pings if
it appears in the top-level `content` of the webhook payload. The workflow
therefore builds:

```json
{
  "content": "<@&1535455535896334467> **v2.0.0**",
  "embeds": [{ "title": "🚀 Battle Dome Autohost — v2.0.0", "...": "..." }]
}
```

The role ID (`1535455535896334467`) is the `super turbo` role. It is read
from the GitHub Actions secret `DISCORD_ROLE_ID`, and falls back to the
default above when the secret is unset.

## Setting / changing the role

- The role ID comes from the `DISCORD_ROLE_ID` **Actions secret**
  (Settings → Secrets and variables → Actions on the repo).
- If it is unset, the workflow uses the hard-coded default in
  `discord-release.yml`.
- To find a role ID in Discord: **Server Settings → Roles → click the role →
  right-click it → Copy Role ID** (Developer Mode must be enabled).
- If the role is renamed, the ID stays the same — the ID is what matters, not
  the name.

## Manual re-send (no new release needed)

1. Open **Actions** → **Discord major-release notification**.
2. Click **Run workflow** (the `workflow_dispatch` trigger) and enter the
   release tag to announce in the required **`release_tag`** input (e.g.
   `v2.0.0`) — the workflow fetches that release's real name, URL, and notes
   from the GitHub API, so the tag must exist as a published release.
3. Optionally update the `DISCORD_ROLE_ID` secret first if the ping target
   changed.

## Checklist before publishing

- [ ] Tag is a major (`X.0.0`) or the initial `0.1.0`.
- [ ] Release is published as **Released** (not draft/pre-release).
- [ ] `DISCORD_ROLE_ID` secret is set if the ping target differs from the
      default `super turbo` role.
- [ ] The configured role is **mentionable** in the target Discord server
      (Role settings → "Allow anyone to @mention this role"), otherwise the
      webhook's mention renders as plain text and does not ping.
- [ ] `DISCORD_WEBHOOK_URL` secret is set to the target channel's webhook.

## Verification

- After publishing, check **Actions** → **Discord major-release notification**
  for a green run (the job uses `--fail-with-body`, so Discord HTTP errors
  fail the run).
- In the Discord channel, you should see the embed **and** a separate
  highlighted mention for the configured role. If the role doesn't ping but
  the embed arrives, the role is not mentionable (see checklist).

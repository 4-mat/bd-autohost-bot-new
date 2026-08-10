# Deploying the Discord Issue Bot 24/7 for free — Oracle Cloud

The bot needs a **long-lived Node.js process** (the Discord gateway connection and
the `!issue` / `!ability` text commands require it), so "serverless" hosts
(Cloudflare Workers, Pages, Vercel) can't run it. **Oracle Cloud Always Free** is
the only genuinely free, reliable 24/7 option:

- **$0 forever** — a credit/debit card is needed *only for signup verification*
  (a temporary authorization hold; nothing is ever charged).
- Keeps **every command**, including the `!` text commands.
- Full Linux VM — your process, your rules (auto-restart via `pm2`).

> **Render alternative (not free):** `render.yaml` at the repo root already has a
> `bd-discord-issue-bot` worker blueprint, but Render has **no free workers** —
> free *web* services spin down after 15 minutes idle (a Discord bot counts as
> idle), so it needs the paid Starter plan ($7/mo).

---

## 1. Create the account

1. Go to <https://signup.cloud.oracle.com> and sign up.
   - Use a **real email + phone** — Oracle's fraud checks are strict and new
     accounts sometimes need manual review (usually a few hours to a day).
   - Enter a credit/debit card for **verification only** — no charge.
2. Pick your **home region** carefully — it can't be changed later. Any region
   with Ampere availability works; if you hit "out of capacity" in step 2, other
   users report success trying different availability domains within the region.

## 2. Create the VM (instance)

1. Console → **Compute → Instances → Create instance**.
2. **Name:** `bd-discord-bot` (anything).
3. **Image:** Ubuntu **24.04** (the free image; login user will be `ubuntu`).
4. **Shape:** **Ampere (A1 Flex)** — pick **1 OCPU / 6 GB RAM** (the Always Free
   allowance covers 2 OCPU / 12 GB total — more than enough).
5. **Boot volume:** 50 GB (Always Free includes 200 GB of block storage).
6. **SSH keys:** generate a new key pair and **download the private key now**,
   or paste your public key. You'll need it to log in.
7. Click **Create**. If you get **"out of host capacity"**, retry in another
   availability domain or use a smaller shape (e.g. 1 OCPU / 6 GB) — it usually
   succeeds on a second try.

## 3. Security — nothing to do

The bot only makes **outbound** connections (Discord gateway + GitHub API), so
no inbound ports are needed besides SSH (port 22, open by default on the
default security list). You can optionally restrict SSH to your IP later.

## 4. SSH in

```bash
ssh -i ~/.ssh/oci_key ubuntu@<PUBLIC_IP>
```

(`<PUBLIC_IP>` is shown on the instance page.)

## 5. Run the bootstrap

```bash
git clone -b feat/discord-issue-bot-v2 https://github.com/4-mat/bd-autohost-bot-new.git
cd bd-autohost-bot-new/discord-issue-bot
bash deploy/oci-bootstrap.sh
```

The script will:

1. Install Node 20 + pm2
2. `npm install` the bot
3. **Prompt you for the env values** (secrets are typed invisibly and stored in
   `.env` with `chmod 600`):

   | Prompt | Value |
   | --- | --- |
   | `DISCORD_TOKEN` | Discord bot token (Developer Portal → Bot) |
   | `CLIENT_ID` | Discord application Client ID (Developer Portal → OAuth2) |
   | `GUILD_ID` | Your server's ID for instant command registration (blank = global) |
   | `GITHUB_TOKEN` | GitHub token with `issues: write` |
   | `GITHUB_REPO` | default `4-mat/bd-autohost-bot-new` |
   | `ROLE_ID` / `ROLE_NAME` | role gate (default role name `super turbo`) |

4. Start the bot under **pm2** (auto-restart on crash) and enable it to start
   on boot
5. Install the OCI idle-keepalive cron (see *Oracle idle reclamation* below)

## 6. Verify

```bash
pm2 status
pm2 logs bd-discord-issue-bot
```

You should see `[bot] logged in as ...` and the guild command registration
line. Then test `/bug`, `/map`, `/ability`, and `!issue` in your server.

## Updating the bot

```bash
cd ~/bd-autohost-bot-new
git pull
cd discord-issue-bot
npm install
pm2 restart bd-discord-issue-bot
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing required env vars` | `cat discord-issue-bot/.env` and check the values |
| Bot online but commands don't appear | Rerun registration: `cd ~/bd-autohost-bot-new/discord-issue-bot && npm run register` |
| Bot crashed | `pm2 logs bd-discord-issue-bot --lines 50`; pm2 auto-restarts 16 times with backoff |
| After a reboot the bot is offline | `pm2 status` — if stopped, re-run `pm2 save` and `sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u ubuntu --hp /home/ubuntu` |

## Notes

- **Cost:** this should stay at exactly $0. To be sure, check **Billing →
  Usage** — the instance (1 OCPU / 6 GB) + 50 GB boot volume fit inside the
  Always Free allowances (2 OCPU / 12 GB + 200 GB storage).
- **Oracle idle reclamation:** Oracle reserves the right to reclaim Always Free
  instances that sit at <20% CPU/network/memory (95th percentile) for 7
  consecutive days — i.e. instances that look abandoned. A quiet bot can look
  idle, so `oci-bootstrap.sh` installs `oci-keepalive.sh` (10 minutes of
  low-priority activity every 2 hours) as insurance. It never affects the bot
  (`nice -n 19`). Remove it anytime with `crontab -e` if you prefer, and Oracle
  emails you before any termination anyway.
- **Message Content intent** must be enabled in the Developer Portal (Bot →
  Privileged Gateway Intents) or the `!` text commands won't receive messages.

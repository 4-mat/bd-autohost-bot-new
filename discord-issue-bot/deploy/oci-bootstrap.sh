#!/usr/bin/env bash
#
# One-shot bootstrap for the BD Discord Issue Bot on an Oracle Cloud
# Always Free VM (or any Ubuntu 22.04/24.04 server).
#
# Usage (as a sudo-capable user, e.g. "ubuntu"):
#   git clone -b feat/discord-issue-bot-v2 https://github.com/4-mat/bd-autohost-bot-new.git
#   cd bd-autohost-bot-new/discord-issue-bot
#   bash deploy/oci-bootstrap.sh
#
# What it does:
#   1. Installs Node 20 (NodeSource) if missing
#   2. Installs pm2 globally
#   3. npm installs the bot dependencies
#   4. Creates .env interactively (secrets are not echoed) if missing
#   5. Starts the bot under pm2 (auto-restart on crash)
#   6. Enables pm2 to start on boot (systemd)
#   7. Installs the OCI idle-reclamation keepalive cron
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"   # .../bd-autohost-bot-new/discord-issue-bot
RUN_USER="$(id -un)"
APP_NAME="bd-discord-issue-bot"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

ask() {
  # ask "<prompt>" <var> [default] [secret]
  local prompt="$1" var="$2" default="${3:-}" secret="${4:-0}" val=""
  if [ "$secret" = "1" ]; then
    read -r -s -p "$prompt" val
    printf '\n'
  else
    read -r -p "$prompt" val
  fi
  if [ -z "$val" ] && [ -n "$default" ]; then
    val="$default"
  fi
  printf -v "$var" '%s' "$val"
}

has() { command -v "$1" >/dev/null 2>&1; }

# Run from the bot directory regardless of where the script was invoked from
cd "$BOT_DIR"
[ -f package.json ] || die "discord-issue-bot/ not found next to $0"

# --- 1. Node 20 ---------------------------------------------------------------
if ! has node || [ "$(node -v | sed 's/^v//; s/\..*//')" -lt 20 ]; then
  say "Installing Node.js 20 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
say "Node: $(node -v) | npm: $(npm -v)"

# --- 2. pm2 ---------------------------------------------------------------------
if ! has pm2; then
  say "Installing pm2..."
  sudo npm install -g pm2
fi

# --- 3. Dependencies --------------------------------------------------------------
say "Installing bot dependencies (npm install)..."
npm install

# --- 4. .env ----------------------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env — paste your values (secrets are not echoed)."
  ask "Discord bot token (DISCORD_TOKEN): " DISCORD_TOKEN "" 1
  ask "Discord application Client ID (CLIENT_ID): " CLIENT_ID "" 1
  ask "Guild ID for instant slash registration, blank = global (GUILD_ID): " GUILD_ID
  ask "GitHub token with issues:write (GITHUB_TOKEN): " GITHUB_TOKEN "" 1
  ask "Target repo (GITHUB_REPO, default 4-mat/bd-autohost-bot-new): " GITHUB_REPO "4-mat/bd-autohost-bot-new"
  ask "Allowed role ID, optional — takes precedence (ROLE_ID): " ROLE_ID
  ask "Allowed role name (ROLE_NAME, default 'super turbo'): " ROLE_NAME "super turbo"

  [ -n "$DISCORD_TOKEN" ] || die "DISCORD_TOKEN is required"
  [ -n "$CLIENT_ID" ] || die "CLIENT_ID is required"
  [ -n "$GITHUB_TOKEN" ] || die "GITHUB_TOKEN is required"

  {
    printf 'DISCORD_TOKEN=%s\n' "$DISCORD_TOKEN"
    printf 'CLIENT_ID=%s\n' "$CLIENT_ID"
    [ -n "$GUILD_ID" ] && printf 'GUILD_ID=%s\n' "$GUILD_ID"
    printf 'GITHUB_TOKEN=%s\n' "$GITHUB_TOKEN"
    printf 'GITHUB_REPO=%s\n' "$GITHUB_REPO"
    [ -n "$ROLE_ID" ] && printf 'ROLE_ID=%s\n' "$ROLE_ID"
    printf 'ROLE_NAME=%s\n' "$ROLE_NAME"
  } > .env
  chmod 600 .env
  say ".env written (chmod 600)."
else
  say ".env already exists — keeping it."
fi

# --- 5. Start under pm2 --------------------------------------------------------------
say "Starting '$APP_NAME' under pm2..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME"
else
  pm2 start npm --name "$APP_NAME" -- run start
fi
pm2 save

# --- 6. Boot persistence ---------------------------------------------------------------
if has systemctl; then
  say "Enabling pm2 to start on boot (systemd)..."
  sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$RUN_USER" --hp "$HOME" >/dev/null
fi

# --- 7. OCI idle-reclamation keepalive --------------------------------------------------
if [ -f deploy/oci-keepalive.sh ]; then
  chmod +x deploy/oci-keepalive.sh
  if ! crontab -l 2>/dev/null | grep -q 'oci-keepalive.sh'; then
    say "Installing OCI idle-keepalive cron (every 2 hours)..."
    ( crontab -l 2>/dev/null; printf '0 */2 * * * %s/deploy/oci-keepalive.sh >> /tmp/oci-keepalive.log 2>&1\n' "$BOT_DIR" ) | crontab -
  fi
fi

say "Done!"
echo ""
echo "   pm2 status"
echo "   pm2 logs $APP_NAME"
echo ""
echo "The log should show '[bot] logged in as ...' followed by command registration."
echo "Then test the commands in Discord."

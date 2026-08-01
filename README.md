# Ice Kyubs

Autohost bot for Pokemon Showdown.

---

## Prerequisites

- [Bun](https://bun.sh) 1.x

---

## Setup

Clone the repo and install dependencies.

```bash
git clone <repo-url>
cd bd-autohost-bot-new
bun install
```

Create a `.env` file in the project root:

```env
PS_USERNAME=yourbotname
PS_PASSWORD=yourpassword
```

---

## Configure

Edit `src/config.ts` to set the rooms your bot joins and the command prefix.

```typescript
export default {
  username: process.env.PS_USERNAME ?? "",
  password: process.env.PS_PASSWORD ?? "",
  server: "sim.smogon.com",
  port: 8000,
  rooms: ["botdevelopment"],
  char: "%",
};
```

---

## Run

```bash
bun run bot
```

The bot connects to `sim.smogon.com`, logs in, and joins the configured rooms.

---

## PM commands

Send commands via PM and the bot responds privately.

```
/msg yourbotname, %info
/msg yourbotname, %setgame ffa
/msg yourbotname, %addp Alice
```

Host commands (`%setgame`, `%addp`, `%setmap`, `%start`, etc.) work through PM when you're the host of an active game. `%host` and `%dehost` still need the room.

---

## Commands

| Command                     | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `%host`                     | Create a new game (room only)                         |
| `%setgame <mode>`           | Set game mode (ffa, 2v2, etc.)                        |
| `%addp <name>`              | Add a player                                          |
| `%addm <name>`              | Add a monster                                         |
| `%setmap <name>`            | Set the map                                           |
| `%start`                    | Start the game                                        |
| `%move <pos>`               | Move to a position                                    |
| `%use <ability> @ <target>` | Use an ability                                        |
| `%confirm`                  | Confirm pending action                                |
| `%cancel`                   | Cancel pending action                                 |
| `%info`                     | Show game info                                        |
| `%tile <pos>`               | Target a tile                                         |
| `%dir <dir>`                | Choose direction for AoE (N, S, E, W, NE, NW, SE, SW) |
| `%help`                     | List available commands                               |

---

## Development

```bash
bun test              # run tests
bun typecheck          # type check
bun run testapp        # local test client at http://localhost:4000
```

See `src/README.md` for dev docs.

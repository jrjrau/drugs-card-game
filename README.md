# Drugs — the card game

A web-based multiplayer card game for playing with friends, closely based on **Palace** (a.k.a. Shithead) with house rules. Runs in any browser — no installs, no accounts, just share a 4-letter room code.

![version](https://img.shields.io/badge/status-playable-brightgreen) ![node](https://img.shields.io/badge/node-%E2%89%A522-blue) ![license](https://img.shields.io/badge/license-private-lightgrey)

## The game

Be the first to get rid of every card: your hand, then your 3 face-up cards, then your 3 face-down cards (played blind!). Play equal-or-higher on the pile or pick the whole thing up.

**House rules that make it "Drugs":**

| Card | Effect |
|------|--------|
| **2** | Resets the pile to 0 — play it on anything |
| **3** | Transparent — counts as the card underneath, play it on anything |
| **7** | The *next player only* must play 7 or lower (2/3/10 still work) |
| **10** | Kills the pile and you go again — play it on anything |
| **J** | Reverses the play order until the next Jack |
| **Overdose** | A configurable run of the same rank (default 4) kills the pile |

Unlike standard Palace, the face-up and face-down cards are **dealt randomly** — no choosing, no swapping.

## Features

- 🌐 **Online multiplayer** — rooms with shareable codes, up to 6 humans plus up to 5 bots
- 💬 **In-game chat** with game events
- 🤖 **Server-authoritative rules** — nobody can peek or cheat
- 🎛️ **Configurable games** — 1–4 decks, bot count, Overdose threshold
- 📊 **Admin dashboard** (`/admin`) — live rooms, connections with IPs, close-a-game and IP blocking, plus all-time stats (aces played, piles picked up, wins…)
- 🃏 **Solo mode** — a standalone single-file version vs bots ([index.html](index.html))
- 🔁 Reconnect support — drop out and rejoin with the same name; a bot covers your seat meanwhile

## Running it

### Docker (recommended)

```bash
cd server
# set ADMIN_KEY in docker-compose.yml first!
docker compose up -d --build
```

Open `http://localhost:3000`. Game state is in memory; all-time stats persist in `server/data/`.

### Without Docker

```bash
cd server
npm install
npm start
```

### Tests

```bash
cd server
npm test        # rule tests — special cards, Overdose runs, pile logic
```

### Stats storage

All-time stats live in `stats.json` inside the container's `/app/data`, saved
every 10 seconds. The compose file uses a **named volume** so the directory is
owned by the container's `node` user (uid 1000) automatically. If you swap it
for a bind mount, the host folder must be owned by uid 1000:

```bash
mkdir -p data && sudo chown -R 1000:1000 data
```

The admin dashboard warns (with the exact error) if saving fails, and resumes
by itself once permissions are fixed — no restart needed.

### Moderation (admin dashboard)

The **Connections** table lists every live socket with its IP, how long it's
been connected, whether it came from Discord, and which room it's in.

- **Block** drops that IP's sockets immediately and refuses the game page and
  any new socket from it. Blocks persist in `blocked.json` next to the stats,
  survive restarts, and can be lifted from the same page. `/admin` itself stays
  reachable from a blocked address, so you can't lock yourself out.
- **Close** ends a single game (or *Close all*) — players get a "game closed"
  message and land back on the menu. Use it before a server update so a table
  left running for hours doesn't hold up the graceful drain.
- Pre-seed blocks without the UI via `BLOCK_IPS=1.2.3.4,5.6.7.8`.

IPs come from `X-Forwarded-For` (the reverse proxy's real-client header); set
`TRUST_PROXY=0` if the server is ever exposed directly. Live IPs are held in
memory only — never written to `stats.json`. Set `GEOIP=1` to show city and
country per IP (one cached lookup per address via ip-api.com; off by default,
so the server makes no outbound calls unless you ask for it).

### Discord Activity

The game runs as a Discord Activity (embedded in a voice channel/server).
Setup in the [Developer Portal](https://discord.com/developers/applications):

1. Create an app → **Activities → Settings → Enable Activities**
2. **Activities → URL Mappings**: map `/` to your public game host
3. **OAuth2 → Reset Secret**, then set both env vars for the container:
   `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` (never commit the secret)
4. Unreleased Activities can only be launched by the app's **team members** —
   add your friends under Teams, or submit for distribution review

Inside Discord the client completes the Embedded App SDK handshake (bundled
at build time — no CDN) and pre-fills each player's Discord display name.

**For verification/distribution** Discord also wants a public Privacy Policy and
Terms of Service, a tag, an install link and a support server. The server hosts
the two documents at `/privacy` and `/terms` — point the Developer Portal at
`https://your-host/privacy` and `https://your-host/terms`. Both pages fill in their contact
paragraph from `SUPPORT_URL` and `CONTACT_EMAIL` at request time, so a real
email address never has to be committed to this repo. They stay readable even
from a blocked IP, since reviewers arrive from unknown addresses.

### Behind a reverse proxy (Synology etc.)

Works over HTTPS/WSS automatically. Two things the proxy must do:

1. Forward websocket upgrade headers (DSM: reverse proxy rule → Custom Header → Create → WebSocket)
2. Idle timeouts are handled — the server pings every 30 s

## Project layout

```
index.html            Solo game (fully standalone, open in a browser)
server/
  server.js           Game server — rules, rooms, bots, stats, admin API
  public/index.html   Multiplayer client
  public/admin.html   Admin dashboard
  Dockerfile
  docker-compose.yml
```

## Roadmap

See [ROADMAP.md](ROADMAP.md).

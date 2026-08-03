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
- 📊 **Admin dashboard** (`/admin`) — live rooms, connections, and all-time stats (aces played, piles picked up, wins…)
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

# Roadmap

## Done ✅

- [x] Solo game vs bots (single-file, no server)
- [x] Special cards: 2 (reset), 3 (mirror), 7 (≤7 next), 10 (kill pile), J (reverse order)
- [x] Overdose (configurable N-of-a-kind pile kill)
- [x] Random face-up/face-down deal (no swapping — house rule)
- [x] Multiplayer server: rooms, lobby, codes, up to 6 humans + 5 bots
- [x] In-game chat with event feed
- [x] Face-down reveal pause so everyone sees blind flips
- [x] Turn-order bar, direction arrows, your-turn glow
- [x] Reconnect support (bot covers your seat)
- [x] Docker deployment + Synology reverse proxy support
- [x] Admin dashboard with live rooms + persistent all-time stats
- [x] In-game rules screen
- [x] Visible version tag for deploy checks
- [x] GitHub Actions → GHCR automated container builds
- [x] Graceful drain: running games finish before the container updates

## Next up 🚧

- [ ] **Sound effects** — card plays, pile pickup, overdose, win/lose, "your turn" ding (with mute toggle)
- [ ] **Your-turn browser notification** — so tabbed-away players don't stall the game
- [ ] **Mobile portrait layout** — someone is always on a phone
- [ ] **Series scoring** — traditional style: track the loser of each hand ("the Drugs") across a room session, with a scoreboard

## Presentation v2 🎬

Make plays impactful, suspenseful, and funny:

- [ ] **Suspense on blind flips** — slow card flip, drumroll, dramatic pause before revealing legal/illegal
- [ ] **Big-moment effects** — screen shake + explosion on overdose, slow-mo on a game-winning card, dramatic zoom when someone is forced to pick up a huge pile
- [ ] **Comedic flavour** — commentary lines/toasts for events ("Bob eats 23 cards. Ouch."), sad trombone on illegal flips, taunt when a 7 traps someone
- [ ] **Cards fly from player positions** — plays and pickups animate to/from the right seat
- [ ] **Emotes / quick reactions** — one-tap laugh/cry/rage bubbles over your seat
- [ ] **Table themes** — felt colours, deck backs

## Chaos mode 🃏 (direction 1, scoped small)

A room toggle, not a roguelike engine — prove the fun first:

- [ ] Jokers in the deck with random Mario-Kart-style effects on play
      (swap hands with a random player, everyone passes one card left,
      peek at a face-down card, next player draws two, …)
- [ ] Effect roulette animation when a joker lands
- [ ] If it's a hit: consider deeper progression (unlockable effects, bot powers, per-run items)

## More games 🏗️ (direction 2)

The platform play — rooms/chat/bots/dashboard are already game-agnostic:

- [ ] Refactor rules into a game-module interface (deal / legal moves / apply move / game over)
- [ ] **Gin rummy** first — 2-player, simplest rules, proves the architecture
- [ ] **Phase 10** — multiplayer-friendly, simple rules
- [ ] **Rummikub** — best game of the three but needs real "rearrange the table" UI work
- [ ] Game picker in the lobby

## Ideas / someday 💭

- [ ] Smarter bot AI (holds specials, plans face-up plays, difficulty levels)
- [ ] Player accounts or persistent names + personal stats page
- [ ] Spectator mode
- [ ] Game history / replay of the last hand
- [ ] Configurable house rules per room (strict 7s, J behaviour, hand size)
- [ ] Game-state persistence across server restarts (refresh and carry on)
- [ ] Watchtower auto-updates once drain + persistence make it safe

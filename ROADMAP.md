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
- [x] Your-turn browser notification + flashing tab title for tabbed-away players

## Next up 🚧

- [ ] Port the v1.3.0 presentation layer to the solo `index.html` (currently multiplayer-only)
- [ ] **Mobile portrait layout** — someone is always on a phone
- [ ] **Series scoring** — traditional style: track the loser of each hand ("the Drugs") across a room session, with a scoreboard

## Presentation v2 🎬 — shipped in v1.3.0

- [x] **Suspense on blind flips** — full-screen stage, drumroll, tension wobble, 3D flip, SAFE/BUSTED stamp
- [x] **Big-moment effects** — screen shake, particle explosion + shockwave on kills, OVERDOSE/BURNED/REVERSE banners
- [x] **Comedic flavour** — randomised commentary toasts ("{who} eats {n} cards. Ouch."), sad trombone on busted flips
- [x] **Cards fly from player positions** — plays animate from the player's seat onto the pile with an impact pop
- [x] **Emotes / quick reactions** — 8 one-tap emotes that float over the sender's seat
- [x] **Table themes** — classic / midnight / crimson / void, remembered per browser
- [x] **Special-card animations** — 2 fires a shockwave ring with a spinning "0"; 3 gets a glassy shimmer sweep and a "counts as X" label
- [x] **Sound effects** — fully synthesised (no asset files), with a mute toggle
- [x] **Your-turn ding** — audio cue + toast when your turn starts

Still open:

- [ ] Slow-motion / dramatic zoom on the game-winning card
- [ ] Pickup animation — cards fly from the pile *to* the player who ate them
- [ ] Deck-back designs per theme

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

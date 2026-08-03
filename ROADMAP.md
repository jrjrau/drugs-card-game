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

## Next up 🚧

- [ ] Automated container builds via GitHub Actions → pull instead of copy+build on the NAS
- [ ] Smarter bot AI (holds specials, plans face-up plays, difficulty levels)
- [ ] Sound effects (card play, overdose, your-turn ding)
- [ ] Mobile layout polish (portrait phones)

## Ideas / someday 💭

- [ ] Player accounts or persistent names + personal stats page
- [ ] Spectator mode
- [ ] Game history / replay of the last hand
- [ ] Configurable house rules per room (strict 7s, J behaviour, multiple hand sizes)
- [ ] Tournaments / series scoring (loser of each hand tracked — traditional style)
- [ ] Animations v2: cards flying from player positions, pickup animation
- [ ] Emotes / quick reactions in game

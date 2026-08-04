"use strict";
/* Drugs — multiplayer server.
 * Plain Node http for static files + ws for the game protocol.
 * The server is authoritative: all rules run here; clients only render. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ADMIN_KEY = process.env.ADMIN_KEY || "drugs-admin";
// Discord Activity support. The client ID is public; the secret must only
// ever live in the environment — never in the repo.
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || null;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || null;
// Behind the Synology reverse proxy the socket address is the proxy itself, so
// the real client IP comes from X-Forwarded-For. Set TRUST_PROXY=0 if the
// server is ever exposed directly (then the header can't be trusted).
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";
// Opt-in country/city lookup for admin display (one cached call per new IP).
const GEOIP = process.env.GEOIP === "1";
// Contact details for the privacy/terms pages. Kept in the environment so a
// real email address never has to sit in a public repo.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "";
const SUPPORT_URL = process.env.SUPPORT_URL || "";
// How long a game with nobody connected is held open so players can rejoin.
// The game freezes while abandoned — bots don't play on without an audience.
const ROOM_GRACE_MS = (parseFloat(process.env.ROOM_GRACE_MIN) || 5) * 60 * 1000;
const REVEAL_MS = 2900;   // blind-flip suspense: drumroll, flip, verdict
const BOT_DELAY_MS = 900;
const SERVER_STARTED = Date.now();

/* ================= Stats (persisted) ================= */
const STATS_FILE = path.join(DATA_DIR, "stats.json");
let statsError = null;
const stats = {
  gamesStarted: 0,
  gamesFinished: 0,
  cardsPlayed: 0,
  byRank: {},            // rank -> times played
  pilePickups: 0,
  cardsPickedUp: 0,
  pilesBurned: 0,        // 10s + overdoses combined
  overdoses: 0,
  reversals: 0,          // jacks that flipped the order
  blindFlips: 0,
  blindFails: 0,
  chatMessages: 0,
  wins: {},              // player name -> wins
};
try {
  Object.assign(stats, JSON.parse(fs.readFileSync(STATS_FILE, "utf8")));
} catch { /* first run */ }

let statsDirty = false;
function bump(key, n = 1) { stats[key] += n; statsDirty = true; }
function bumpMap(map, key, n = 1) { stats[map][key] = (stats[map][key] || 0) + n; statsDirty = true; }
/* Keeps retrying: if the volume is fixed while running, saving resumes on its
 * own without a restart. */
function saveStats() {
  if (!statsDirty) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    statsDirty = false;
    if (statsError) { console.log("Stats file is writable again — saving resumed."); statsError = null; }
  } catch (e) {
    if (!statsError) {
      console.warn(`Cannot write ${STATS_FILE} (${e.code}). Stats are in-memory only until this is fixed.`);
      console.warn(`The container runs as uid 1000 (user "node"); a bind-mounted host folder owned by root is the usual cause.`);
    }
    statsError = `${e.code} writing ${STATS_FILE}`;
  }
}
setInterval(saveStats, 10000);

/* ================= Client IPs, blocking, geo =================
 * IPs are kept in memory for live connections only (plus the persisted
 * block list) — they are never written to stats.json. */
function normIp(ip) {
  if (!ip) return "?";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;   // IPv4-mapped IPv6
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
      const first = String(xff).split(",")[0].trim();   // leftmost = original client
      if (first) return normIp(first);
    }
    const real = req.headers["x-real-ip"];
    if (real) return normIp(String(real).trim());
  }
  return normIp(req.socket && req.socket.remoteAddress);
}

const BLOCK_FILE = path.join(DATA_DIR, "blocked.json");
const blocked = new Set();
try {
  for (const ip of JSON.parse(fs.readFileSync(BLOCK_FILE, "utf8"))) blocked.add(ip);
} catch { /* none yet */ }
// Seed from the environment too, so a bad actor can be shut out via compose.
for (const ip of String(process.env.BLOCK_IPS || "").split(",").map(s => s.trim()).filter(Boolean)) blocked.add(ip);

function saveBlocked() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BLOCK_FILE, JSON.stringify([...blocked], null, 2));
    return null;
  } catch (e) {
    console.warn(`Cannot write ${BLOCK_FILE} (${e.code}) — the block list is in-memory only.`);
    return `${e.code} writing ${BLOCK_FILE}`;
  }
}

/* Drops every live socket from an IP, so blocking takes effect immediately. */
function kickIp(ip) {
  let n = 0;
  if (!wss) return n;
  for (const ws of wss.clients) {
    if (ws._ip === ip) {
      send(ws, { t: "error", msg: "You have been disconnected by the server." });
      ws.close(4003, "blocked");
      n++;
    }
  }
  return n;
}

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd])/i;
const geoCache = new Map();   // ip -> "City, Country" | null
function geoFor(ip) {
  return geoCache.get(ip) || null;
}
function lookupGeo(ip) {
  if (!GEOIP || !ip || ip === "?" || geoCache.has(ip) || PRIVATE_IP.test(ip)) return;
  geoCache.set(ip, null);   // reserve, so we only ever ask once per IP
  fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city`)
    .then(r => r.json())
    .then(d => {
      if (d && d.status === "success") geoCache.set(ip, [d.city, d.country].filter(Boolean).join(", "));
    })
    .catch(() => { /* lookup is cosmetic — ignore failures */ });
}

/* ================= Graceful drain =================
 * On SIGTERM (docker stop / compose up with a new image) we stop accepting
 * new rooms and new deals, let running games finish, then exit. Needs a
 * matching stop_grace_period in docker-compose.yml — otherwise Docker
 * force-kills after 10s anyway. */
const DRAIN_TIMEOUT_MS = (parseInt(process.env.DRAIN_TIMEOUT_MIN, 10) || 15) * 60 * 1000;
let draining = false;

/* Games worth waiting for during a drain. A frozen (abandoned) game has nobody
 * connected, so it must not hold up an update — it's dropped instead. */
function playingRooms() {
  return [...rooms.values()].filter(r => r.phase === "playing" && !r.abandonedAt);
}
function checkDrainDone() {
  if (draining && playingRooms().length === 0) {
    console.log("Drain complete — exiting.");
    saveStats();
    process.exit(0);
  }
}
process.on("SIGTERM", () => {
  if (draining) return;
  draining = true;
  const active = playingRooms().length;
  console.log(`SIGTERM: draining (${active} game(s) running, max wait ${DRAIN_TIMEOUT_MS / 60000} min).`);
  // Games nobody is connected to are given up rather than waited on.
  for (const room of [...rooms.values()]) {
    if (room.abandonedAt) closeRoom(room, "Server updating — the abandoned game was dropped.");
  }
  for (const room of rooms.values()) {
    logMsg(room, "⚠ Server update pending — current games can finish, but new games can't start.");
  }
  checkDrainDone();
  setInterval(checkDrainDone, 5000);
  setTimeout(() => { console.log("Drain timeout — exiting."); saveStats(); process.exit(0); }, DRAIN_TIMEOUT_MS);
});
process.on("SIGINT", () => { saveStats(); process.exit(0); });

/* ================= Static file server ================= */
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Fills in the contact paragraph on the privacy/terms pages. Discord requires
 * both documents to be publicly reachable and to name a way to reach us. */
function contactBlock() {
  const bits = [];
  if (SUPPORT_URL) bits.push(`Join the <a href="${escHtml(SUPPORT_URL)}">support server</a> — that's the quickest way to reach the operator.`);
  if (CONTACT_EMAIL) bits.push(`You can also email <a href="mailto:${escHtml(CONTACT_EMAIL)}">${escHtml(CONTACT_EMAIL)}</a>.`);
  if (!bits.length) bits.push("Contact details have not been configured on this server yet — set SUPPORT_URL and CONTACT_EMAIL.");
  return bits.join(" ");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = url.pathname;
  // Discord's proxy may keep the legacy /.proxy prefix on requests
  if (file.startsWith("/.proxy/")) file = file.slice(7);
  if (file === "/") file = "/index.html";
  if (file === "/admin") file = "/admin.html";
  if (file === "/privacy") file = "/privacy.html";
  if (file === "/terms") file = "/terms.html";

  // Blocked visitors get nothing but the admin pages (key-protected anyway, so
  // you can still unblock yourself if you fat-finger your own address).
  // The legal pages stay public — Discord's reviewers must be able to read them.
  const alwaysPublic = file.startsWith("/admin") || file === "/privacy.html" || file === "/terms.html" || file === "/legal.css";
  if (blocked.has(clientIp(req)) && !alwaysPublic) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Blocked.");
  }

  if (file === "/config.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ discordClientId: DISCORD_CLIENT_ID }));
  }

  // OAuth code -> access token exchange for the Embedded App SDK
  if (file === "/api/token" && req.method === "POST") {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
      res.writeHead(501, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Discord is not configured on this server." }));
    }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", async () => {
      try {
        const { code } = JSON.parse(body || "{}");
        if (!code || typeof code !== "string") throw new Error("no code");
        const r = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
          }),
        });
        const data = await r.json();
        res.writeHead(r.ok ? 200 : 502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: data.access_token || null }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
    return;
  }

  if (file === "/admin/block") {
    if (url.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    const ip = String(url.searchParams.get("ip") || "").trim();
    const action = url.searchParams.get("action") === "remove" ? "remove" : "add";
    if (!ip || ip === "?") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "no ip" }));
    }
    let kicked = 0;
    if (action === "add") { blocked.add(ip); kicked = kickIp(ip); console.log(`Admin blocked ${ip} (${kicked} socket(s) dropped).`); }
    else { blocked.delete(ip); console.log(`Admin unblocked ${ip}.`); }
    const err = saveBlocked();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, action, ip, kicked, blocked: [...blocked], saveError: err }));
  }

  if (file === "/admin/close") {
    if (url.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    const targets = code === "ALL" ? [...rooms.values()] : [rooms.get(code)].filter(Boolean);
    if (!targets.length) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "no such room" }));
    }
    for (const r of targets) closeRoom(r, "An admin closed this game.");
    checkDrainDone();   // closing the last game lets a pending update finish
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, closed: targets.map(r => r.code) }));
  }

  if (file === "/admin/data.json") {
    if (url.searchParams.get("key") !== ADMIN_KEY) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "bad key" }));
    }
    const now = Date.now();
    const roomList = [...rooms.values()].map(r => ({
      code: r.code,
      phase: r.phase,
      ageMs: now - r.createdAt,
      gameAgeMs: r.gameStartedAt ? now - r.gameStartedAt : null,
      opts: r.opts,
      deckCount: r.deck.length,
      pileCount: r.pile.length,
      watchers: r.spectators.length,
      // frozen games are held for the rejoin window, then dropped
      frozenForMs: r.abandonedAt ? now - r.abandonedAt : null,
      players: r.players.map(p => ({
        name: p.name, bot: p.bot, connected: p.connected,
        handCount: p.hand.length,
        cardsLeft: p.hand.length + p.faceUp.length + p.faceDown.length,
        ip: p.bot ? null : (p.ip || null),
        geo: p.bot ? null : geoFor(p.ip),
      })),
    }));
    // Every live socket, including people sitting on the menu with no room yet.
    const connList = wss ? [...wss.clients].map(ws => ({
      ip: ws._ip || "?",
      geo: geoFor(ws._ip),
      name: ws._player ? ws._player.name : null,
      room: ws._room ? ws._room.code : null,
      ageMs: now - (ws._connectedAt || now),
      ua: ws._ua || null,
    })).sort((a, b) => a.ageMs - b.ageMs) : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      uptimeMs: now - SERVER_STARTED,
      connections: wss ? wss.clients.size : 0,
      statsWritable: !statsError,
      statsError,
      statsFile: STATS_FILE,
      rooms: roomList,
      connectionList: connList,
      blocked: [...blocked],
      geoEnabled: GEOIP,
      trustProxy: TRUST_PROXY,
      stats,
    }));
  }

  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  const legal = file === "/privacy.html" || file === "/terms.html";
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    let body = data;
    if (legal) body = String(data).replace("{{CONTACT_BLOCK}}", contactBlock());
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(body);
  });
});

/* ================= Game rules (same as solo client) ================= */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABEL = r => ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r] || String(r));
const cardName = c => RANK_LABEL(c.rank) + c.suit;

function makeDeck(nDecks) {
  const d = [];
  for (let n = 0; n < nDecks; n++)
    for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function effectiveTop(room) {
  for (let i = room.pile.length - 1; i >= 0; i--) {
    if (room.pile[i].rank === 3) continue;
    return room.pile[i].rank;
  }
  return null;
}

function canPlayRank(room, r) {
  if (r === 2 || r === 3 || r === 10) return true;
  const top = effectiveTop(room);
  if (room.sevenActive) return r <= 7;
  if (top === null || top === 2) return true;
  return r >= top;
}

function activeZone(p) {
  if (p.hand.length > 0) return "hand";
  if (p.faceUp.length > 0) return "faceUp";
  if (p.faceDown.length > 0) return "faceDown";
  return null;
}

function legalIndices(room, p) {
  const zone = activeZone(p);
  if (!zone) return [];
  if (zone === "faceDown") return p.faceDown.map((c, i) => i);
  return p[zone].map((c, i) => i).filter(i => canPlayRank(room, p[zone][i].rank));
}

function drawUp(room, p) {
  while (p.hand.length < 3 && room.deck.length > 0) p.hand.push(room.deck.pop());
  sortHand(p);
}
function sortHand(p) { p.hand.sort((a, b) => a.rank - b.rank); }

function resolvePlay(room, cards, actor) {
  const blind = !!(actor && actor._blind);
  for (const c of cards) room.pile.push(c);
  // Jacks flip the turn order. Any number played together reverses ONCE, so a
  // pair still reverses rather than cancelling itself out.
  const reversed = cards.some(c => c.rank === 11);
  if (reversed) { room.direction *= -1; bump("reversals"); }
  bump("cardsPlayed", cards.length);
  for (const c of cards) bumpMap("byRank", c.rank);

  if (actor && !blind) {
    fx(room, "play", { whoId: actor.id, who: actor.name, cards });
  }
  if (reversed) {
    logMsg(room, "Jack — play order reversed!");
    fx(room, "reverse", { who: actor ? actor.name : "Someone" });
  }

  let burned = cards[0].rank === 10;
  let overdose = false;
  const eff = effectiveTop(room);

  if (!burned && room.opts.burn > 0 && room.pile.length >= room.opts.burn) {
    const n = room.pile.length;
    const r0 = room.pile[n - 1].rank;
    if (r0 !== 3) {
      let run = 1;
      while (run < n && room.pile[n - 1 - run].rank === r0) run++;
      if (run >= room.opts.burn) { burned = true; overdose = true; bump("overdoses"); }
    }
  }

  if (burned) {
    bump("pilesBurned");
    fx(room, "burn", {
      who: actor ? actor.name : "Someone",
      whoId: actor ? actor.id : null,
      overdose,
      n: room.pile.length,
      rank: cards[cards.length - 1].rank,
    });
    room.pile = [];
    room.sevenActive = false;
    return { burned: true, goAgain: true };
  }
  room.sevenActive = (eff === 7);
  const who = actor ? actor.name : "Someone";
  if (room.sevenActive) fx(room, "seven", { who });
  const topRank = room.pile[room.pile.length - 1].rank;
  if (topRank === 2) fx(room, "reset", { who });
  else if (topRank === 3) fx(room, "mirror", { who, mirrors: eff });
  return { burned: false, goAgain: false };
}

/* Length of the run of identical ranks on top of the pile (drives the ×N badge). */
function topRunCount(room) {
  const p = room.pile;
  if (!p.length) return 0;
  const r0 = p[p.length - 1].rank;
  let n = 1;
  while (n < p.length && p[p.length - 1 - n].rank === r0) n++;
  return n;
}

function pickUpPile(room, p) {
  const n = room.pile.length;
  bump("pilePickups");
  bump("cardsPickedUp", n);
  fx(room, "pickup", { whoId: p.id, who: p.name, n });
  p.hand.push(...room.pile);
  room.pile = [];
  room.sevenActive = false;
  sortHand(p);
}

function hasWon(room, p) {
  return p.hand.length === 0 && p.faceUp.length === 0 && p.faceDown.length === 0 && room.deck.length === 0;
}

/* ================= Rooms ================= */
const rooms = new Map(); // code -> room
let nextPlayerId = 1;

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function makeRoom(hostWs, hostName, opts) {
  const room = {
    code: makeCode(),
    phase: "lobby",           // lobby | playing | over
    opts: sanitizeOpts(opts),
    players: [],              // {id, name, ws|null, bot, hand, faceUp, faceDown, connected}
    spectators: [],           // sockets watching, not seated
    deck: [], pile: [],
    turn: 0,
    direction: 1,
    sevenActive: false,
    busy: false,              // true during a reveal pause
    timer: null,
    graceTimer: null,         // running while nobody is connected
    abandonedAt: null,
    createdAt: Date.now(),
    gameStartedAt: null,
  };
  rooms.set(room.code, room);
  addHuman(room, hostWs, hostName);
  return room;
}

function humansConnected(room) {
  return room.players.filter(p => !p.bot && p.connected).length;
}

/* Ends a room for everyone in it — the admin dashboard's Close button, and the
 * end of the rejoin grace period. Players are returned to the menu (the client
 * reloads) and can immediately start a fresh room. */
function closeRoom(room, reason) {
  clearTimeout(room.timer);
  clearTimeout(room.graceTimer);
  room.phase = "over";
  rooms.delete(room.code);
  for (const p of room.players) {
    if (p.bot || !p.ws) continue;
    send(p.ws, { t: "closed", msg: reason });
    p.ws._room = null;
    p.ws._player = null;
  }
  for (const ws of room.spectators || []) {
    send(ws, { t: "closed", msg: reason });
    ws._watching = null;
  }
  room.players = [];
  room.spectators = [];
  console.log(`Room ${room.code} closed: ${reason}`);
}

/* Nobody is connected any more. A game in progress is frozen and held for
 * ROOM_GRACE_MS so whoever dropped can pick their seat back up — without this a
 * solo player against bots lost the game the instant their connection blinked.
 * Lobbies aren't worth holding: there is no game state to come back to. */
function abandonRoom(room) {
  clearTimeout(room.timer);            // stop the bots playing to an empty table
  if (room.phase !== "playing") {
    closeRoom(room, "Everyone left the room.");
    return;
  }
  room.abandonedAt = Date.now();
  clearTimeout(room.graceTimer);
  room.graceTimer = setTimeout(() => {
    closeRoom(room, "The game was abandoned — nobody came back.");
  }, ROOM_GRACE_MS);
  pushState(room);                     // spectators see it freeze
  setImmediate(checkDrainDone);        // a frozen game no longer blocks an update
  console.log(`Room ${room.code} abandoned — held for ${Math.round(ROOM_GRACE_MS / 60000)} min.`);
}

/* Someone came back (or a spectator became irrelevant): unfreeze. */
function reviveRoom(room) {
  if (!room.abandonedAt) return;
  clearTimeout(room.graceTimer);
  room.graceTimer = null;
  room.abandonedAt = null;
}

function sanitizeOpts(o) {
  const clamp = (v, lo, hi, d) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    bots: clamp(o && o.bots, 0, 5, 0),
    decks: clamp(o && o.decks, 1, 4, 1),
    burn: [0, 3, 4, 5, 6, 7, 8].includes(o && o.burn) ? o.burn : 4,
  };
}

function addHuman(room, ws, name) {
  const p = { id: nextPlayerId++, name: name.slice(0, 16) || "Player", ws, bot: false, connected: true, ip: ws && ws._ip || null, hand: [], faceUp: [], faceDown: [] };
  room.players.push(p);
  ws._room = room;
  ws._player = p;
  return p;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg) {
  for (const p of room.players) if (!p.bot && p.connected) send(p.ws, msg);
  for (const ws of room.spectators || []) send(ws, msg);   // rule tests build bare rooms
}
function chatMsg(room, from, text) {
  broadcast(room, { t: "chat", from, text });
}
function logMsg(room, text) {
  broadcast(room, { t: "log", text });
}
/* Presentation events — the client turns these into sounds, toasts and effects.
 * Purely cosmetic: the authoritative state still arrives via pushState. */
function fx(room, kind, data) {
  broadcast(room, Object.assign({ t: "fx", kind }, data));
}

/* Per-player view of the room. me === null builds the spectator view: same
 * public information, no hand for anybody. */
function viewFor(room, me) {
  return {
    code: room.code,
    phase: room.phase,
    opts: room.opts,
    hostId: room.players.find(p => !p.bot) ? room.players.find(p => !p.bot).id : null,
    youId: me ? me.id : null,
    isHost: me ? isHost(room, me) : false,
    spectating: !me,
    watchers: room.spectators.length,
    frozen: !!room.abandonedAt,
    deckCount: room.deck.length,
    pileCount: room.pile.length,
    pileTop: room.pile.slice(-3),
    topRun: topRunCount(room),
    effectiveTop: effectiveTop(room),
    sevenActive: room.sevenActive,
    direction: room.direction,
    turnId: room.phase === "playing" ? room.players[room.turn].id : null,
    busy: room.busy,
    players: room.players.map(p => ({
      id: p.id, name: p.name, bot: p.bot, connected: p.connected,
      handCount: p.hand.length,
      faceUp: p.faceUp,
      faceDownCount: p.faceDown.length,
      hand: (me && p === me) ? p.hand : undefined,
    })),
  };
}
function isHost(room, p) {
  const firstHuman = room.players.find(q => !q.bot);
  return firstHuman && firstHuman.id === p.id;
}
function pushState(room, reveal) {
  for (const p of room.players) {
    if (p.bot || !p.connected) continue;
    send(p.ws, { t: "state", view: viewFor(room, p), reveal: reveal || null });
  }
  if (room.spectators && room.spectators.length) {
    const watcherView = viewFor(room, null);
    for (const ws of room.spectators) send(ws, { t: "state", view: watcherView, reveal: reveal || null });
  }
}

/* ================= Game flow ================= */
function startGame(room) {
  room.pile = [];
  room.direction = 1;
  room.sevenActive = false;
  room.busy = false;
  room.phase = "playing";

  // remove old bots, add per current opts
  room.players = room.players.filter(p => !p.bot);
  for (let i = 1; i <= room.opts.bots; i++)
    room.players.push({ id: nextPlayerId++, name: "Bot " + i, ws: null, bot: true, connected: true, hand: [], faceUp: [], faceDown: [] });

  // Every player needs 9 cards, so a big table needs more than one deck —
  // otherwise the last seats get dealt nothing at all.
  const needed = room.players.length * 9;
  const minDecks = Math.ceil((needed + 4) / 52);   // +4 so the draw pile isn't empty from the off
  if (room.opts.decks < minDecks) {
    logMsg(room, `${room.players.length} players need ${needed} cards — using ${minDecks} decks.`);
    room.opts.decks = minDecks;
  }
  room.deck = makeDeck(room.opts.decks);

  for (const p of room.players) {
    p.hand = []; p.faceUp = []; p.faceDown = [];
    for (let i = 0; i < 3; i++) p.faceDown.push(room.deck.pop());
    for (let i = 0; i < 3; i++) p.faceUp.push(room.deck.pop());
    for (let i = 0; i < 3; i++) p.hand.push(room.deck.pop());
    sortHand(p);
  }
  room.turn = Math.floor(Math.random() * room.players.length);
  room.gameStartedAt = Date.now();
  bump("gamesStarted");
  logMsg(room, `Game started: ${room.players.length} players, ${room.opts.decks} deck(s), Overdose ${room.opts.burn || "off"}. ${room.players[room.turn].name} goes first.`);
  pushState(room);
  maybeBotTurn(room);
}

function advanceTurn(room) {
  if (room.phase !== "playing") return;
  const n = room.players.length;
  room.turn = (room.turn + room.direction + n) % n;
  pushState(room);
  maybeBotTurn(room);
}

function currentPlayer(room) { return room.players[room.turn]; }

function maybeBotTurn(room) {
  if (room.phase !== "playing" || room.busy) return;
  if (room.abandonedAt) return;        // frozen: nobody is connected to watch

  const p = currentPlayer(room);
  if (p.bot || !p.connected) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => botMove(room, p), BOT_DELAY_MS);
  }
}

function finishPlay(room, p, res) {
  drawUp(room, p);
  if (hasWon(room, p)) return endGame(room, p);
  if (res.goAgain) {
    pushState(room);
    if (p.bot || !p.connected) {
      clearTimeout(room.timer);
      room.timer = setTimeout(() => botMove(room, p), BOT_DELAY_MS);
    }
  } else {
    advanceTurn(room);
  }
}

function endGame(room, winner) {
  room.phase = "over";
  clearTimeout(room.timer);
  bump("gamesFinished");
  bumpMap("wins", winner.name);
  setImmediate(checkDrainDone);
  logMsg(room, `${winner.name} wins!`);
  broadcast(room, { t: "gameover", winner: winner.name, winnerId: winner.id });
  pushState(room);
}

/* Flip a face-down card with a visible reveal pause */
function flipFaceDown(room, p, idx) {
  const card = p.faceDown.splice(idx, 1)[0];
  const ok = canPlayRank(room, card.rank);
  bump("blindFlips");
  if (!ok) bump("blindFails");
  room.busy = true;
  pushState(room, { card, ok, who: p.name, whoId: p.id });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.busy = false;
    if (ok) {
      p._blind = true;                       // the flip was already dramatized
      const res = resolvePlay(room, [card], p);
      p._blind = false;
      logMsg(room, `${p.name} blind-plays ${cardName(card)}${res.burned ? " — pile overdosed!" : ""}`);
      finishPlay(room, p, res);
    } else {
      p.hand.push(card);
      pickUpPile(room, p);
      logMsg(room, `${p.name} flipped ${cardName(card)} — illegal, picks up the pile.`);
      advanceTurn(room);
    }
  }, REVEAL_MS);
}

/* ================= Bot AI ================= */
function botMove(room, p) {
  if (room.phase !== "playing" || room.busy || currentPlayer(room) !== p) return;
  const zone = activeZone(p);
  if (!zone) return advanceTurn(room);

  if (zone === "faceDown") {
    const i = Math.floor(Math.random() * p.faceDown.length);
    return flipFaceDown(room, p, i);
  }

  const src = p[zone];
  const legal = legalIndices(room, p);
  if (legal.length === 0) {
    pickUpPile(room, p);
    logMsg(room, `${p.name} can't play — picks up the pile.`);
    return advanceTurn(room);
  }
  const specials = new Set([2, 3, 10]);
  const nonSpecial = legal.filter(i => !specials.has(src[i].rank));
  const choiceRank = nonSpecial.length
    ? Math.min(...nonSpecial.map(i => src[i].rank))
    : src[legal[0]].rank;
  const idxs = legal.filter(i => src[i].rank === choiceRank);
  const cards = idxs.map(i => src[i]);
  for (let k = idxs.length - 1; k >= 0; k--) src.splice(idxs[k], 1);
  const res = resolvePlay(room, cards, p);
  logMsg(room, `${p.name} plays ${cards.map(cardName).join(" ")}${res.burned ? " — pile overdosed!" : ""}`);
  finishPlay(room, p, res);
}

/* ================= Message handling ================= */
const wss = new WebSocketServer({ server });

// Heartbeat: keeps connections alive through reverse proxies (Synology cuts
// idle connections after ~60s) and reaps dead ones.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._dead) { ws.terminate(); continue; }
    ws._dead = true;
    ws.ping();
  }
}, 30000);

wss.on("connection", (ws, req) => {
  ws._ip = clientIp(req);
  ws._ua = (req.headers["user-agent"] || "").slice(0, 120);
  ws._connectedAt = Date.now();
  if (blocked.has(ws._ip)) {
    send(ws, { t: "error", msg: "You have been blocked from this server." });
    return ws.close(4003, "blocked");
  }
  lookupGeo(ws._ip);
  ws._dead = false;
  ws.on("pong", () => { ws._dead = false; });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handle(ws, msg); } catch (e) {
      console.error(e);
      send(ws, { t: "error", msg: "Server error." });
    }
  });
  ws.on("close", () => {
    const watching = ws._watching;
    if (watching) {
      watching.spectators = watching.spectators.filter(s => s !== ws);
      ws._watching = null;
      if (watching.players.length) pushState(watching);   // watcher count changed
      return;
    }
    const room = ws._room, p = ws._player;
    if (!room || !p) return;
    p.connected = false;
    p.ws = null;
    if (room.phase === "lobby") {
      room.players = room.players.filter(q => q !== p);
      if (room.players.filter(q => !q.bot).length === 0) return abandonRoom(room);
    } else {
      logMsg(room, `${p.name} disconnected — a bot takes over. They can rejoin with the same name.`);
    }
    // Hold the game instead of destroying it, so they can come back.
    if (humansConnected(room) === 0) return abandonRoom(room);
    pushState(room);
    maybeBotTurn(room); // if it was their turn, the bot brain takes it
  });
});

function handle(ws, msg) {
  const room = ws._room, me = ws._player;

  switch (msg.t) {
    case "create": {
      if (room) return;
      if (draining) return send(ws, { t: "error", msg: "Server is about to update — try again in a few minutes." });
      const r = makeRoom(ws, String(msg.name || "Player"), msg.opts);
      send(ws, { t: "joined", code: r.code });
      pushState(r);
      return;
    }
    case "join": {
      if (room || ws._watching) return;
      const r = rooms.get(String(msg.code || "").toUpperCase());
      if (!r) return send(ws, { t: "error", msg: "Room not found." });
      const wanted = String(msg.name || "Player").slice(0, 16);
      if (r.phase !== "lobby") {
        // Rejoin: take back your own seat, which a bot has been covering.
        // Matched case-insensitively — nobody remembers how they capitalised it.
        const key = wanted.trim().toLowerCase();
        const seat = r.players.find(p => !p.bot && !p.connected && p.name.trim().toLowerCase() === key);
        if (seat) {
          reviveRoom(r);
          seat.connected = true; seat.ws = ws; seat.ip = ws._ip || seat.ip;
          ws._room = r; ws._player = seat;
          send(ws, { t: "joined", code: r.code, rejoined: true });
          logMsg(r, `${seat.name} is back — taking their seat from the bot.`);
          pushState(r);
          maybeBotTurn(r);        // resume a frozen game, or let the bot finish its turn
          return;
        }
        const taken = r.players.find(p => !p.bot && p.connected && p.name.trim().toLowerCase() === key);
        if (taken) return send(ws, { t: "error", msg: `"${taken.name}" is already connected in that game.` });
        return send(ws, { t: "error", msg: "That game is already in progress — you can watch it instead." });
      }
      if (r.players.filter(p => !p.bot).length >= 6) return send(ws, { t: "error", msg: "Room full (6 players max)." });
      const p = addHuman(r, ws, wanted);
      send(ws, { t: "joined", code: r.code });
      logMsg(r, `${p.name} joined the room.`);
      pushState(r);
      return;
    }
    case "spectate": {
      if (room || ws._watching) return;
      const r = rooms.get(String(msg.code || "").toUpperCase());
      if (!r) return send(ws, { t: "error", msg: "Room not found." });
      ws._watching = r;
      ws._watchName = String(msg.name || "Someone").slice(0, 16) || "Someone";
      r.spectators.push(ws);
      send(ws, { t: "joined", code: r.code, spectator: true });
      logMsg(r, `${ws._watchName} is watching.`);
      pushState(r);
      return;
    }
  }

  // Spectators can talk, but that's all they can do.
  if (ws._watching) {
    if (msg.t === "chat") {
      const text = String(msg.text || "").slice(0, 300).trim();
      if (text) { chatMsg(ws._watching, ws._watchName + " 👁", text); bump("chatMessages"); }
    }
    return;
  }

  if (!room || !me) return;

  switch (msg.t) {
    case "opts": {
      if (!isHost(room, me) || room.phase === "playing") return;
      room.opts = sanitizeOpts(msg.opts);
      pushState(room);
      return;
    }
    case "start": {
      if (!isHost(room, me)) return send(ws, { t: "error", msg: "Only the host can start." });
      if (draining) return send(ws, { t: "error", msg: "Server is about to update — new games can't start right now." });
      if (room.phase === "playing") return;
      startGame(room);
      return;
    }
    case "chat": {
      const text = String(msg.text || "").slice(0, 300).trim();
      if (text) { chatMsg(room, me.name, text); bump("chatMessages"); }
      return;
    }
    case "emote": {
      const EMOTES = ["😂", "😭", "😡", "😎", "🤯", "🍻", "🤡", "💀"];
      if (!EMOTES.includes(msg.e)) return;
      const now = Date.now();
      if (me._lastEmote && now - me._lastEmote < 800) return;   // rate limit
      me._lastEmote = now;
      fx(room, "emote", { whoId: me.id, who: me.name, e: msg.e });
      return;
    }
    case "play": {
      if (room.phase !== "playing" || room.busy || currentPlayer(room) !== me) return;
      const zone = activeZone(me);
      if (!zone || zone === "faceDown") return;
      const src = me[zone];
      const idxs = [...new Set((msg.idxs || []).map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < src.length);
      if (idxs.length === 0) return;
      const rank = src[idxs[0]].rank;
      if (!idxs.every(i => src[i].rank === rank)) return send(ws, { t: "error", msg: "Cards must be the same rank." });
      if (!canPlayRank(room, rank)) return send(ws, { t: "error", msg: "That card can't be played." });
      idxs.sort((a, b) => b - a);
      const cards = idxs.map(i => src[i]).reverse();
      for (const i of idxs) src.splice(i, 1);
      const res = resolvePlay(room, cards, me);
      logMsg(room, `${me.name} plays ${cards.map(cardName).join(" ")}${res.burned ? " — pile overdosed!" : ""}`);
      finishPlay(room, me, res);
      return;
    }
    case "flip": {
      if (room.phase !== "playing" || room.busy || currentPlayer(room) !== me) return;
      if (activeZone(me) !== "faceDown") return;
      const i = Number(msg.idx);
      if (!Number.isInteger(i) || i < 0 || i >= me.faceDown.length) return;
      flipFaceDown(room, me, i);
      return;
    }
    case "pickup": {
      if (room.phase !== "playing" || room.busy || currentPlayer(room) !== me) return;
      if (room.pile.length === 0) return;
      pickUpPile(room, me);
      logMsg(room, `${me.name} picks up the pile.`);
      advanceTurn(room);
      return;
    }
    case "again": {
      if (!isHost(room, me) || room.phase !== "over") return;
      room.phase = "lobby";
      pushState(room);
      return;
    }
  }
}

/* Only listen when run directly, so the rule functions can be required and
 * unit-tested (see test/rules.test.js). */
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Drugs server running → http://localhost:${PORT}`);
  });
}

module.exports = {
  makeDeck, effectiveTop, canPlayRank, resolvePlay, pickUpPile, topRunCount,
  activeZone, legalIndices, drawUp, hasWon, RANK_LABEL, cardName,
};

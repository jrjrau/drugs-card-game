"use strict";
/* Share-link join-flow tests — run with: npm test
 * Drives the real server over a real WebSocket, asserting the machine-readable
 * flags the client uses to react to share-link joins (dead room, game already
 * in progress) without string-matching error text. */
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir() + "/drugs-test-data";
const assert = require("assert");
const WebSocket = require("ws");
const { server } = require("../server.js");

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
}

/* Thin client: connect, send JSON, await the next message of a given type. */
function client(port) {
  const ws = new WebSocket("ws://127.0.0.1:" + port);
  const inbox = [];
  const waiters = [];
  ws.on("message", data => {
    const msg = JSON.parse(data);
    const i = waiters.findIndex(w => w.match(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    open: () => new Promise((ok, bad) => { ws.on("open", ok); ws.on("error", bad); }),
    send: msg => ws.send(JSON.stringify(msg)),
    next(match, ms = 2000) {
      const hit = inbox.findIndex(match);
      if (hit >= 0) return Promise.resolve(inbox.splice(hit, 1)[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
        waiters.push({ match, resolve: m => { clearTimeout(t); resolve(m); } });
      });
    },
    close: () => ws.close(),
  };
}

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const port = server.address().port;

  console.log("\nShare-link join flags");

  let code;
  const host = client(port);
  await host.open();
  host.send({ t: "create", name: "Host", opts: { bots: 1, decks: 1, burn: 4 } });

  await test("host creates and starts a game", async () => {
    code = (await host.next(m => m.t === "joined")).code;
    host.send({ t: "start" });
    const st = await host.next(m => m.t === "state" && m.view.phase === "playing");
    assert.ok(st, "game should be playing");
  });

  await test("joining a nonexistent room gets a notFound-flagged error", async () => {
    const c = client(port);
    await c.open();
    c.send({ t: "join", name: "Lost", code: "ZZZZ" });
    const err = await c.next(m => m.t === "error");
    assert.strictEqual(err.notFound, true, "error should carry notFound: true");
    c.close();
  });

  await test("a fresh name joining a started game gets an inProgress-flagged error", async () => {
    const c = client(port);
    await c.open();
    c.send({ t: "join", name: "Newbie", code });
    const err = await c.next(m => m.t === "error");
    assert.strictEqual(err.inProgress, true, "error should carry inProgress: true");
    c.close();
  });

  await test("a disconnected player's name rejoins a started game, no error", async () => {
    host.close();
    await new Promise(ok => setTimeout(ok, 100));   // let the server hand the seat to a bot
    const back = client(port);
    await back.open();
    back.send({ t: "join", name: "host", code });   // case-insensitive on purpose
    const joined = await back.next(m => m.t === "joined");
    assert.strictEqual(joined.rejoined, true, "should be a rejoin");
    back.close();
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

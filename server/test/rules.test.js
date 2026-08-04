"use strict";
/* Rule tests — run with: npm test
 * These drive the real server rule functions, not a copy of them. */
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir() + "/drugs-test-data";
const assert = require("assert");
const R = require("../server.js");

const C = (rank, suit = "♠") => ({ rank, suit });
/* A room with no connected players, so broadcasts are no-ops. */
function room(pile, opts = {}) {
  return {
    code: "TEST", phase: "playing", players: [], spectators: [], deck: [], pile: pile.slice(),
    turn: 0, direction: 1, sevenActive: false, busy: false, abandonedAt: null,
    opts: Object.assign({ bots: 0, decks: 1, burn: 4 }, opts),
  };
}
const actor = (name = "P1") => ({ id: 1, name, bot: false, connected: true, hand: [], faceUp: [], faceDown: [] });

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.log("  ✗ " + name + "\n      " + e.message); }
}

console.log("\nOverdose");
test("two 4s then two more 4s overdoses at threshold 4 (Joel's scenario)", () => {
  const r = room([C(4, "♠"), C(4, "♥")]);          // player 1 already played two 4s
  const res = R.resolvePlay(r, [C(4, "♦"), C(4, "♣")], actor("P2"));  // player 2 adds two more
  assert.strictEqual(res.burned, true, "should burn");
  assert.strictEqual(res.goAgain, true, "player 2 should go again");
  assert.strictEqual(r.pile.length, 0, "pile should be cleared");
});
test("four 4s played one at a time also overdoses", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, true);
});
test("three 4s do not overdose at threshold 4", () => {
  const r = room([C(4, "♠"), C(4, "♥")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♦")], actor()).burned, false);
  assert.strictEqual(r.pile.length, 3);
});
test("four 4s do NOT overdose when the threshold is 5", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")], { burn: 5 });
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, false);
});
test("five of a kind overdoses when the threshold is 5", () => {
  const r = room([C(6, "♠"), C(6, "♥"), C(6, "♦"), C(6, "♣")], { burn: 5 });
  assert.strictEqual(R.resolvePlay(r, [C(6, "♠")], actor()).burned, true);
});
test("only the run on top counts — lower cards don't break it", () => {
  const r = room([C(9), C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, true);
});
test("a non-matching card below stops the run", () => {
  const r = room([C(4, "♠"), C(5), C(5, "♥"), C(5, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(5, "♣")], actor()).burned, true, "four 5s burn");
  const r2 = room([C(4, "♠"), C(4, "♥"), C(9), C(9, "♥")]);
  assert.strictEqual(R.resolvePlay(r2, [C(9, "♦")], actor()).burned, false, "three 9s do not");
});
test("Overdose off (0) never burns on a run", () => {
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")], { burn: 0 });
  assert.strictEqual(R.resolvePlay(r, [C(4, "♣")], actor()).burned, false);
});
test("a 3 played on three 4s does NOT currently overdose", () => {
  // documents present behaviour: the transparent 3 is not treated as a 4 here
  const r = room([C(4, "♠"), C(4, "♥"), C(4, "♦")]);
  assert.strictEqual(R.resolvePlay(r, [C(3)], actor()).burned, false);
});

console.log("\nSpecial cards");
test("10 kills the pile and grants another turn", () => {
  const r = room([C(9), C(8)]);
  const res = R.resolvePlay(r, [C(10)], actor());
  assert.strictEqual(res.burned, true);
  assert.strictEqual(res.goAgain, true);
  assert.strictEqual(r.pile.length, 0);
});
test("2 resets — anything may follow", () => {
  const r = room([C(13)]);
  R.resolvePlay(r, [C(2)], actor());
  assert.strictEqual(R.canPlayRank(r, 4), true, "a 4 should be legal after a 2");
});
test("3 mirrors the card underneath", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(3)], actor());
  assert.strictEqual(R.effectiveTop(r), 9, "effective top should still be 9");
  assert.strictEqual(R.canPlayRank(r, 8), false, "an 8 must not be playable on a mirrored 9");
  assert.strictEqual(R.canPlayRank(r, 9), true);
});
test("3 on an empty pile lets anything follow", () => {
  const r = room([]);
  R.resolvePlay(r, [C(3)], actor());
  assert.strictEqual(R.effectiveTop(r), null);
  assert.strictEqual(R.canPlayRank(r, 5), true);
});
test("7 caps the next player at 7 or lower, but 2/3/10 still work", () => {
  const r = room([C(5)]);
  R.resolvePlay(r, [C(7)], actor());
  assert.strictEqual(r.sevenActive, true);
  assert.strictEqual(R.canPlayRank(r, 6), true);
  assert.strictEqual(R.canPlayRank(r, 7), true);
  assert.strictEqual(R.canPlayRank(r, 8), false);
  assert.strictEqual(R.canPlayRank(r, 14), false);
  for (const special of [2, 3, 10]) assert.strictEqual(R.canPlayRank(r, special), true, special + " should be legal");
});
test("the 7 cap does not persist past the next play", () => {
  const r = room([C(5)]);
  R.resolvePlay(r, [C(7)], actor());
  R.resolvePlay(r, [C(6)], actor());
  assert.strictEqual(r.sevenActive, false);
});
test("a single Jack reverses the order", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(11)], actor());
  assert.strictEqual(r.direction, -1);
});
test("Jacks played in separate turns each reverse", () => {
  const r = room([C(9)]);
  R.resolvePlay(r, [C(11)], actor());
  assert.strictEqual(r.direction, -1);
  R.resolvePlay(r, [C(11, "♥")], actor("P2"));
  assert.strictEqual(r.direction, 1, "the next Jack flips it back");
});
test("any number of Jacks played together reverses exactly once", () => {
  for (const count of [2, 3, 4]) {
    const r = room([C(9)]);
    const cards = ["♠", "♥", "♦", "♣"].slice(0, count).map(s => C(11, s));
    R.resolvePlay(r, cards, actor("Bot 1"));
    assert.strictEqual(r.direction, -1, count + " Jacks together should reverse once");
  }
});

console.log("\nPile and progression");
test("equal or higher is legal, lower is not", () => {
  const r = room([C(9)]);
  assert.strictEqual(R.canPlayRank(r, 9), true);
  assert.strictEqual(R.canPlayRank(r, 10), true);
  assert.strictEqual(R.canPlayRank(r, 8), false);
});
test("picking up the pile moves every card into the hand", () => {
  const r = room([C(4), C(9), C(13)]);
  const p = actor();
  R.pickUpPile(r, p);
  assert.strictEqual(p.hand.length, 3);
  assert.strictEqual(r.pile.length, 0);
  assert.strictEqual(r.sevenActive, false);
});
test("zone order is hand, then face-up, then face-down", () => {
  const p = actor();
  p.faceDown = [C(2), C(3)]; p.faceUp = [C(4)]; p.hand = [C(5)];
  assert.strictEqual(R.activeZone(p), "hand");
  p.hand = [];
  assert.strictEqual(R.activeZone(p), "faceUp");
  p.faceUp = [];
  assert.strictEqual(R.activeZone(p), "faceDown");
  p.faceDown = [];
  assert.strictEqual(R.activeZone(p), null);
});
test("a win needs an empty deck and no cards anywhere", () => {
  const r = room([]);
  const p = actor();
  assert.strictEqual(R.hasWon(r, p), true);
  r.deck = [C(5)];
  assert.strictEqual(R.hasWon(r, p), false, "cards left in the deck means no win yet");
});
test("topRunCount counts the identical-rank run on top", () => {
  assert.strictEqual(R.topRunCount(room([])), 0);
  assert.strictEqual(R.topRunCount(room([C(9)])), 1);
  assert.strictEqual(R.topRunCount(room([C(4), C(9, "♠"), C(9, "♥")])), 2);
  assert.strictEqual(R.topRunCount(room([C(9, "♠"), C(9, "♥"), C(9, "♦")])), 3);
  assert.strictEqual(R.topRunCount(room([C(9, "♠"), C(4), C(9, "♥")])), 1, "a break resets the run");
});
test("a deck has 52 distinct cards per copy", () => {
  assert.strictEqual(R.makeDeck(1).length, 52);
  assert.strictEqual(R.makeDeck(3).length, 156);
  const counts = {};
  for (const c of R.makeDeck(2)) counts[c.rank + c.suit] = (counts[c.rank + c.suit] || 0) + 1;
  assert.strictEqual(Object.keys(counts).length, 52);
  assert.ok(Object.values(counts).every(n => n === 2), "two decks means two of every card");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

import { test } from "node:test";
import assert from "node:assert/strict";
import { DoubleYes, parseAnswer, type Outbound } from "./doubleYes.ts";
import { parseCommand } from "./commands.ts";

const tick = () => new Promise((r) => setTimeout(r, 20));

function setup() {
  const sent: { to: string; msg: Outbound }[] = [];
  const ratings: boolean[] = [];
  const dy = new DoubleYes(async (to, msg) => void sent.push({ to, msg }), {
    offerTtlMs: 1000,
    followUpMs: 5,
    onRating: (_m, _p, worthIt) => void ratings.push(worthIt),
  });
  const offer = () =>
    dy.offer({
      id: "m1",
      a: { id: "alice", name: "Alice", zone: "Zone A", phone: "+15550000001" },
      b: { id: "bob", name: "Bob", zone: "Zone C", phone: "+15550000002" },
      reasonForA: "They solved Spacetime auth yesterday.",
      reasonForB: "They're stuck on Spacetime auth, which you've solved.",
    });
  const texts = () => sent.flatMap((s) => ("text" in s.msg ? [{ to: s.to, ...s.msg }] : []));
  // Anything identifying: a name in a text, or any contact card at all.
  const leaked = () =>
    sent.some((s) => "contactOf" in s.msg) || texts().some((t) => /Alice|Bob/.test(t.text));
  return { dy, sent, texts, leaked, ratings, offer };
}

test("parseAnswer", () => {
  assert.equal(parseAnswer("Yes!"), true);
  assert.equal(parseAnswer("yeah sure"), true);
  assert.equal(parseAnswer("👍"), true);
  assert.equal(parseAnswer("no thanks"), false);
  assert.equal(parseAnswer("find me a designer"), undefined);
  assert.equal(parseAnswer("yesterday was fun"), undefined);
  assert.equal(parseAnswer("nothing yet"), undefined);
});

test("parseCommand", () => {
  assert.equal(parseCommand("STOP"), "stop");
  assert.equal(parseCommand("delete me"), "forget");
  assert.equal(parseCommand("start"), "start");
  assert.equal(parseCommand("stop worrying, who knows Rust?"), undefined);
  assert.equal(parseCommand("delete my GPA"), undefined); // goes to the agent
});

test("offer reveals nothing", async () => {
  const { leaked, sent, offer } = setup();
  await offer();
  assert.equal(sent.length, 2);
  assert.ok(!leaked());
});

test("one yes reveals nothing", async () => {
  const { dy, leaked, offer } = setup();
  await offer();
  assert.equal(await dy.handleReply("alice", "yes"), true);
  assert.ok(!leaked());
  dy.close();
});

test("both yes: names, zones, celebrate, contact cards", async () => {
  const { dy, sent, texts, offer } = setup();
  await offer();
  await dy.handleReply("alice", "yes");
  await dy.handleReply("bob", "yep");
  const toAlice = texts().find((t) => t.to === "alice" && t.text.includes("Bob"));
  assert.ok(toAlice?.text.includes("Zone C") && toAlice.celebrate);
  assert.ok(texts().some((t) => t.to === "bob" && t.text.includes("Alice") && t.text.includes("Zone A")));
  assert.ok(sent.some((s) => s.to === "alice" && "contactOf" in s.msg && s.msg.contactOf.name === "Bob"));
  assert.ok(sent.some((s) => s.to === "bob" && "contactOf" in s.msg && s.msg.contactOf.name === "Alice"));
  dy.close();
});

test("a no never reveals, even after the other said yes", async () => {
  const { dy, leaked, offer } = setup();
  await offer();
  await dy.handleReply("alice", "yes");
  await dy.handleReply("bob", "no");
  assert.ok(!leaked());
  assert.equal(dy.pendingFor("alice"), undefined);
});

test("non yes/no text passes through to the agent", async () => {
  const { dy, offer } = setup();
  await offer();
  assert.equal(await dy.handleReply("alice", "who else is here?"), false);
});

test("offers expire", async () => {
  const { dy, offer } = setup();
  await offer();
  await dy.expire(Date.now() + 2000);
  assert.equal(await dy.handleReply("alice", "yes"), false);
});

test("one worth-it follow-up, rating recorded, then quiet", async () => {
  const { dy, texts, ratings, offer } = setup();
  await offer();
  await dy.handleReply("alice", "yes");
  await dy.handleReply("bob", "yes");
  await tick();
  assert.equal(texts().filter((t) => t.text.includes("worth it")).length, 2);
  assert.equal(await dy.handleReply("alice", "👍"), true);
  assert.equal(await dy.handleReply("bob", "nah"), true);
  assert.deepEqual(ratings, [true, false]);
  assert.equal(await dy.handleReply("alice", "yes"), false); // nothing pending any more
  assert.deepEqual(dy.stats(), { offered: 1, accepted: 1, declined: 0, expired: 0, met: 0, ratings: 2, worthIt: 1 });
});

test("stop declines the open offer quietly and blocks new ones", async () => {
  const { dy, texts, leaked, offer } = setup();
  await offer();
  await dy.handleReply("alice", "yes");
  await dy.pause("bob");
  assert.ok(!leaked());
  assert.ok(texts().some((t) => t.to === "alice" && t.text.includes("didn't work out")));
  await assert.rejects(offer());
  dy.resume("bob");
  await offer();
});

test("forget drops the person's matches", async () => {
  const { dy, offer } = setup();
  await offer();
  await dy.forget("bob");
  assert.equal(dy.stats().offered, 0);
  assert.ok(!dy.pausedIds().includes("bob")); // no trace left
  assert.equal(dy.pendingFor("alice"), undefined);
});

test("badge phases: offer → waiting → matched → met (asks worth-it once) → rate", async () => {
  const { dy, texts, offer } = setup();
  assert.equal(dy.phaseFor("alice").phase, "idle");
  await offer();
  assert.equal(dy.phaseFor("alice").phase, "offer");
  await dy.answerMatch("m1", "alice", true);
  assert.equal(dy.phaseFor("alice").phase, "waiting");
  await dy.answerMatch("m1", "bob", true);
  assert.equal(dy.phaseFor("alice").phase, "matched");
  assert.equal(await dy.markMet("m1"), true);
  assert.equal(await dy.markMet("m1"), false); // only once
  assert.equal(dy.phaseFor("alice").phase, "rate");
  assert.equal(await dy.rate("alice", true), true);
  assert.equal(dy.phaseFor("alice").phase, "met");
  await tick(); // the timed follow-up must not ask again
  assert.equal(texts().filter((t) => t.to === "alice" && t.text.includes("worth it")).length, 1);
  assert.equal(dy.stats().met, 1);
  const me = dy.statsFor("alice");
  assert.equal(me.met, 1);
  assert.equal(me.worthIt, 1);
  assert.ok(me.lastMetAt && me.lastMetAt <= Date.now());
  assert.equal(dy.statsFor("carol").met, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { introPage, profilePage, tokenFor, personFor, forgetToken } from "./miniapp.ts";
import type { Match } from "./doubleYes.ts";

const match = (over: Partial<Match> = {}): Match => ({
  id: "m1",
  a: { id: "alice", name: "Alice", zone: "Lounge", phone: "+15550000001" },
  b: { id: "bob", name: "Bob", zone: "Food Court", phone: "+15550000002" },
  reasonForA: "They solved Spacetime auth.",
  reasonForB: "Someone is stuck on auth you've solved.",
  answers: {},
  ratings: {},
  status: "offered",
  createdAt: 0,
  ...over,
});

test("intro page hides the other person until both say yes", () => {
  for (const m of [match(), match({ answers: { a: true } }), match({ status: "declined", answers: { a: true, b: false } })]) {
    const html = introPage({ m, personId: "alice", token: "t" });
    assert.ok(!/Bob|Food Court|5550000002/.test(html), m.status);
  }
  const done = introPage({ m: match({ status: "accepted", answers: { a: true, b: true } }), personId: "alice", token: "t" });
  assert.match(done, /Meet Bob/);
  assert.match(done, /Food Court/);
});

test("intro page shows buttons only before you answer", () => {
  assert.match(introPage({ m: match(), personId: "alice", token: "t" }), /Yes, intro me/);
  assert.doesNotMatch(introPage({ m: match({ answers: { a: true } }), personId: "alice", token: "t" }), /Yes, intro me/);
});

test("profile page escapes text and offers delete buttons", () => {
  const html = profilePage({
    token: "t",
    paused: false,
    profile: {
      name: "<script>x</script>", headline: "h", skills: ["React"], projects: [], can_help_with: [],
      education: [], experience: [{ title: "Intern", org: "<b>Acme</b>", dates: "2025", location: "" }], interests: ["bouldering"], links: [],
    },
  });
  assert.doesNotMatch(html, /<script>x/);
  assert.doesNotMatch(html, /<b>Acme/);
  assert.match(html, /Delete React/);
  assert.match(html, /🧗 bouldering/);
});

test("tokens map to people and can be revoked", () => {
  const t = tokenFor("carol");
  assert.equal(tokenFor("carol"), t);
  assert.equal(personFor(t), "carol");
  assert.ok(!t.includes("carol"));
  forgetToken("carol");
  assert.equal(personFor(t), undefined);
});

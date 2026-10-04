import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeState, irCode, isPartnerCode, pairColor } from "./badge.ts";
import type { Match } from "./doubleYes.ts";

const m = (over: Partial<Match> = {}): Match => ({
  id: "m1", a: { id: "alice", name: "Alice", zone: "Lounge" }, b: { id: "bob", name: "Bob", zone: "Food Court" },
  reasonForA: "ra", reasonForB: "rb", answers: {}, ratings: {}, status: "offered", createdAt: 0, ...over,
});
const stats = { offered: 1, accepted: 0, met: 0, ratings: 0, worthIt: 0 };

test("IR codes: per side, stable, 31-bit; only the partner's code counts", () => {
  const a = irCode("m1", "alice"), b = irCode("m1", "bob");
  assert.notEqual(a, b);
  assert.equal(a, irCode("m1", "alice"));
  assert.ok(a >= 0 && a <= 0x7fffffff);
  assert.equal(isPartnerCode(m(), "alice", b), true);
  assert.equal(isPartnerCode(m(), "alice", a), false); // your own reflection doesn't count
  assert.equal(pairColor("m1"), pairColor("m1"));
});

test("badge state never shows names, zone or color before a double yes", () => {
  const before = badgeState("alice", { phase: "offer", match: m() }, stats);
  assert.equal(before.otherName, undefined);
  assert.equal(before.otherZone, undefined);
  assert.equal(before.myIrCode, undefined);
  assert.equal(before.reason, "ra");
  const after = badgeState("alice", { phase: "matched", match: m({ status: "accepted", answers: { a: true, b: true } }) }, stats);
  assert.equal(after.otherName, "Bob");
  assert.equal(after.otherZone, "Food Court");
  assert.ok(after.color && after.myIrCode !== undefined);
});

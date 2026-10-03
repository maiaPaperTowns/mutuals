import { test } from "node:test";
import assert from "node:assert/strict";
import { parseZone } from "./zones.ts";

test("parseZone understands short location texts", () => {
  assert.equal(parseZone("I'm in the lounge")?.id, "lounge");
  assert.equal(parseZone("at food court")?.id, "food-court");
  assert.equal(parseZone("Sponsors")?.id, "sponsor-row");
  assert.equal(parseZone("im near the demo stage!")?.id, "demo-stage");
  assert.equal(parseZone("zone: workshop")?.id, "workshop");
});

test("parseZone ignores normal requests", () => {
  assert.equal(parseZone("stuck on the workshop demo"), undefined);
  assert.equal(parseZone("find me a designer"), undefined);
  assert.equal(parseZone("food"), parseZone("food court")); // alias, fine
  assert.equal(parseZone("yes"), undefined);
});

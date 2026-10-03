import { test } from "node:test";
import assert from "node:assert/strict";
import { handlesFromLinks, linkUrls, parseHandles } from "./handles.ts";

test("parseHandles reads the ways people share handles", () => {
  assert.deepEqual(parseHandles("my instagram is @maia.makes"), { instagram: "maia.makes" });
  assert.deepEqual(parseHandles("ig: maia.makes"), { instagram: "maia.makes" });
  assert.deepEqual(parseHandles("https://www.linkedin.com/in/maia-le-123"), { linkedin: "maia-le-123" });
  assert.deepEqual(parseHandles("discord is maia#0420 and github: maia-example"), { discord: "maia#0420", github: "maia-example" });
  assert.equal(parseHandles("who knows react?"), undefined);
  assert.equal(parseHandles("I'm stuck on my instagram clone"), undefined);
});

test("links become tap-able URLs; resume links become handles", () => {
  assert.deepEqual(linkUrls({ instagram: "maia.makes", discord: "x" }), [{ label: "Instagram", url: "https://instagram.com/maia.makes" }]);
  assert.deepEqual(handlesFromLinks(["linkedin.com/in/example", "github.com/example-maia", "maia.dev"]), {
    linkedin: "maia-example", github: "maia-example", website: "maia.dev",
  });
});

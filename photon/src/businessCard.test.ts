import { test } from "node:test";
import assert from "node:assert/strict";
import { cardSvg, renderCard } from "./businessCard.ts";
import { templateOpener, warmOpener } from "./opener.ts";

test("business card renders a PNG with only the person's own details", () => {
  const input = { name: "Elena <Jin>", title: "SDE Intern", org: "AWS", links: { instagram: "elena.makes" }, helpWith: ["computer vision"] };
  const svg = cardSvg(input);
  assert.match(svg, /Elena &lt;Jin&gt;/); // escaped
  assert.match(svg, /SDE Intern @ AWS/);
  assert.match(svg, /@elena\.makes/);
  const png = renderCard(input);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // PNG signature
});

test("opener falls back to a friendly template without Gemini", async () => {
  delete process.env.GEMINI_API_KEY;
  assert.equal(templateOpener("Elena Jin", "Lounge"), "Hey Elena! Mutual matched us 👋 Want to grab 5 min at the Lounge?");
  assert.equal(await warmOpener({ fromName: "Maia", toName: "Elena Jin", reason: "x" }), "Hey Elena! Mutual matched us 👋 Want to grab 5 min?");
});

// Venue zones — same ids/labels as the live map (map/src/types.ts on feat/live-map-spacetimedb).
// The map is anonymous, so people tell the agent their zone by text; it's used in the reveal.

export const ZONES = [
  { id: "main-hall", label: "Main Hall", aliases: ["main hall", "hall", "main room"] },
  { id: "sponsor-row", label: "Sponsor Row", aliases: ["sponsor row", "sponsors", "sponsor", "sponsor booths"] },
  { id: "workshop", label: "Workshop Zone", aliases: ["workshop zone", "workshops", "workshop"] },
  { id: "lounge", label: "Lounge", aliases: ["lounge"] },
  { id: "food-court", label: "Food Court", aliases: ["food court", "food", "dining"] },
  { id: "demo-stage", label: "Demo Stage", aliases: ["demo stage", "stage"] },
] as const;

export type Zone = (typeof ZONES)[number];

function findZone(phrase: string): Zone | undefined {
  const p = phrase.toLowerCase().replace(/^the\s+/, "").replace(/[.!]+$/, "").trim();
  return ZONES.find((z) => z.id === p || z.aliases.some((a) => a === p));
}

/**
 * "I'm in the lounge", "at food court", "lounge", "zone: workshop" → Zone.
 * Only short location statements count, so "stuck on the workshop demo" doesn't move anyone.
 */
export function parseZone(text: string): Zone | undefined {
  const t = text.trim();
  if (t.length > 40) return undefined;
  const m = t.match(/^(?:(?:i'?m|i am|im)\s+)?(?:now\s+)?(?:(?:in|at|near|by)\s+|zone[:\s]+)?(.+)$/i);
  return m ? findZone(m[1]) : undefined;
}

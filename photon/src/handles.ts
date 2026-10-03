// "my instagram is @maia.makes", "linkedin.com/in/example", "discord: maia#1" → handles for the business card.
import type { Links } from "./doubleYes.ts";

// After the keyword, require "is", ":" or "@" so "my instagram clone" isn't read as a handle.
const SEP = String.raw`(?:\s+is\s+@?|\s*:\s*@?|\s+@)`;
const PATTERNS: [keyof Links, RegExp][] = [
  ["linkedin", new RegExp(String.raw`linkedin\.com\/in\/([\w-]{3,100})|\blinkedin\b${SEP}([\w-]{3,100})`, "i")],
  ["instagram", new RegExp(String.raw`instagram\.com\/([\w.]{2,30})|\b(?:instagram|insta|ig)\b${SEP}([\w.]{2,30})`, "i")],
  ["github", new RegExp(String.raw`github\.com\/([\w-]{1,39})|\bgithub\b${SEP}([\w-]{1,39})`, "i")],
  ["discord", new RegExp(String.raw`\bdiscord\b${SEP}([\w.#]{2,37})`, "i")],
];

/** Every handle mentioned in a short text, or undefined if none. */
export function parseHandles(text: string): Links | undefined {
  if (text.length > 200) return undefined;
  const out: Links = {};
  for (const [k, re] of PATTERNS) {
    const m = text.match(re);
    const v = m?.[1] ?? m?.[2];
    if (v) out[k] = v.replace(/[.]+$/, "");
  }
  return Object.keys(out).length ? out : undefined;
}

/** Tap-able URLs for a contact card / page. Discord has no profile URL, so it's returned separately. */
export function linkUrls(l: Links = {}): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (l.linkedin) out.push({ label: "LinkedIn", url: `https://linkedin.com/in/${l.linkedin}` });
  if (l.instagram) out.push({ label: "Instagram", url: `https://instagram.com/${l.instagram}` });
  if (l.github) out.push({ label: "GitHub", url: `https://github.com/${l.github}` });
  if (l.website) out.push({ label: "Website", url: l.website.startsWith("http") ? l.website : `https://${l.website}` });
  return out;
}

/** Pull handles out of resume links like "github.com/example-maia" or "linkedin.com/in/example". */
export function handlesFromLinks(links: string[]): Links {
  const out: Links = {};
  for (const l of links) {
    const h = parseHandles(l);
    if (h) Object.assign(out, h);
    else if (!/linkedin|github|instagram/i.test(l)) out.website ??= l;
  }
  return out;
}

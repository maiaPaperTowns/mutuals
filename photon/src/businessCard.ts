// Business card image (PNG) in the Mutual puppy style, sent in iMessage after a double yes.
// Rendered from the person's own profile (never invented), as SVG → PNG with resvg (no browser needed).
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import type { Links } from "./doubleYes.ts";

export type CardInput = {
  name: string;
  title?: string;
  org?: string;
  headline?: string;
  zone?: string;
  links?: Links;
  helpWith?: string[];
  avatar?: Buffer; // JPEG
};

const W = 1200;
const H = 675;
const FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"; // rounded, ships with macOS
const C = { cream: "#fcfbf1", ink: "#4b4662", muted: "#8f8aa3", line: "#ece8dc", sage: "#d7eadb", sageInk: "#3f6b52" };
const LETTERS: [string, string][] = [["M", "#86cfa0"], ["u", "#93bde9"], ["t", "#f8cd4f"], ["u", "#f3a2a8"], ["a", "#b8a4e3"], ["l", "#8b96d4"]];
const CHIP = [["#efe9fb", "#5b4699"], ["#fde9ea", "#a8505a"], ["#fdf4d4", "#8a6a10"], ["#e6f0fb", "#3f6894"], ["#d7eadb", "#3f6b52"]];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const png = (name: string) => readFileSync(new URL(`../assets/${name}.png`, import.meta.url)).toString("base64");
// Rough width of rounded bold text, good enough to size pills.
const textWidth = (s: string, size: number) => s.length * size * 0.58;

export function cardSvg(c: CardInput): string {
  const initials = c.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const role = [c.title, c.org].filter(Boolean).join(" @ ") || c.headline || "";

  const avatar = c.avatar
    ? `<clipPath id="av"><circle cx="210" cy="250" r="120"/></clipPath>
       <image href="data:${c.avatar[0] === 0x89 ? "image/png" : "image/jpeg"};base64,${c.avatar.toString("base64")}" x="90" y="130" width="240" height="240" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>`
    : `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8a4e3"/><stop offset="1" stop-color="#f3a2a8"/></linearGradient></defs>
       <circle cx="210" cy="250" r="120" fill="url(#g)"/>
       <text x="210" y="278" text-anchor="middle" font-size="84" fill="#fff">${esc(initials)}</text>`;

  // Handles, one per line.
  const l = c.links ?? {};
  const handleRows = [
    l.linkedin && ["in", "#4a7fc1", `linkedin.com/in/${l.linkedin}`],
    l.instagram && ["ig", "#e1707b", `@${l.instagram}`],
    l.github && ["gh", "#4b4662", `github.com/${l.github}`],
    l.discord && ["dc", "#7d65c8", `discord: ${l.discord}`],
    l.website && ["www", "#86cfa0", l.website.replace(/^https?:\/\//, "")],
  ].filter(Boolean) as [string, string, string][];
  const handles = handleRows
    .slice(0, 4)
    .map(([tag, color, text], i) => {
      const y = 340 + i * 46;
      return `<rect x="420" y="${y - 28}" width="52" height="34" rx="10" fill="${color}"/>
        <text x="446" y="${y - 4}" text-anchor="middle" font-size="18" fill="#fff">${tag}</text>
        <text x="488" y="${y - 1}" font-size="26" fill="${C.ink}">${esc(clip(text, 34))}</text>`;
    })
    .join("");

  // "Can help with" pills along the bottom.
  let x = 90;
  const chips = (c.helpWith ?? [])
    .slice(0, 4)
    .map((h, i) => {
      const t = clip(h[0]!.toUpperCase() + h.slice(1), 24);
      const w = textWidth(t, 22) + 40;
      if (x + w > 900) return "";
      const [bg, fg] = CHIP[i % CHIP.length];
      const out = `<rect x="${x}" y="530" width="${w}" height="46" rx="23" fill="${bg}"/>
        <text x="${x + 20}" y="561" font-size="22" fill="${fg}">${esc(t)}</text>`;
      x += w + 12;
      return out;
    })
    .join("");

  const word = LETTERS.map(([ch, col]) => `<tspan fill="${col}">${ch}</tspan>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial Rounded MT Bold">
  <rect width="${W}" height="${H}" fill="${C.cream}"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="48" fill="#fff" stroke="${C.line}" stroke-width="3"/>
  ${avatar}
  <text x="420" y="190" font-size="${c.name.length > 16 ? 54 : 66}" fill="${C.ink}">${esc(clip(c.name, 22))}</text>
  <text x="420" y="240" font-size="${role.length > 38 ? 23 : 28}" fill="${C.muted}">${esc(clip(role, 52))}</text>
  ${c.zone ? `<rect x="420" y="262" width="${textWidth(c.zone, 20) + 56}" height="38" rx="19" fill="${C.sage}"/>
  <circle cx="442" cy="281" r="7" fill="#86cfa0"/>
  <text x="458" y="288" font-size="20" fill="${C.sageInk}">${esc(c.zone)}</text>` : ""}
  ${handles}
  ${chips ? `<text x="90" y="510" font-size="18" letter-spacing="3" fill="${C.muted}">CAN HELP WITH</text>${chips}` : ""}
  <text x="1110" y="118" text-anchor="end" font-size="56" letter-spacing="-1">${word}</text>
  <text x="1110" y="146" text-anchor="end" font-size="16" letter-spacing="4" fill="${C.muted}">PEOPLE FIND PEOPLE</text>
  <image href="data:image/png;base64,${png("pup-happy")}" x="935" y="410" width="200" height="208"/>
  <text x="90" y="${H - 62}" font-size="18" fill="${C.muted}">Met on Mutual at MHacks 2026</text>
</svg>`;
}

export function renderCard(c: CardInput): Buffer {
  const out = new Resvg(cardSvg(c), {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Arial Rounded MT Bold" },
  }).render();
  return out.asPng();
}

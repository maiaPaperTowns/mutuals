// Photon mini apps: web pages that open inside Messages from a tappable app card.
// Spectrum's `app(url)` sends the card; recipients open it in the Spectrum iMessage App.
// Pages are served by the bridge, so PUBLIC_URL must point at it (e.g. a cloudflared tunnel).
import { randomBytes } from "node:crypto";
import type { Match } from "./doubleYes.ts";
import type { ListField, Profile } from "./resume.ts";

export const publicUrl = () => process.env.PUBLIC_URL?.replace(/\/$/, "");

// Unguessable per-person tokens, so URLs never contain phone numbers.
const tokenToPerson = new Map<string, string>();
const personToToken = new Map<string, string>();

export function tokenFor(personId: string): string {
  let t = personToToken.get(personId);
  if (!t) {
    t = randomBytes(12).toString("base64url");
    personToToken.set(personId, t);
    tokenToPerson.set(t, personId);
  }
  return t;
}

export const personFor = (token: string) => tokenToPerson.get(token);

export const tokenEntries = () => [...personToToken];
export function restoreTokens(entries: [string, string][]) {
  for (const [person, token] of entries) {
    personToToken.set(person, token);
    tokenToPerson.set(token, person);
  }
}

export function forgetToken(personId: string) {
  const t = personToToken.get(personId);
  if (t) tokenToPerson.delete(t);
  personToToken.delete(personId);
}

export const profileUrl = (personId: string) => `${publicUrl()}/app/me/${tokenFor(personId)}`;
// The status in the query string makes iMessage refresh the card preview when we edit it.
export const introUrl = (m: Match, personId: string) =>
  `${publicUrl()}/app/intro/${encodeURIComponent(m.id)}/${tokenFor(personId)}?s=${m.status}-${Object.values(m.answers).filter((a) => a !== undefined).length}`;

// ---------- pages ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// photon brand: cream canvas, rounded type, pastel cards, sage section labels, lavender actions,
// and the puppy character (assets/ cut from the brand sheet) in a pose for each moment.
const A = (name: string) => `/app/assets/${name}.png`;
const pup = (name: string, cls = "pup") => `<img class="${cls}" src="${A(name)}" alt="">`;
const icon = (name: string) => `<img class="ico" src="${A(`icon-${name}`)}" alt="">`;
// "Mutual" in the brand sheet's wordmark style: one pastel color per letter, a sparkle, rounded heavy type.
const WORDMARK = `<header class="brand" aria-label="Mutual: people find people"><div class="word" aria-hidden="true">${[
  ["M", "#86cfa0"], ["u", "#93bde9"], ["t", "#f8cd4f"], ["u", "#f3a2a8"], ["a", "#b8a4e3"], ["l", "#8b96d4"],
]
  .map(([ch, c]) => `<span style="color:${c}">${ch}</span>`)
  .join("")}<i>✦</i></div><div class="tagline">people find people</div></header>`;
const CHECK = `<span class="check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 8.5l2.6 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
const label = (text: string, ico?: string) => `<p class="label">${ico ? icon(ico) : ""}<span>${text}</span></p>`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#fcfbf1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:image" content="${A("app-icon")}">
<link rel="icon" href="${A("app-icon")}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--cream:#fcfbf1;--card:#fff;--ink:#4b4662;--muted:#8f8aa3;--line:#ece8dc;
--sage:#d7eadb;--sage-ink:#3f6b52;--green:#86cfa0;--lav:#b8a4e3;--lav-ink:#5b4699;--lav-soft:#efe9fb;
--pink:#f3a2a8;--pink-soft:#fde9ea;--yellow:#f8cd4f;--yellow-soft:#fdf4d4;--blue:#a7cbef;--blue-soft:#e6f0fb;--indigo:#8b96d4}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;background:var(--cream)}
body{margin:0;background:var(--cream);color:var(--ink);font:500 16px/1.45 "Nunito",ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:480px;margin:0 auto;padding:max(10px,env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom))}
.brand{text-align:center;margin:6px 0 12px;line-height:1}
.word{display:inline-block;position:relative;font-weight:900;font-size:50px;letter-spacing:-.02em}
.word i{position:absolute;top:-4px;right:-20px;font-style:normal;font-size:20px;color:#f8cd4f}
.tagline{font-weight:700;font-size:14px;letter-spacing:.22em;color:var(--muted);margin-top:4px}
.pup{display:block;width:150px;height:auto;margin:0 auto -8px;position:relative;z-index:1}
.pup.sm{width:96px;margin:0}
.sticker{display:block;width:230px;max-width:80%;margin:0 auto 4px}
.ico{width:26px;height:26px;border-radius:8px;flex:none}
.card{background:var(--card);border-radius:28px;padding:20px;margin:0 0 14px;box-shadow:0 2px 0 var(--line),0 10px 30px rgba(120,110,80,.06)}
.hero{text-align:center;padding:22px 20px}
.hero h1{font-weight:900;font-size:32px;line-height:1.05;letter-spacing:-.01em;margin:10px 0 4px;color:var(--ink)}
.hero .sub{color:var(--muted);margin:0}
.avatar{width:96px;height:96px;border-radius:30px;object-fit:cover;display:grid;place-items:center;margin:0 auto;font-weight:900;font-size:34px;color:#fff;background:linear-gradient(135deg,var(--lav),var(--pink));border:4px solid #fff;box-shadow:0 6px 18px rgba(184,164,227,.45)}
.who{position:relative;width:96px;margin:0 auto}.who .pup.sm{position:absolute;right:-82px;bottom:-14px;width:84px}
.tags{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:12px 0 0}
.tag{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 12px;font-weight:700;font-size:14px;background:var(--sage);color:var(--sage-ink);text-decoration:none}
.tag.lav{background:var(--lav-soft);color:var(--lav-ink)}.tag.pink{background:var(--pink-soft);color:#b04a55}
.label{display:inline-flex;align-items:center;gap:8px;background:var(--sage);color:var(--sage-ink);border-radius:999px;padding:6px 14px 6px 6px;margin:8px 0 10px;font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
.label .ico{width:22px;height:22px;border-radius:7px}
.status{display:flex;align-items:center;justify-content:space-between;gap:10px}
.status b{display:flex;align-items:center;gap:8px;font-weight:800}
.pin{width:12px;height:12px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--green);display:inline-block}.pin.off{background:#b9b6c4}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:18px;padding:13px 18px;font-family:inherit;font-weight:800;font-size:16px;line-height:1;cursor:pointer;color:#fff;background:#7d65c8;box-shadow:0 4px 0 #5f4aa6}
.btn:active{transform:translateY(2px);box-shadow:0 2px 0 #5f4aa6}
.btn.soft{background:var(--lav-soft);color:var(--lav-ink);box-shadow:0 4px 0 #ddd3f3}
.btn.pink{background:#e1707b;box-shadow:0 4px 0 #b9535d}
.btn.white{background:#fff;color:var(--ink);box-shadow:0 4px 0 var(--line)}
.btn.full{width:100%;padding:16px}
.checks{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:9px;text-align:left}
.checks li{display:flex;align-items:center;gap:10px;font-weight:700}
.check{width:24px;height:24px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;flex:none}.check svg{width:15px;height:15px}
.stack{display:grid;gap:10px}
.role{position:relative;border-radius:22px;padding:14px 44px 14px 16px;background:var(--lav-soft)}
.role:nth-child(4n+2){background:var(--pink-soft)}.role:nth-child(4n+3){background:var(--yellow-soft)}.role:nth-child(4n+4){background:var(--blue-soft)}
.role .when{font-size:13px;font-weight:800;color:var(--muted);letter-spacing:.02em}
.role .title{font-weight:900;font-size:19px;line-height:1.15;margin:2px 0}
.role .org{font-size:14px;color:var(--muted);font-weight:600}
.mini{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.mini span{font-size:12px;font-weight:700;background:rgba(255,255,255,.75);border-radius:999px;padding:3px 9px}
.corner{position:absolute;top:8px;right:8px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.chip{display:inline-flex;align-items:center;gap:2px;border-radius:999px;padding:6px 4px 6px 13px;font-weight:700;font-size:15px;background:var(--lav-soft);color:var(--lav-ink)}
.chip:nth-child(5n+2){background:var(--pink-soft);color:#a8505a}.chip:nth-child(5n+3){background:var(--yellow-soft);color:#8a6a10}
.chip:nth-child(5n+4){background:var(--blue-soft);color:#3f6894}.chip:nth-child(5n+5){background:var(--sage);color:var(--sage-ink)}
form.del{margin:0;display:inline}
.x{border:0;background:none;color:inherit;opacity:.55;font-size:17px;line-height:1;width:26px;height:26px;border-radius:50%;cursor:pointer;flex:none;padding:0}
.x:active{background:rgba(0,0,0,.07)}
.reason{font-size:19px;line-height:1.4;font-weight:700;margin:12px 0 0}
.choices{display:grid;grid-template-columns:1fr 1.25fr;gap:10px}
.fine{font-size:13px;color:var(--muted);line-height:1.5;margin:12px 6px;text-align:center}
.empty{color:var(--muted);margin:0}
.waiting{display:flex;align-items:center;gap:12px;font-weight:800}
</style></head><body><main>${body}</main></body></html>`;
}

const INTEREST_EMOJI: [RegExp, string][] = [
  [/photo|camera|film/i, "📸"], [/climb|boulder/i, "🧗"], [/run|marathon|track/i, "🏃"], [/hik|trail|camp/i, "🥾"],
  [/music|guitar|piano|sing|band|violin|concert|swift/i, "🎵"], [/cook|bak|food|pho|ramen|eat|chef/i, "🍜"],
  [/coffee|latte|tea|matcha/i, "☕"], [/game|gaming|chess|board/i, "🎮"], [/read|book|novel|writ|zine|poem/i, "📚"],
  [/art|draw|paint|sketch|ceramic|pottery|craft|knit/i, "🎨"], [/movie|k-?drama|anime|tv|show/i, "🎬"],
  [/travel|explor/i, "✈️"], [/danc/i, "💃"], [/soccer|football/i, "⚽"], [/basketball/i, "🏀"], [/swim/i, "🏊"],
  [/yoga|gym|lift|fitness/i, "🏋️"], [/volunteer|mentor|teach/i, "🤝"], [/startup|business|invest/i, "🚀"],
  [/garden|plant/i, "🪴"], [/dog|cat|pet/i, "🐾"], [/trivia|puzzle|crossword/i, "🧩"],
];
const emojiFor = (s: string) => INTEREST_EMOJI.find(([re]) => re.test(s))?.[1] ?? "✨";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "🙂";

function del(base: string, field: ListField, i: number, label: string) {
  return `<form class="del" method="post" action="${base}/delete"><input type="hidden" name="field" value="${field}"><input type="hidden" name="i" value="${i}"><button class="x" aria-label="Delete ${esc(label)}">×</button></form>`;
}

export function profilePage(opts: {
  token: string;
  profile?: Profile;
  zone?: string;
  paused: boolean;
  hasAvatar?: boolean;
}): string {
  const { token, profile: p, zone, paused, hasAvatar } = opts;
  const base = `/app/me/${token}`;
  if (!p) {
    return page(
      "Your Mutual card",
      `${WORDMARK}${pup("pup-thinking")}<section class="card hero"><h1>Let's make your card</h1>
<p class="sub">Send me your resume as a photo or PDF in the chat. Everything I keep shows up here, and you can delete any of it.</p></section>`,
    );
  }

  const avatar = hasAvatar
    ? `<img class="avatar" src="${base}/avatar.jpg" alt="">`
    : `<div class="avatar" aria-hidden="true">${esc(initials(p.name))}</div>`;
  const links = p.links
    .map((l) => `<a class="tag lav" href="${esc(l.startsWith("http") ? l : `https://${l}`)}">${esc(l.replace(/^https?:\/\/(www\.)?/, ""))}</a>`)
    .join("");

  const chips = (field: ListField, items: string[], deco = (x: string) => esc(x)) =>
    items.length
      ? `<ul class="chips">${items.map((v, i) => `<li class="chip">${deco(v)}${del(base, field, i, v)}</li>`).join("")}</ul>`
      : `<p class="empty">Nothing here yet.</p>`;

  const help = p.can_help_with.length
    ? `<ul class="checks">${p.can_help_with.map((h) => `<li>${CHECK}${esc(h[0]!.toUpperCase() + h.slice(1))}</li>`).join("")}</ul>`
    : "";

  const roles = p.experience
    .map(
      (e, i) => `<article class="role"><div class="corner">${del(base, "experience", i, e.title || e.org)}</div>
<div class="when">${esc(e.dates || "")}</div><div class="title">${esc(e.title || e.org)}</div>
<div class="org">${esc([e.title ? e.org : "", e.location].filter(Boolean).join(" · "))}</div></article>`,
    )
    .join("");

  const builds = p.projects
    .map(
      (x, i) => `<article class="role"><div class="corner">${del(base, "projects", i, x.name)}</div>
<div class="when">${esc(x.dates || "Project")}</div><div class="title">${esc(x.name)}</div>
<div class="mini">${x.stack.map((t) => `<span>${esc(t)}</span>`).join("")}</div></article>`,
    )
    .join("");

  const school = p.education
    .map(
      (e, i) => `<article class="role"><div class="corner">${del(base, "education", i, e.school)}</div>
<div class="when">${esc(e.dates || "")}</div><div class="title">${esc(e.school)}</div><div class="org">${esc(e.degree)}</div></article>`,
    )
    .join("");

  return page(
    `${p.name || "Your"} on Mutual`,
    `${WORDMARK}
<section class="card hero"><div class="who">${avatar}${pup("pup-happy", "pup sm")}</div>
<h1>${esc(p.name || "You")}</h1><p class="sub">${esc(p.headline)}</p>
<div class="tags">${zone ? `<span class="tag">📍 ${esc(zone)}</span>` : ""}${links}</div>${help}</section>
<section class="card status"><b><span class="pin ${paused ? "off" : ""}"></span>${paused ? "Offline" : "Open to meet"}</b>
<form method="post" action="${base}/${paused ? "resume" : "pause"}" style="margin:0"><button class="btn ${paused ? "" : "soft"}">${paused ? "Go online" : "Pause"}</button></form></section>
${label("Where I've been", "find")}<div class="stack">${roles || `<p class="empty">No roles found. Tell me in the chat and I'll add them.</p>`}</div>
${builds ? `${label("Things I've built", "resume")}<div class="stack">${builds}</div>` : ""}
${school ? `${label("School", "saved")}<div class="stack">${school}</div>` : ""}
${label(`Toolbox · ${p.skills.length}`, "settings")}<section class="card">${chips("skills", p.skills)}</section>
${label("Side quests", "worth")}<section class="card">${p.interests.length ? chips("interests", p.interests, (x) => `${emojiFor(x)} ${esc(x)}`) : `<p class="empty">Text me a few hobbies and I'll add them here.</p>`}</section>
<p class="fine">${hasAvatar ? "Text me a new pic anytime to change your photo." : "📸 Text me a selfie (or any pic that's very you) to add a photo."}<br>
Tap × to delete anything. Only you can see this page. Nothing is shared unless you both say yes.</p>
<form method="post" action="${base}/forget" onsubmit="return confirm('Erase your profile and intros?')"><button class="btn pink full">${icon("delete")} Delete me</button></form>`,
  );
}

export function introPage(opts: { m: Match; personId: string; token: string; otherHasAvatar?: boolean }): string {
  const { m, personId, token, otherHasAvatar } = opts;
  const side = m.a.id === personId ? "a" : "b";
  const other = side === "a" ? m.b : m.a;
  const reason = side === "a" ? m.reasonForA : m.reasonForB;
  const mine = m.answers[side];
  const action = `/app/intro/${encodeURIComponent(m.id)}/${token}`;

  if (m.status === "accepted") {
    const avatar = otherHasAvatar
      ? `<img class="avatar" src="${action}/avatar.jpg" alt="">`
      : `<div class="avatar" aria-hidden="true">${esc(initials(other.name))}</div>`;
    return page(
      "Double yes!",
      `${WORDMARK}<img class="sticker" src="${A("sticker-double-yes")}" alt="Double yes!">
<section class="card hero">${avatar}<h1>Meet ${esc(other.name)}</h1>
<p class="sub">${other.zone ? `They're at ${esc(other.zone)}.` : "You both said yes."}</p>
<p class="reason">${esc(reason)}</p>
<ul class="checks"><li>${CHECK}Their contact card is in your chat</li><li>${CHECK}Go say hi. See you there?</li></ul></section>`,
    );
  }
  if (m.status === "declined" || m.status === "expired") {
    return page(
      "Not this time",
      `${WORDMARK}${pup("pup-resting")}<section class="card hero"><h1>Not this time</h1>
<p class="sub">Nothing about you was shared. I'll keep looking for your people.</p></section>`,
    );
  }
  const ask =
    mine === undefined
      ? `<form method="post" action="${action}" class="choices">
<button class="btn white" name="answer" value="no">Not now</button>
<button class="btn" name="answer" value="yes">${icon("worth")} Yes, intro me</button></form>`
      : `<section class="card waiting">${pup("pup-typing", "pup sm")}<span>You said yes! Waiting on them…</span></section>`;
  return page(
    "Someone nearby",
    `${WORDMARK}${pup("pup-navigating")}<section class="card hero"><h1>Someone nearby!</h1><p class="reason">${esc(reason)}</p>
<ul class="checks"><li>${CHECK}No names until you both say yes</li><li>${CHECK}No zones or numbers shared</li><li>${CHECK}If you pass, they never learn who you are</li></ul></section>
${ask}<p class="fine">You can also just reply YES or NO in the chat.</p>`,
  );
}

export function readForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

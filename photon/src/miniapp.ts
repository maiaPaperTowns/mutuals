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

// Visual style: black canvas, white hero cards, lime pill actions, dark tiles (date small, title big),
// pastel "tutorial" cards, green check lists, and a colorful blob logo.
const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
<g transform="translate(32 32)"><ellipse rx="9" ry="17" fill="#ff4a3d" transform="rotate(-20) translate(0 -12)"/>
<ellipse rx="9" ry="17" fill="#ffc21a" transform="rotate(52) translate(0 -12)"/>
<ellipse rx="9" ry="17" fill="#2fc85a" transform="rotate(124) translate(0 -12)"/>
<ellipse rx="9" ry="17" fill="#2b7bff" transform="rotate(196) translate(0 -12)"/>
<ellipse rx="9" ry="17" fill="#ff7ab8" transform="rotate(268) translate(0 -12)"/>
<circle r="7" fill="#111"/></g></svg>`;

const SPARK = `<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5l6 6-9.8 9.8-6.7 1.2 1.2-6.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12.5 5.5l6 6" stroke="currentColor" stroke-width="1.8"/><circle cx="4" cy="4" r="1.1" fill="currentColor"/><circle cx="7.5" cy="2.5" r=".9" fill="currentColor"/><circle cx="2.5" cy="8" r=".9" fill="currentColor"/></svg>`;

const CHECK = `<span class="check" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 8.5l2.6 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0b0b">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<style>
:root{--bg:#0b0b0b;--tile:#1b1b1b;--tile2:#232323;--ink:#fff;--muted:#8f8f8f;--paper:#fff;--paper-ink:#0b0b0b;--paper-muted:#6b6b6b;
--lime:#d9f24a;--lime-ink:#0b0b0b;--mint:#cfe6dc;--green:#38c35a;--red:#ff4a3d;
--p1:linear-gradient(135deg,#fff 40%,#fff3c4);--p2:linear-gradient(135deg,#fff 35%,#d9efe4);--p3:linear-gradient(135deg,#fff 35%,#e3e9ff);--p4:linear-gradient(135deg,#fff 35%,#ffe1ea)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:480px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 14px calc(28px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;margin:4px 2px 16px}
.logo{width:46px;height:46px}
.spark{width:22px;height:22px}
.pill{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;font:600 17px/1 inherit;letter-spacing:-.01em;padding:14px 20px;text-decoration:none;cursor:pointer;color:var(--ink);background:var(--tile)}
.pill.lime{background:var(--lime);color:var(--lime-ink)}.pill.mint{background:var(--mint);color:var(--paper-ink)}
.pill.ghost{background:transparent;color:var(--ink);padding:10px 4px}
.pill.full{width:100%;justify-content:center;padding:17px}
.seg{display:flex;gap:6px;background:var(--tile);border-radius:999px;padding:5px;margin:0 0 18px}
.seg a{flex:1;text-align:center;border-radius:999px;padding:13px;font-weight:600;font-size:17px;color:var(--ink);text-decoration:none}
.seg a.on{background:var(--mint);color:var(--paper-ink)}
.label{font-size:14px;color:var(--muted);margin:20px 4px 10px}
.hero{background:var(--paper);color:var(--paper-ink);border-radius:30px;padding:24px 22px 22px;margin:0 0 12px;position:relative}
.hero h1{font-size:40px;line-height:1.02;letter-spacing:-.035em;margin:0 0 10px;font-weight:700}
.hero .sub{color:var(--paper-muted);margin:0 0 16px;font-size:16px}
.who{display:flex;align-items:center;gap:14px;margin:0 0 16px}
.avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-weight:700;font-size:24px;color:#0b0b0b;background:conic-gradient(from 200deg,#ffc21a,#ff4a3d,#ff7ab8,#2b7bff,#2fc85a,#ffc21a);flex:none}
.avatar.big{width:92px;height:92px;font-size:34px;border:4px solid var(--lime)}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.checks li{display:flex;align-items:center;gap:12px;font-weight:600;font-size:17px;letter-spacing:-.01em}
.check{width:26px;height:26px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;flex:none}.check svg{width:16px;height:16px}
.status{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--tile);border-radius:24px;padding:10px 10px 10px 18px;margin:0 0 12px;font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;background:var(--muted);display:inline-block;margin-right:8px}.dot.on{background:var(--lime);box-shadow:0 0 0 5px rgba(217,242,74,.18)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tile{position:relative;background:var(--tile);border-radius:26px;padding:16px 16px 18px;min-height:138px;display:flex;flex-direction:column}
.tile .when{font-size:13px;color:var(--muted);margin:0 26px 8px 0}
.tile .title{font-size:21px;line-height:1.08;letter-spacing:-.025em;font-weight:700;margin:0 0 6px}
.tile .org{color:#c9c9c9;font-size:14px;margin-top:auto}
.tut{position:relative;border-radius:26px;padding:16px;min-height:150px;color:var(--paper-ink);background:var(--p1);display:flex;flex-direction:column}
.tut:nth-child(4n+2){background:var(--p2)}.tut:nth-child(4n+3){background:var(--p3)}.tut:nth-child(4n+4){background:var(--p4)}
.tut .when{font-size:13px;color:var(--paper-muted);margin:0 26px 8px 0}
.tut .title{font-size:24px;line-height:1.02;letter-spacing:-.03em;font-weight:700;margin:0 0 10px}
.tut .stack{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto}
.tut .stack span{font-size:11px;font-weight:600;background:rgba(0,0,0,.07);border-radius:999px;padding:3px 8px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.chip{display:inline-flex;align-items:center;gap:2px;background:var(--tile);border:1px solid #2c2c2c;border-radius:999px;padding:7px 4px 7px 14px;font-size:15px;font-weight:500}
.chips.lime .chip{background:rgba(217,242,74,.1);border-color:rgba(217,242,74,.35);color:var(--lime)}
form.del{margin:0;display:inline}
.x{border:0;background:none;color:var(--muted);font-size:17px;line-height:1;width:26px;height:26px;border-radius:50%;cursor:pointer;flex:none;padding:0}
.x:active{background:#333}
.corner{position:absolute;top:10px;right:10px}
.tut .x{color:var(--paper-muted)}.tut .x:active{background:rgba(0,0,0,.08)}
.box{background:var(--tile);border-radius:26px;padding:18px;margin:0 0 12px}
.box h2{font-size:15px;color:var(--muted);font-weight:600;margin:0 0 12px;display:flex;justify-content:space-between}
.reason{font-size:19px;line-height:1.35;letter-spacing:-.01em;margin:0 0 18px;color:var(--paper-ink)}
.options{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#2a2b20;border-radius:30px;padding:12px;margin:0 0 12px}
.opt{position:relative;border:0;border-radius:22px;padding:16px;text-align:left;cursor:pointer;font:inherit;background:var(--paper);color:var(--paper-ink);min-height:132px;display:flex;flex-direction:column}
.opt.yes{background:#efffb0}
.opt .k{font-size:15px;color:var(--paper-muted)}.opt .v{font-size:26px;font-weight:700;letter-spacing:-.03em;margin:6px 0}
.opt .d{font-size:13px;line-height:1.3;margin-top:auto}
.tag{position:absolute;top:12px;right:12px;background:var(--red);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:3px 8px}
.fine{font-size:13px;color:var(--muted);line-height:1.45;margin:14px 4px}
.empty{color:var(--muted);margin:0}
.center{text-align:center}
.bigtitle{font-size:44px;line-height:1;letter-spacing:-.04em;font-weight:700;margin:6px 0 10px}
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
  const top = `<div class="top">${LOGO}<span class="pill ghost">${SPARK} Your agent</span></div>`;
  if (!p) {
    return page(
      "Your profile",
      `${top}<section class="hero"><h1>Let's build your card</h1>
<p class="sub">Send me your resume as a photo or PDF in the chat. Everything I keep shows up here, and you can delete any of it.</p></section>`,
    );
  }

  const avatar = hasAvatar
    ? `<img class="avatar big" src="${base}/avatar.jpg" alt="">`
    : `<div class="avatar big" aria-hidden="true">${esc(initials(p.name))}</div>`;
  const links = p.links
    .map((l) => `<a class="pill mint" style="padding:9px 14px;font-size:14px" href="${esc(l.startsWith("http") ? l : `https://${l}`)}">${esc(l.replace(/^https?:\/\/(www\.)?/, ""))}</a>`)
    .join(" ");

  const chips = (field: ListField, items: string[], cls = "", deco = (x: string) => esc(x)) =>
    items.length
      ? `<ul class="chips ${cls}">${items.map((v, i) => `<li class="chip">${deco(v)}${del(base, field, i, v)}</li>`).join("")}</ul>`
      : `<p class="empty">Nothing here yet.</p>`;

  const help = p.can_help_with.length
    ? `<ul class="checks">${p.can_help_with.map((h) => `<li>${CHECK}${esc(h[0]!.toUpperCase() + h.slice(1))}</li>`).join("")}</ul>`
    : "";

  const roles = p.experience
    .map(
      (e, i) => `<article class="tile"><div class="corner">${del(base, "experience", i, e.title || e.org)}</div>
<p class="when">${esc(e.dates || "—")}</p><p class="title">${esc(e.title || e.org)}</p>
<p class="org">${esc([e.title ? e.org : "", e.location].filter(Boolean).join(" · "))}</p></article>`,
    )
    .join("");

  const school = p.education
    .map(
      (e, i) => `<article class="tile"><div class="corner">${del(base, "education", i, e.school)}</div>
<p class="when">${esc(e.dates || "School")}</p><p class="title">${esc(e.school)}</p><p class="org">${esc(e.degree)}</p></article>`,
    )
    .join("");

  const builds = p.projects
    .map(
      (x, i) => `<article class="tut"><div class="corner">${del(base, "projects", i, x.name)}</div>
<p class="when">Project${x.dates ? ` · ${esc(x.dates)}` : ""}</p><p class="title">${esc(x.name)}</p>
<div class="stack">${x.stack.map((t) => `<span>${esc(t)}</span>`).join("")}</div></article>`,
    )
    .join("");

  return page(
    `${p.name || "Your"} profile`,
    `${top}
<nav class="seg"><a class="on" href="#me">Me</a><a href="#toolbox">Toolbox</a></nav>
<section class="hero" id="me"><div class="who">${avatar}<div>${zone ? `<span class="pill lime" style="padding:7px 12px;font-size:14px">📍 ${esc(zone)}</span>` : ""}</div></div>
<h1>${esc(p.name || "You")}</h1><p class="sub">${esc(p.headline)}</p>${help}</section>
<div class="status"><span><span class="dot ${paused ? "" : "on"}"></span>${paused ? "Intros paused" : "Open to intros"}</span>
<form method="post" action="${base}/${paused ? "resume" : "pause"}" style="margin:0"><button class="pill ${paused ? "lime" : "mint"}" style="padding:11px 16px;font-size:15px">${paused ? "Resume" : "Pause"}</button></form></div>
${links ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 4px">${links}</div>` : ""}
${roles ? `<p class="label">Where I've been</p><div class="grid">${roles}</div>` : `<p class="label">Where I've been</p><p class="fine">No roles found. Tell me in the chat and I'll add them.</p>`}
${builds ? `<p class="label">Things I've built</p><div class="grid">${builds}</div>` : ""}
${school ? `<p class="label">School</p><div class="grid">${school}</div>` : ""}
<p class="label" id="toolbox">Toolbox · ${p.skills.length}</p><div class="box">${chips("skills", p.skills)}</div>
<p class="label">Side quests</p><div class="box">${p.interests.length ? chips("interests", p.interests, "lime", (x) => `${emojiFor(x)} ${esc(x)}`) : `<p class="empty">Text me a few hobbies and I'll add them here.</p>`}</div>
<p class="fine">${hasAvatar ? "Text me a new pic anytime to change your photo." : "📸 Text me a selfie (or any pic that's very you) to add a profile photo."}
Tap × to delete anything. Only you can see this page. Nothing is shared unless you both say yes to an intro.</p>
<form method="post" action="${base}/forget" onsubmit="return confirm('Erase your profile and intros?')"><button class="pill full">Delete everything</button></form>`,
  );
}

export function introPage(opts: { m: Match; personId: string; token: string; otherHasAvatar?: boolean }): string {
  const { m, personId, token, otherHasAvatar } = opts;
  const side = m.a.id === personId ? "a" : "b";
  const other = side === "a" ? m.b : m.a;
  const reason = side === "a" ? m.reasonForA : m.reasonForB;
  const mine = m.answers[side];
  const action = `/app/intro/${encodeURIComponent(m.id)}/${token}`;
  const top = `<div class="top">${LOGO}<span class="pill ghost">${SPARK} Intro</span></div>`;

  if (m.status === "accepted") {
    const avatar = otherHasAvatar
      ? `<img class="avatar big" src="${action}/avatar.jpg" alt="">`
      : `<div class="avatar big" aria-hidden="true">${esc(initials(other.name))}</div>`;
    return page(
      "It's a match",
      `${top}<section class="hero"><div class="who">${avatar}<span class="pill lime" style="padding:8px 14px;font-size:15px">🎉 It's a match</span></div>
<h1>Meet ${esc(other.name)}</h1><p class="sub">${other.zone ? `They're at ${esc(other.zone)}.` : "You both said yes."}</p>
<p class="reason">${esc(reason)}</p>
<ul class="checks"><li>${CHECK}Their contact card is in your chat</li><li>${CHECK}Go say hi!</li></ul></section>`,
    );
  }
  if (m.status === "declined" || m.status === "expired") {
    return page(
      "Intro closed",
      `${top}<section class="hero"><h1>Not this time</h1>
<p class="sub">Nothing about you was shared. I'll keep looking for the right person.</p></section>`,
    );
  }
  const ask =
    mine === undefined
      ? `<form method="post" action="${action}" class="options">
<button class="opt" name="answer" value="no"><span class="k">Pass</span><span class="v">Not now</span><span class="d">Nothing about you is shared.</span></button>
<button class="opt yes" name="answer" value="yes"><span class="tag">2 yes</span><span class="k">Meet</span><span class="v">Yes, intro me</span><span class="d">Names swap only if they say yes too.</span></button></form>`
      : `<div class="status"><span><span class="dot on"></span>You said yes. Waiting on them…</span></div>`;
  return page(
    "New intro",
    `${top}<section class="hero"><h1>Someone nearby</h1><p class="reason">${esc(reason)}</p>
<ul class="checks"><li>${CHECK}No names until you both say yes</li><li>${CHECK}No zones or numbers shared</li><li>${CHECK}If you pass, they never learn who you are</li></ul></section>
${ask}<p class="fine">You can also just reply YES or NO in the chat.</p>`,
  );
}

export function readForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

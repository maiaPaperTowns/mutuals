// Photon bridge: iMessage in → agent → iMessage out, plus the double-yes intro flow.
//
// No SPECTRUM_PROJECT_ID set → runs in the terminal (two chats = two "phones") for testing.
// HTTP API (for the matcher / Spacetime side):
//   POST /offer  { id, a: Person, b: Person, reasonForA, reasonForB }  → starts a double-yes
//   POST /send   { to, text }                                           → plain outbound text
//   GET  /stats                                                         → real intro/rating counts
//   GET  /profiles                                                      → profiles read from resumes
//   POST /welcome { phone, name? }                                      → agent texts someone first
//   POST /profile { phone, name, title?, org?, zone?, links?, skills? }  → ASI agent saves a person's card
//   POST /forget  { phone }                                             → erase a person (delete me on ASI:One)
//   FREE-WILi badge (freewili/badge.py): POST /badge/register {badge, phone}, GET /badge/<badge>/state,
//   POST /badge/<badge>/answer {yes}, /badge/<badge>/rate {worthIt}, /badge/<badge>/ir {code}
//   GET  /app/...                                                       → mini app pages (see miniapp.ts)
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { Spectrum, app as appCard, attachment, contact, edit, richlink, type Message, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { DoubleYes, type Match, type Outbound, type Person } from "./doubleYes.ts";
import { parseCommand, REPLIES } from "./commands.ts";
import { askAgent } from "./agent.ts";
import { parseZone } from "./zones.ts";
import { handlesFromLinks, linkUrls, parseHandles } from "./handles.ts";
import { renderCard } from "./businessCard.ts";
import { warmOpener } from "./opener.ts";
import { badgeState, isPartnerCode } from "./badge.ts";
import * as mini from "./miniapp.ts";
import * as store from "./store.ts";
import { formatProfile, readResumeProfile, toJpeg, UnsupportedResume, type ListField, type Profile } from "./resume.ts";

const cloud = Boolean(process.env.SPECTRUM_PROJECT_ID);
const PORT = Number(process.env.PORT ?? 8787);
// Shorten for demos, e.g. FOLLOW_UP_SECONDS=20.
const FOLLOW_UP_MS = Number(process.env.FOLLOW_UP_SECONDS ?? 45 * 60) * 1000;

// Credentials come from SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET.
const { app, getSpace, dmByPhone } = cloud
  ? await (async () => {
      const app = await Spectrum({ providers: [imessage.config()] });
      const im = imessage(app);
      return {
        app,
        getSpace: (id: string): Promise<Space> => im.space.get(id),
        // Shared pool: this comes from the person's own assigned line, so they never need to know a number.
        dmByPhone: async (phone: string): Promise<Space> => im.space.create(await im.user(phone)),
      };
    })()
  : await (async () => {
      const app = await Spectrum({ providers: [terminal.config({ commands: DEMO_COMMANDS() })] });
      const t = terminal(app);
      return {
        app,
        getSpace: (id: string): Promise<Space> => t.space.get(id),
        dmByPhone: (phone: string): Promise<Space> => t.space.get(phone),
      };
    })();

// Person id = DM space id. Keep live spaces so we can text people proactively.
const spaces = new Map<string, Space>();
const people = new Map<string, Person>();
// Profiles from the stand-in resume reader. TODO(spacetime): move to the `profile` table.
const profiles = new Map<string, Profile>();
const useLocalReader = () => !process.env.AGENT_URL;
// Profile photos (JPEG, ≤512px), and who we've just asked for one.
const avatars = new Map<string, Buffer>();
const awaitingAvatar = new Set<string>();
const ABOUT_ME = /what do you (know|have) (about|on) me/i;
const PROFILE_CMD = /^\s*(my )?(profile|me)\s*[?.!]*\s*$/i;
const MAP_CMD = /^\s*(show me the |open the |the )?map\s*[?.!]*\s*$/i;

/** US-friendly E.164: "(555-010-0002" → "+15550100002". */
function e164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}
/** The person id we use for someone known only by phone (e.g. matched on ASI:One): their iMessage DM id. */
const dmId = (phone: string) => `any;-;${e164(phone)}`;

async function spaceFor(id: string): Promise<Space> {
  const known = spaces.get(id);
  if (known) return known;
  let s: Space;
  try {
    s = await getSpace(id);
  } catch (err) {
    // Never texted us (e.g. came from ASI:One): start the iMessage chat from their phone number.
    const phone = phoneOf(id);
    if (!phone) throw err;
    s = await dmByPhone(phone);
  }
  spaces.set(id, s);
  return s;
}

// photon puppy stickers sent as images in the chat.
const sticker = (name: string) => attachment(new URL(`../assets/${name}.png`, import.meta.url).pathname);

// iMessage DM space ids look like "any;-;+15551234567".
const phoneOf = (id: string) => id.match(/;-;(\+?\d{7,})$/)?.[1];

const send = async (to: string, msg: Outbound) => {
  const space = await spaceFor(to);
  if ("contactOf" in msg) {
    // After a double yes: their business card image, a saveable contact card, and a ready-to-send opener.
    const other = msg.contactOf;
    const m = msg.matchId ? intros.get(msg.matchId) : undefined;
    try {
      const img = renderCard(cardInput(other));
      await space.send(attachment(img, { name: `${other.name.split(" ")[0] || "mutual"}-card.png`, mimeType: "image/png" }));
    } catch (err) {
      console.error("card image failed", err);
    }
    // Each piece on its own: one failing (e.g. contact cards on a provider without them) never blocks the rest.
    await space.send(businessCard(other)).catch((err) => console.error("contact card failed", err));
    if (m) {
      const reason = m.a.id === to ? m.reasonForA : m.reasonForB;
      const opener = await warmOpener({ fromName: people.get(to)?.name ?? "", toName: other.name, zone: other.zone, reason });
      await space.send(`💌 Say hi:\n${opener}`);
    }
  } else if (msg.celebrate && cloud) {
    await space.send(effect(msg.text, imessage.effect.message.confetti));
  } else {
    await space.send(msg.text);
  }
};

const intros = new DoubleYes(send, {
  followUpMs: FOLLOW_UP_MS,
  onChange: (m) => {
    console.log(`[match ${m.id}] ${m.status} answers=${JSON.stringify(m.answers)} ratings=${JSON.stringify(m.ratings)}`);
    void refreshIntroCards(m);
    // TODO(spacetime): upsert into the `match` table here.
  },
  onRating: (m, personId, worthIt) => {
    console.log(`[rating] match=${m.id} person=${personId} worthIt=${worthIt}`);
    // TODO(spacetime): insert into the `rating` table here (Elena's scoreboard reads it).
  },
});
setInterval(() => void intros.expire(), 30_000);

// ---------- user database (AWS DynamoDB or local file, see store.ts) ----------
for (const r of await store.open()) {
  if (r.person) people.set(r.userId, r.person as Person);
  if (r.profile) profiles.set(r.userId, r.profile as Profile);
  if (r.avatar) avatars.set(r.userId, Buffer.from(r.avatar, "base64"));
  if (r.token) mini.restoreTokens([[r.userId, r.token]]);
  if (r.paused) intros.restorePaused([r.userId]);
}

// FREE-WILi badges: badge id (its serial, or a name) → the person wearing it.
const badges = new Map<string, string>();

/** One record per person who has given us anything. */
function userRecords(): store.UserRecord[] {
  const tokens = new Map(mini.tokenEntries());
  const paused = new Set(intros.pausedIds());
  const ids = new Set([...people.keys(), ...profiles.keys(), ...avatars.keys(), ...tokens.keys(), ...paused]);
  return [...ids].map((userId) => ({
    userId,
    person: people.get(userId),
    profile: profiles.get(userId),
    avatar: avatars.get(userId)?.toString("base64"),
    token: tokens.get(userId),
    paused: paused.has(userId) || undefined,
  }));
}
let saving = Promise.resolve();
const saveUsers = () =>
  (saving = saving.then(() => store.sync(userRecords())).catch((err) => console.error("database save failed", err)));
setInterval(saveUsers, 3_000);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => void saveUsers().finally(() => process.exit(0)));
}

// ---------- mini app cards ----------
// Intro cards we've sent, so they can be updated in place as answers come in.
const introCards = new Map<string, Message>();
const cardKey = (m: Match, personId: string) => `${m.id}|${personId}`;
const miniAppsOn = () => cloud && Boolean(mini.publicUrl());
// "link" (default): a normal link preview that opens in Safari, nothing to install.
// "app": a Photon mini app card that opens inside Messages (needs the free Spectrum iMessage app) and updates in place.
const appCards = () => process.env.CARD_STYLE === "app";
const card = (url: string) => (appCards() ? appCard(url) : richlink(url));

async function startIntro(input: Parameters<typeof intros.offer>[0]) {
  const m = await intros.offer(input);
  if (miniAppsOn()) {
    for (const p of [m.a, m.b]) {
      const sent = await (await spaceFor(p.id)).send(card(mini.introUrl(m, p.id)));
      if (sent && appCards()) introCards.set(cardKey(m, p.id), sent);
    }
  }
  return m;
}

async function refreshIntroCards(m: Match) {
  for (const p of [m.a, m.b]) {
    const sent = introCards.get(cardKey(m, p.id));
    if (!sent) continue;
    try {
      await (await spaceFor(p.id)).send(edit(appCard(mini.introUrl(m, p.id)), sent));
    } catch (err) {
      console.error("intro card update failed", err);
    }
  }
}

const WELCOME = (name?: string) =>
  `Hey${name ? ` ${name}` : ""}! I'm Mutual 🐶 I find your people at MHacks.\n` +
  `Send your resume or LinkedIn PDF (profile → More → Save to PDF) to start. Nothing's shared unless you both say yes.`;

/** The agent starts the conversation, so new users just reply. They must already be added in Photon → Users. */
async function welcome(phone: string, name?: string) {
  const space = await dmByPhone(e164(phone));
  spaces.set(space.id, space);
  if (name) people.set(space.id, { ...(people.get(space.id) ?? { id: space.id }), id: space.id, name });
  if (cloud) await space.send(sticker("hero")).catch((e) => console.error("sticker failed", e));
  await space.send(WELCOME(name));
  return space.id;
}

/** What goes on someone's business card image: only what they gave us. */
function cardInput(p: Person) {
  const prof = profiles.get(p.id);
  const role = prof?.experience[0];
  return {
    name: p.name,
    title: p.title || role?.title,
    org: p.org || role?.org,
    headline: prof?.headline,
    zone: p.zone,
    links: p.links,
    helpWith: prof?.can_help_with,
    avatar: avatars.get(p.id),
  };
}

/** Native iMessage contact card: tap "Create New Contact" to save. Sent only after a double yes. */
function businessCard(p: Person) {
  const prof = profiles.get(p.id);
  const role = prof?.experience[0];
  const title = p.title || role?.title;
  const org = p.org || role?.org;
  const photo = avatars.get(p.id);
  const extras = [p.links?.discord && `Discord: ${p.links.discord}`, prof?.headline].filter(Boolean);
  return contact({
    name: { formatted: p.name },
    phones: p.phone ? [{ value: p.phone, type: "mobile" }] : undefined,
    org: title || org ? { name: org, title } : undefined,
    urls: linkUrls(p.links).map((l) => l.url),
    note: [`Met on Mutual · MHacks 2026`, ...extras].join("\n"),
    photo: photo ? { mimeType: "image/jpeg", read: async () => photo } : undefined,
  });
}

async function sendProfileCard(space: Space, id: string) {
  if (!miniAppsOn()) return false;
  await space.send(card(mini.profileUrl(id)));
  return true;
}

// ---------- inbound ----------
async function handle(space: Space, id: string, text: string) {
  if (!cloud && text.startsWith("/")) return demoCommand(space, id, text);
  const cmd = parseCommand(text);
  if (cmd === "stop") await intros.pause(id);
  if (cmd === "start") intros.resume(id);
  if (cmd === "forget") {
    await intros.forget(id);
    people.delete(id);
    profiles.delete(id);
    avatars.delete(id);
    awaitingAvatar.delete(id);
    mini.forgetToken(id);
    await askAgent({ userId: id, event: "forget" }).catch((e) => console.error("agent forget failed", e));
  }
  if (cmd) return void (await space.send(REPLIES[cmd]));

  if (await intros.handleReply(id, text)) return;
  if (awaitingAvatar.has(id) && /^\s*(skip|no|nah|later|no thanks)\b/i.test(text)) {
    awaitingAvatar.delete(id);
    return void (await space.send("No problem! Send a pic anytime 📸"));
  }
  if (/^\s*(new |change |update )?(profile )?(pic|photo|picture|avatar)\s*[.!?]*\s*$/i.test(text)) {
    awaitingAvatar.add(id);
    return void (await space.send("Send it over! 📸"));
  }
  const handles = parseHandles(text);
  if (handles) {
    const p = people.get(id) ?? { id, name: profiles.get(id)?.name ?? "" };
    people.set(id, { ...p, links: { ...p.links, ...handles } });
    const what = Object.keys(handles).map((k) => k[0]!.toUpperCase() + k.slice(1)).join(" + ");
    const tip = handles.linkedin && !profiles.has(id) ? "\nTip: LinkedIn → More → Save to PDF, then send it here for a full card." : "";
    return void (await space.send(`🔗 ${what} added to your card. Only shared after a double yes.${tip}`));
  }
  const zone = parseZone(text);
  if (zone) {
    people.set(id, { ...(people.get(id) ?? { id, name: "" }), zone: zone.label });
    const map = process.env.MAP_URL ? `\nLive map: ${process.env.MAP_URL}` : "";
    return void (await space.send(`📍 ${zone.label}, got it!${map}`));
  }
  if (MAP_CMD.test(text)) {
    if (!process.env.MAP_URL) return void (await space.send("The live map isn't up yet. Tell me your zone instead, like \"I'm in the lounge\"."));
    return void (await space.send(cloud ? card(process.env.MAP_URL) : process.env.MAP_URL));
  }
  if (PROFILE_CMD.test(text) || (useLocalReader() && ABOUT_ME.test(text))) {
    if (profiles.has(id) && (await sendProfileCard(space, id))) return;
  }
  if (useLocalReader() && ABOUT_ME.test(text)) {
    const p = profiles.get(id);
    return void (await space.send(
      p ? `${formatProfile(p)}\nDELETE ME erases it.` : "Nothing yet! Send your resume 📄",
    ));
  }
  await space.responding(async () => {
    const res = await askAgent({ userId: id, text });
    if (res.reply) await space.send(res.reply);
  });
}

(async () => {
  for await (const [space, message] of app.messages) {
    if (message.direction !== "inbound") continue;
    const id = space.id;
    spaces.set(id, space);
    console.log(`[in] ${id} ${message.content.type}${message.content.type === "text" ? `: ${message.content.text}` : ""}`);
    try {
      const c = message.content;
      if (c.type === "text") {
        await handle(space, id, c.text);
      } else if (c.type === "reaction" && (c.emoji === "👍" || c.emoji === "👎")) {
        // Tapback on our "worth it?" text counts as an answer.
        await intros.handleReply(id, c.emoji);
      } else if (c.type === "attachment") {
        // Resume PDF → onboarding agent. Tapback first so they know it landed.
        await message.react("👍");
        await space.responding(async () => {
          const file = Buffer.from(await c.read());
          console.log(`[resume] ${id} ${c.name} ${c.mimeType} ${file.length}B`);
          if (c.mimeType.startsWith("image/") && (await isProfilePhoto(id, file, c.mimeType))) {
            return setAvatar(space, id, file);
          }
          if (useLocalReader()) return readResume(space, id, file, c.mimeType);
          const res = await askAgent({
            userId: id,
            attachment: { name: c.name, mimeType: c.mimeType, base64: file.toString("base64") },
          });
          if (res.reply) await space.send(res.reply);
        });
      }
    } catch (err) {
      console.error("handler error", err);
      await space.send("Oops, something broke 🙈 Try again?").catch(() => {});
    }
  }
})();

/** After a resume, the next picture is a profile photo; otherwise a picture with almost no text is a selfie. */
async function isProfilePhoto(id: string, file: Buffer, mimeType: string): Promise<boolean> {
  if (awaitingAvatar.has(id)) return true;
  if (!profiles.has(id)) return false;
  const { textAmount } = await import("./localResume.ts");
  return (await textAmount(file, mimeType)) < 80;
}

async function setAvatar(space: Space, id: string, file: Buffer) {
  avatars.set(id, await toJpeg(file, 512));
  awaitingAvatar.delete(id);
  await space.send("Looking good! 😎");
  await sendProfileCard(space, id);
}

async function readResume(space: Space, id: string, file: Buffer, mimeType: string) {
  try {
    const p = await readResumeProfile(file, mimeType);
    profiles.set(id, p);
    const prev = people.get(id);
    people.set(id, {
      ...prev,
      id,
      name: p.name || prev?.name || "",
      title: prev?.title ?? p.experience[0]?.title,
      org: prev?.org ?? p.experience[0]?.org,
      links: { ...handlesFromLinks(p.links), ...prev?.links },
    });
    const first = p.name.split(" ")[0];
    const counts = [
      p.experience.length && `${p.experience.length} roles`,
      p.projects.length && `${p.projects.length} projects`,
      `${p.skills.length} skills`,
    ].filter(Boolean).join(" · ");
    const wantsPhoto = !avatars.has(id);
    if (wantsPhoto) awaitingAvatar.add(id);
    const hasCard = miniAppsOn();
    await space.send(
      [
        `✨ Got it${first ? `, ${first}` : ""}! ${counts}`,
        hasCard ? "" : formatProfile(p),
        wantsPhoto ? "📸 Send a selfie for your card (or SKIP)" : "",
        "Then tell me who you want to meet!",
      ].filter(Boolean).join("\n"),
    );
    await sendProfileCard(space, id);
  } catch (err) {
    if (err instanceof UnsupportedResume) {
      return void (await space.send("Send your resume as a photo or PDF 📄"));
    }
    throw err;
  }
}

// ---------- FREE-WILi badge API (called by freewili/badge.py on this laptop) ----------
async function badgeRoute(req: http.IncomingMessage, res: http.ServerResponse) {
  const json = (status: number, body: unknown) =>
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  const path = new URL(req.url ?? "/", "http://x").pathname;

  if (req.method === "POST" && path === "/badge/register") {
    const { badge, phone } = await readJson(req);
    if (!badge || !phone) return json(400, { ok: false, error: "badge and phone required" });
    const id = dmId(String(phone));
    badges.set(String(badge), id);
    console.log(`[badge] ${badge} → ${id}`);
    return json(200, { ok: true, id, name: people.get(id)?.name ?? "" });
  }

  const m = path.match(/^\/badge\/([\w.-]+)\/(state|answer|rate|ir)$/);
  const personId = m ? badges.get(m[1]!) : undefined;
  if (!m || !personId) return json(404, { ok: false, error: "unknown badge; register first" });
  const action = m[2];

  if (req.method === "GET" && action === "state") {
    return json(200, badgeState(personId, intros.phaseFor(personId), intros.stats()));
  }
  const body = await readJson(req);
  const { phase, match } = intros.phaseFor(personId);
  if (action === "answer" && phase === "offer" && match) {
    return json(200, { ok: await intros.answerMatch(match.id, personId, Boolean(body.yes)) });
  }
  if (action === "rate") return json(200, { ok: await intros.rate(personId, Boolean(body.worthIt)) });
  if (action === "ir" && phase === "matched" && match) {
    // The high-five: only counts if the beam carried your match's code.
    const ok = isPartnerCode(match, personId, Number(body.code)) && (await intros.markMet(match.id));
    if (ok) console.log(`[badge] met in person: ${match.id}`);
    return json(200, { ok });
  }
  return json(409, { ok: false, error: `nothing to ${action} right now (${phase})` });
}

// ---------- HTTP API for teammates ----------
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
const readJson = async (req: http.IncomingMessage) => JSON.parse((await readBody(req)) || "{}");

const html = (res: http.ServerResponse, body: string, status = 200) =>
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
const back = (res: http.ServerResponse, to: string) => res.writeHead(303, { location: to }).end();
const jpeg = (res: http.ServerResponse, img: Buffer | undefined) =>
  img ? res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(img) : res.writeHead(404).end();

/**
 * The tunnel makes the bridge public, but only /app/ pages are meant for phones.
 * Teammate endpoints (/offer, /send, /profiles, /stats) need BRIDGE_KEY when called from outside.
 */
function trustedCaller(req: http.IncomingMessage): boolean {
  const viaTunnel = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]);
  const key = process.env.BRIDGE_KEY;
  if (key && req.headers["x-bridge-key"] === key) return true;
  return !viaTunnel;
}

/** Mini app pages. Returns false if the URL isn't one of ours. */
async function miniAppRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? "/", "http://x").pathname;

  // Brand art (puppy poses, stickers, icons) cut from the photon brand sheet.
  const asset = path.match(/^\/app\/assets\/([a-z0-9-]+)\.png$/);
  if (asset) {
    const file = new URL(`../assets/${asset[1]}.png`, import.meta.url).pathname;
    if (!existsSync(file)) return void res.writeHead(404).end(), true;
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" }).end(readFileSync(file));
    return true;
  }

  const me = path.match(/^\/app\/me\/([\w-]+)(?:\/(delete|pause|resume|forget|avatar\.jpg))?$/);
  if (me) {
    const [, token, action] = me;
    const id = mini.personFor(token);
    if (!id) return void html(res, "<p>This link has expired.</p>", 404), true;
    const self = `/app/me/${token}`;
    if (action === "avatar.jpg") return void jpeg(res, avatars.get(id)), true;
    if (req.method === "POST") {
      const form = mini.readForm(await readBody(req));
      const p = profiles.get(id);
      if (action === "delete" && p) {
        const field = form.field as ListField;
        const list = p[field] as unknown[] | undefined;
        if (Array.isArray(list)) list.splice(Number(form.i), 1);
      } else if (action === "pause") await intros.pause(id);
      else if (action === "resume") intros.resume(id);
      else if (action === "forget") {
        await intros.forget(id);
        people.delete(id);
        profiles.delete(id);
        avatars.delete(id);
        mini.forgetToken(id);
        await askAgent({ userId: id, event: "forget" }).catch((e) => console.error("agent forget failed", e));
        return void html(res, "<p style='font:17px -apple-system;padding:24px'>Done. Everything about you is deleted.</p>"), true;
      }
      return back(res, self), true;
    }
    html(res, mini.profilePage({ token, profile: profiles.get(id), zone: people.get(id)?.zone, paused: intros.isPaused(id), hasAvatar: avatars.has(id) }));
    return true;
  }

  const intro = path.match(/^\/app\/intro\/([^/]+)\/([\w-]+)(\/avatar\.jpg)?$/);
  if (intro) {
    const [, matchId, token, wantsAvatar] = intro;
    const id = mini.personFor(token);
    const m = intros.get(decodeURIComponent(matchId));
    if (!id || !m || (m.a.id !== id && m.b.id !== id)) return void html(res, "<p>This intro has expired.</p>", 404), true;
    const otherId = m.a.id === id ? m.b.id : m.a.id;
    // The other person's photo only after both said yes.
    if (wantsAvatar) return void jpeg(res, m.status === "accepted" ? avatars.get(otherId) : undefined), true;
    if (req.method === "POST") {
      const { answer } = mini.readForm(await readBody(req));
      await intros.answerMatch(m.id, id, answer === "yes");
      return back(res, path), true;
    }
    const other = people.get(otherId);
    const card =
      m.status === "accepted"
        ? {
            title: other?.title,
            org: other?.org,
            links: linkUrls(other?.links),
            discord: other?.links?.discord,
            profile: profiles.get(otherId),
          }
        : undefined; // nothing about them before a double yes
    html(res, mini.introPage({ m, personId: id, token, otherHasAvatar: avatars.has(otherId), card }));
    return true;
  }
  return false;
}

http
  .createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/app/") && (await miniAppRoute(req, res))) return;
      if (!trustedCaller(req)) return void res.writeHead(403).end(JSON.stringify({ ok: false, error: "forbidden" }));
      if (req.method === "POST" && req.url === "/offer") {
        const body = await readJson(req);
        for (const p of [body.a, body.b]) {
          if (!p.id && p.phone) p.id = dmId(p.phone); // ASI:One users are identified by phone
          p.phone = p.phone ? e164(p.phone) : phoneOf(p.id);
          Object.assign(p, { ...people.get(p.id), ...p }); // fill title/org/links we already know
          p.zone ??= people.get(p.id)?.zone; // what they last texted us
          p.name ||= people.get(p.id)?.name;
        }
        const m = await startIntro(body);
        res.writeHead(200).end(JSON.stringify({ ok: true, id: m.id }));
      } else if (req.method === "POST" && req.url === "/profile") {
        // The ASI agent saves what it learned on ASI:One, so iMessage intros and business cards can use it.
        const b = await readJson(req);
        if (!b.phone) return void res.writeHead(400).end(JSON.stringify({ ok: false, error: "phone required" }));
        const id = dmId(String(b.phone));
        const prev = people.get(id);
        people.set(id, {
          ...prev,
          id,
          name: b.name ?? prev?.name ?? "",
          phone: e164(String(b.phone)),
          zone: b.zone ?? prev?.zone,
          title: b.title ?? prev?.title,
          org: b.org ?? prev?.org,
          links: { ...prev?.links, ...b.links },
        });
        if (b.headline || b.skills || b.interests || b.can_help_with) {
          const p = profiles.get(id);
          profiles.set(id, {
            name: b.name ?? p?.name ?? "",
            headline: b.headline ?? p?.headline ?? "",
            education: p?.education ?? [],
            experience: p?.experience ?? (b.title || b.org ? [{ title: b.title ?? "", org: b.org ?? "", dates: "", location: "" }] : []),
            projects: p?.projects ?? [],
            skills: b.skills ?? p?.skills ?? [],
            interests: b.interests ?? p?.interests ?? [],
            links: p?.links ?? [],
            can_help_with: b.can_help_with ?? p?.can_help_with ?? [],
          });
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, id }));
      } else if (req.url?.startsWith("/badge/")) {
        return void (await badgeRoute(req, res));
      } else if (req.method === "POST" && req.url === "/forget") {
        // "Delete me" said on ASI:One: erase everything the bridge holds for that phone.
        const { phone } = await readJson(req);
        const id = dmId(String(phone));
        await intros.forget(id);
        people.delete(id);
        profiles.delete(id);
        avatars.delete(id);
        awaitingAvatar.delete(id);
        mini.forgetToken(id);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      } else if (req.method === "POST" && req.url === "/welcome") {
        const { phone, name } = await readJson(req);
        const id = await welcome(String(phone), name);
        res.writeHead(200).end(JSON.stringify({ ok: true, id }));
      } else if (req.method === "POST" && req.url === "/send") {
        const { to, text } = await readJson(req);
        await send(to, { text });
        res.writeHead(200).end(JSON.stringify({ ok: true }));
      } else if (req.method === "GET" && req.url === "/profiles") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Object.fromEntries(profiles)));
      } else if (req.method === "GET" && req.url === "/stats") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(intros.stats()));
      } else {
        res.writeHead(404).end();
      }
    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ ok: false, error: String(err) }));
    }
  })
  .listen(PORT, () => console.log(`photon bridge (${cloud ? "iMessage" : "terminal"}) · http :${PORT}`));

// ---------- terminal-only demo commands ----------
function DEMO_COMMANDS() {
  return [
    { name: "/iam", description: "/iam <name> [zone]: set who this chat is" },
    { name: "/match", description: "/match <other-chat-id> <reason>: start a double-yes with another chat" },
    { name: "/whoami", description: "Show this chat's id" },
  ];
}

async function demoCommand(space: Space, id: string, text: string) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  if (cmd === "/whoami") return void (await space.send(`chat id: ${id}`));
  if (cmd === "/iam") {
    const zone = rest.length > 1 && /^zone$/i.test(rest.at(-2)!) ? rest.splice(-2).join(" ") : undefined;
    people.set(id, { id, name: rest.join(" ") || id, zone });
    return void (await space.send(`ok, you're ${people.get(id)!.name}${zone ? ` in ${zone}` : ""}`));
  }
  if (cmd === "/match") {
    const [otherId, ...reason] = rest;
    const a = people.get(id) ?? { id, name: id };
    const b = people.get(otherId) ?? { id: otherId, name: otherId };
    const why = reason.join(" ") || "You two are working on similar things.";
    await startIntro({ id: `m${Date.now()}`, a, b, reasonForA: why, reasonForB: why });
    return;
  }
  await space.send(`unknown command ${cmd}`);
}

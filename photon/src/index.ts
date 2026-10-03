// Photon bridge: iMessage in → agent → iMessage out, plus the double-yes intro flow.
//
// No SPECTRUM_PROJECT_ID set → runs in the terminal (two chats = two "phones") for testing.
// HTTP API (for the matcher / Spacetime side):
//   POST /offer  { id, a: Person, b: Person, reasonForA, reasonForB }  → starts a double-yes
//   POST /send   { to, text }                                           → plain outbound text
//   GET  /stats                                                         → real intro/rating counts
//   GET  /profiles                                                      → profiles read from resumes
//   POST /welcome { phone, name? }                                      → agent texts someone first
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

async function spaceFor(id: string): Promise<Space> {
  const known = spaces.get(id);
  if (known) return known;
  const s = await getSpace(id);
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
    const p = msg.contactOf;
    await space.send(contact({ name: { formatted: p.name }, phones: [{ value: p.phone!, type: "mobile" }] }));
  } else if (msg.celebrate && cloud) {
    await space.send(effect(msg.text, imessage.effect.message.confetti));
    await space.send(sticker("sticker-double-yes")).catch((e) => console.error("sticker failed", e));
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

// ---------- saved state ----------
{
  const saved = store.load();
  if (saved) {
    for (const [k, v] of saved.people) people.set(k, v as Person);
    for (const [k, v] of saved.profiles) profiles.set(k, v as Profile);
    for (const [k, v] of saved.avatars) avatars.set(k, Buffer.from(v, "base64"));
    mini.restoreTokens(saved.tokens);
    intros.restorePaused(saved.paused);
    console.log(`restored ${profiles.size} profiles, ${avatars.size} photos`);
  }
}
const saveState = () =>
  store.save({
    people: [...people],
    profiles: [...profiles],
    avatars: [...avatars].map(([k, v]) => [k, v.toString("base64")]),
    tokens: mini.tokenEntries(),
    paused: intros.pausedIds(),
  });
setInterval(saveState, 5_000);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    saveState();
    process.exit(0);
  });
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
  `Hey${name ? ` ${name}` : ""}! 👋 I'm Mutual, your networking pup at MHacks. People find people.\n\n` +
  `Send me your resume (a photo or PDF) and tell me what you're stuck on or who you want to meet. ` +
  `I'll find the right person nearby, and nothing is shared unless you both say yes.\n\n` +
  `Tip: save this chat as a contact so it's easy to find. Text HELP anytime.`;

/** The agent starts the conversation, so new users just reply. They must already be added in Photon → Users. */
async function welcome(phone: string, name?: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+") ? digits : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
  const space = await dmByPhone(e164);
  spaces.set(space.id, space);
  if (name) people.set(space.id, { ...(people.get(space.id) ?? { id: space.id }), id: space.id, name });
  if (cloud) await space.send(sticker("hero")).catch((e) => console.error("sticker failed", e));
  await space.send(WELCOME(name));
  return space.id;
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
    return void (await space.send("No problem! Your card will use your initials. Send a pic anytime to change it."));
  }
  if (/^\s*(new |change |update )?(profile )?(pic|photo|picture|avatar)\s*[.!?]*\s*$/i.test(text)) {
    awaitingAvatar.add(id);
    return void (await space.send("Send it over! 📸"));
  }
  const zone = parseZone(text);
  if (zone) {
    people.set(id, { ...(people.get(id) ?? { id, name: "" }), zone: zone.label });
    const map = process.env.MAP_URL ? `\nWant to show up on the live map too? ${process.env.MAP_URL}` : "";
    return void (await space.send(`Got it, you're at ${zone.label}. I'll use that when I introduce you.${map}`));
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
      p ? `Here's everything I have on you:\n${formatProfile(p)}\n\nText DELETE ME to erase it.` : "Nothing yet! Send me your resume (a photo or PDF) and I'll show you what I kept.",
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
      await space.send("Sorry, something broke on my end. Try again in a sec?").catch(() => {});
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
  await space.send("Looking good! 😎 Your card is updated.");
  await sendProfileCard(space, id);
}

async function readResume(space: Space, id: string, file: Buffer, mimeType: string) {
  try {
    const p = await readResumeProfile(file, mimeType);
    profiles.set(id, p);
    if (p.name) people.set(id, { ...people.get(id), id, name: p.name });
    await space.send(
      `Here's what I kept from your resume:\n${formatProfile(p)}\n\n` +
        `Anything wrong, or off-limits? Tell me. Now, what are you stuck on, or who do you want to meet?`,
    );
    await sendProfileCard(space, id);
    if (!avatars.has(id)) {
      awaitingAvatar.add(id);
      await space.send("📸 Want a photo on your card? Send a selfie or any pic that's very you (or text SKIP).");
    }
  } catch (err) {
    if (err instanceof UnsupportedResume) {
      return void (await space.send("I can read resumes as a photo or a PDF. Could you send it as one of those?"));
    }
    throw err;
  }
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
    html(res, mini.introPage({ m, personId: id, token, otherHasAvatar: avatars.has(otherId) }));
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
          p.phone ??= phoneOf(p.id);
          p.zone ??= people.get(p.id)?.zone; // what they last texted us
          p.name ||= people.get(p.id)?.name;
        }
        const m = await startIntro(body);
        res.writeHead(200).end(JSON.stringify({ ok: true, id: m.id }));
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

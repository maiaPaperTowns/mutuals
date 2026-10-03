// Photon bridge: iMessage in → agent → iMessage out, plus the double-yes intro flow.
//
// No SPECTRUM_PROJECT_ID set → runs in the terminal (two chats = two "phones") for testing.
// HTTP API (for the matcher / Spacetime side):
//   POST /offer  { id, a: Person, b: Person, reasonForA, reasonForB }  → starts a double-yes
//   POST /send   { to, text }                                           → plain outbound text
//   GET  /stats                                                         → real intro/rating counts
import http from "node:http";
import { Spectrum, contact, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { DoubleYes, type Outbound, type Person } from "./doubleYes.ts";
import { parseCommand, REPLIES } from "./commands.ts";
import { askAgent } from "./agent.ts";

const cloud = Boolean(process.env.SPECTRUM_PROJECT_ID);
const PORT = Number(process.env.PORT ?? 8787);
// Shorten for demos, e.g. FOLLOW_UP_SECONDS=20.
const FOLLOW_UP_MS = Number(process.env.FOLLOW_UP_SECONDS ?? 45 * 60) * 1000;

// Credentials come from SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET.
const { app, getSpace } = cloud
  ? await (async () => {
      const app = await Spectrum({ providers: [imessage.config()] });
      return { app, getSpace: (id: string): Promise<Space> => imessage(app).space.get(id) };
    })()
  : await (async () => {
      const app = await Spectrum({ providers: [terminal.config({ commands: DEMO_COMMANDS() })] });
      return { app, getSpace: (id: string): Promise<Space> => terminal(app).space.get(id) };
    })();

// Person id = DM space id. Keep live spaces so we can text people proactively.
const spaces = new Map<string, Space>();
const people = new Map<string, Person>();

async function spaceFor(id: string): Promise<Space> {
  const known = spaces.get(id);
  if (known) return known;
  const s = await getSpace(id);
  spaces.set(id, s);
  return s;
}

// iMessage DM space ids look like "any;-;+15551234567".
const phoneOf = (id: string) => id.match(/;-;(\+?\d{7,})$/)?.[1];

const send = async (to: string, msg: Outbound) => {
  const space = await spaceFor(to);
  if ("contactOf" in msg) {
    const p = msg.contactOf;
    await space.send(contact({ name: { formatted: p.name }, phones: [{ value: p.phone!, type: "mobile" }] }));
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
    // TODO(spacetime): upsert into the `match` table here.
  },
  onRating: (m, personId, worthIt) => {
    console.log(`[rating] match=${m.id} person=${personId} worthIt=${worthIt}`);
    // TODO(spacetime): insert into the `rating` table here (Elena's scoreboard reads it).
  },
});
setInterval(() => void intros.expire(), 30_000);

// ---------- inbound ----------
async function handle(space: Space, id: string, text: string) {
  if (!cloud && text.startsWith("/")) return demoCommand(space, id, text);
  const cmd = parseCommand(text);
  if (cmd === "stop") await intros.pause(id);
  if (cmd === "start") intros.resume(id);
  if (cmd === "forget") {
    await intros.forget(id);
    people.delete(id);
    await askAgent({ userId: id, event: "forget" }).catch((e) => console.error("agent forget failed", e));
  }
  if (cmd) return void (await space.send(REPLIES[cmd]));

  if (await intros.handleReply(id, text)) return;
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

// ---------- HTTP API for teammates ----------
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); }
    });
  });
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/offer") {
        const body = await readJson(req);
        for (const p of [body.a, body.b]) p.phone ??= phoneOf(p.id);
        const m = await intros.offer(body);
        res.writeHead(200).end(JSON.stringify({ ok: true, id: m.id }));
      } else if (req.method === "POST" && req.url === "/send") {
        const { to, text } = await readJson(req);
        await send(to, { text });
        res.writeHead(200).end(JSON.stringify({ ok: true }));
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
    await intros.offer({ id: `m${Date.now()}`, a, b, reasonForA: why, reasonForB: why });
    return;
  }
  await space.send(`unknown command ${cmd}`);
}

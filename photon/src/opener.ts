// A ready-to-send first message for after a double yes ("warm intro").
// Gemini writes it when GEMINI_API_KEY is set; otherwise (or if it fails) a friendly template is used.

const first = (name: string) => name.split(/\s+/)[0] || name;

export function templateOpener(toName: string, zone?: string): string {
  return `Hey ${first(toName)}! Mutual matched us 👋 Want to grab 5 min${zone ? ` at the ${zone}` : ""}?`;
}

export async function warmOpener(opts: { fromName: string; toName: string; zone?: string; reason: string }): Promise<string> {
  const fallback = templateOpener(opts.toName, opts.zone);
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fallback;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt =
    `Write one casual, friendly iMessage that ${first(opts.fromName)} could send to ${first(opts.toName)} ` +
    `right after a networking app at a hackathon introduced them. Why they matched: ${opts.reason}. ` +
    `${opts.zone ? `They can meet at the ${opts.zone}. ` : ""}` +
    `Under 25 words, at most one emoji, no hashtags, no quotes. Reply with only the message.`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return text && text.length < 280 ? text.replace(/^["“]|["”]$/g, "") : fallback;
  } catch (err) {
    console.error("gemini opener failed, using template", err);
    return fallback;
  }
}

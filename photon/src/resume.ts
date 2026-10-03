// Stand-in onboarding: resume photo/PDF → profile, using Claude directly.
// Used only when AGENT_URL is unset and ANTHROPIC_API_KEY is set. Once Ziquan's
// onboarding agent is live, AGENT_URL takes over and this goes unused.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const ProfileSchema = z.object({
  name: z.string().describe("Full name, or empty string if not on the resume"),
  headline: z.string().describe("One short line, e.g. 'CS @ University of Michigan \u201927'"),
  education: z
    .array(z.object({ school: z.string(), degree: z.string(), dates: z.string() }))
    .describe("Every school, newest first. Empty strings for unknown fields."),
  experience: z
    .array(z.object({ title: z.string(), org: z.string(), dates: z.string(), location: z.string() }))
    .describe("Every job, internship, research role and leadership role, newest first, dates exactly as written"),
  projects: z
    .array(z.object({ name: z.string(), stack: z.array(z.string()), dates: z.string() }))
    .describe("Every project with the technologies it used"),
  skills: z.array(z.string()).describe("Every skill, language, framework and tool listed anywhere on the resume"),
  interests: z.array(z.string()).describe("Hobbies, interests and side quests, if listed"),
  links: z.array(z.string()).describe("GitHub, LinkedIn, portfolio URLs (not email or phone)"),
  can_help_with: z.array(z.string()).describe("Up to 5 things this person could help another hacker with"),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type ListField = "education" | "experience" | "projects" | "skills" | "interests" | "can_help_with";

const PROMPT =
  "This is a hacker's resume, sent at a hackathon so an agent can introduce them to people who can help, " +
  "or whom they can help. Extract a complete profile: every role with its dates, every project and every skill. " +
  "Only include what the resume actually says; do not guess. Skip email, phone, GPA and street addresses.";

let client: Anthropic | undefined;
export const resumeReaderEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const run = promisify(execFile);
const CLAUDE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof CLAUDE_IMAGE_TYPES)[number];

/** HEIC (iPhone default) and huge photos → JPEG ≤ maxPx using macOS `sips`. */
export async function toJpeg(bytes: Buffer, maxPx = 2000): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "resume-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.jpg");
    await writeFile(src, bytes);
    await run("sips", ["-s", "format", "jpeg", "-Z", String(maxPx), src, "--out", out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function extractProfile(bytes: Buffer, mimeType: string): Promise<Profile> {
  client ??= new Anthropic();

  let block: Anthropic.Beta.BetaContentBlockParam;
  if (mimeType === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } };
  } else if (mimeType.startsWith("image/")) {
    const ok = CLAUDE_IMAGE_TYPES.includes(mimeType as ImageType) && bytes.length < 3_500_000;
    const data = ok ? bytes : await toJpeg(bytes);
    const media_type = ok ? (mimeType as ImageType) : "image/jpeg";
    block = { type: "image", source: { type: "base64", media_type, data: data.toString("base64") } };
  } else {
    throw new UnsupportedResume(mimeType);
  }

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    // If a safety classifier declines, retry on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(ProfileSchema) },
    messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error(`resume extraction failed (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output;
}

export class UnsupportedResume extends Error {
  constructor(public mimeType: string) {
    super(`unsupported resume type ${mimeType}`);
  }
}

export function formatProfile(p: Profile): string {
  const lines = [p.name ? `${p.name} · ${p.headline}` : p.headline];
  for (const e of p.experience.slice(0, 4)) {
    lines.push(`💼 ${[e.title, e.org].filter(Boolean).join(" @ ")}${e.dates ? ` (${e.dates})` : ""}`);
  }
  if (p.projects.length) lines.push(`🛠 Built: ${p.projects.map((x) => x.name).join(", ")}`);
  if (p.skills.length) {
    const more = p.skills.length > 10 ? ` +${p.skills.length - 10} more` : "";
    lines.push(`🧰 ${p.skills.slice(0, 10).join(", ")}${more}`);
  }
  if (p.interests.length) lines.push(`🎲 Side quests: ${p.interests.join(", ")}`);
  if (p.can_help_with.length) lines.push(`🤝 Can help with: ${p.can_help_with.join(", ")}`);
  return lines.join("\n");
}

/** Claude if ANTHROPIC_API_KEY is set, otherwise the free on-device reader. */
export async function readResumeProfile(bytes: Buffer, mimeType: string): Promise<Profile> {
  if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) throw new UnsupportedResume(mimeType);
  if (resumeReaderEnabled()) return extractProfile(bytes, mimeType);
  const { extractProfileLocally } = await import("./localResume.ts");
  return extractProfileLocally(bytes, mimeType);
}

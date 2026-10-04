// Free resume reader: Apple's on-device text recognition (bin/ocr, built from ocr.swift)
// plus section-by-section parsing. No API key, works offline, macOS only.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Profile } from "./resume.ts";

const run = promisify(execFile);
const OCR = new URL("../bin/ocr", import.meta.url).pathname;
const OCR_SRC = new URL("./ocr.swift", import.meta.url).pathname;

async function ensureOcr() {
  if (!existsSync(OCR)) await run("swiftc", ["-O", OCR_SRC, "-o", OCR]);
}

export async function ocr(bytes: Buffer, mimeType: string): Promise<string> {
  await ensureOcr();
  const ext = mimeType === "application/pdf" ? "pdf" : (mimeType.split("/")[1] ?? "img");
  const dir = await mkdtemp(join(tmpdir(), "resume-"));
  try {
    const file = join(dir, `resume.${ext}`);
    await writeFile(file, bytes);
    const { stdout } = await run(OCR, [file], { maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// skill → what someone with it can help with
const SKILLS: [string, RegExp, string][] = [
  ["Python", /\bpython\b/i, "Python scripting"],
  ["JavaScript", /\bjavascript\b|(?<![.\w])js\b/i, "web apps"],
  ["TypeScript", /\btypescript\b/i, "web apps"],
  ["React", /\breact(\.js)?\b(?! native)/i, "frontend / React"],
  ["React Native", /\breact native\b/i, "mobile apps"],
  ["Next.js", /\bnext\.?js\b/i, "frontend / React"],
  ["Node.js", /\bnode(\.js)?\b/i, "backend APIs"],
  ["Swift", /\bswift(ui)?\b/i, "iOS apps"],
  ["Kotlin", /\bkotlin\b/i, "Android apps"],
  ["Flutter", /\bflutter\b/i, "mobile apps"],
  ["Java", /\bjava\b(?!script)/i, "backend / Java"],
  ["C++", /\bc\+\+/i, "systems / C++"],
  ["C", /\bC\b(?![+#])/, "systems / C"],
  ["Go", /\bgolang\b|\bgo\b(?= ?[,/|])/i, "backend APIs"],
  ["Rust", /\brust\b/i, "systems / Rust"],
  ["SQL", /\bsql\b|postgres|mysql|sqlite/i, "databases"],
  ["MongoDB", /\bmongo(db)?\b/i, "databases"],
  ["Firebase", /\bfirebase\b/i, "auth & backend setup"],
  ["Supabase", /\bsupabase\b/i, "auth & backend setup"],
  ["SpacetimeDB", /\bspacetime(db)?\b/i, "realtime backends"],
  ["Docker", /\bdocker\b/i, "deployment / DevOps"],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i, "deployment / DevOps"],
  ["AWS", /\baws\b|amazon web services/i, "cloud deployment"],
  ["GCP", /\bgcp\b|google cloud/i, "cloud deployment"],
  ["PyTorch", /\bpytorch\b/i, "machine learning"],
  ["TensorFlow", /\btensorflow\b/i, "machine learning"],
  ["Machine learning", /machine learning|\bml\b|deep learning/i, "machine learning"],
  ["LLMs / AI agents", /\bllms?\b|langchain|openai|anthropic|claude|\bagents?\b|\brag\b/i, "AI agents & LLM apps"],
  ["Computer vision", /computer vision|opencv/i, "computer vision"],
  ["Data science", /pandas|numpy|data scien/i, "data analysis"],
  ["Figma", /\bfigma\b/i, "UI/UX design"],
  ["UI/UX design", /\bui\/?ux\b|user experience|product design/i, "UI/UX design"],
  ["Hardware", /arduino|raspberry pi|embedded|pcb|fpga/i, "hardware & embedded"],
  ["Unity", /\bunity\b/i, "game dev"],
  ["Git", /\bgit(hub)?\b/i, "Git & GitHub"],
];

// ---------- cleanup ----------

/** Common OCR slips: "OpenAl" → "OpenAI", "SwiftUl" → "SwiftUI", curly dashes → "–". */
function clean(line: string): string {
  return line
    .replace(/\b([A-Za-z]*[A-Z][A-Za-z]*)(A|U)l\b/g, "$1$2I")
    .replace(/\bAl\b/g, "AI")
    .replace(/\s+[-—]\s+/g, " – ")
    .replace(/\s*\((?:\d+\s+(?:years?|yrs?|months?|mos?)\s*)+\)|\s*\(less than a year\)/gi, "") // LinkedIn durations
    .replace(/^page \d+ of \d+$/i, "")
    .replace(/\s*[•·]\s*(?=\(|$)/g, " ")
    .replace(/[  ]{2,}/g, " ")
    .trim();
}

// ---------- sections ----------

type Section = "header" | "education" | "experience" | "projects" | "skills" | "interests" | "other";
const SECTIONS: [Section, RegExp][] = [
  ["education", /^education\b/i],
  ["experience", /^((work|professional|relevant|research|industry) )?experience\b|^employment\b|^internships?\b|^leadership( &| and)? (experience|activities)?|^leadership$|^involvement\b|^extracurriculars?\b/i],
  ["projects", /^((personal|selected|technical|academic) )?projects?\b/i],
  ["skills", /^((technical|core|relevant|top) )?skills\b|^technologies\b|^tech(nical)? stack\b|^tools\b|^languages( &| and) (tools|technologies)/i],
  ["interests", /^(interests|hobbies|side quests?|fun facts?|outside (of )?(work|school)|personal)\b|^(activities|hobbies) (&|and) interests\b/i],
  ["other", /^(awards?|honors?(-awards)?|certifications?|publications?|relevant coursework|coursework|summary|objective|about( me)?|volunteer(ing)?|contact|languages|patents|recommendations)\b/i],
];

function sectionOf(line: string): Section | undefined {
  if (line.includes("\t") || line.length > 45 || /[.,:]$/.test(line)) return undefined;
  return SECTIONS.find(([, re]) => re.test(line.trim()))?.[0];
}

// ---------- dates, places, roles ----------

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const POINT = `(?:(?:${MONTH}|${SEASON})\\s*'?\\d{2,4}|\\d{1,2}/\\d{2,4}|\\b(?:19|20)\\d{2}\\b|present|current|now)`;
const DATES = new RegExp(`(?:expected\\s+)?${POINT}(?:\\s*(?:–|-|—|to)\\s*${POINT})?`, "i");
const isDates = (t: string) => {
  const m = t.match(DATES);
  return Boolean(m && m[0].length >= t.replace(/[()]/g, "").trim().length - 2);
};
// "Ann Arbor, MI", "Pittsburgh, Pennsylvania, United States", "Remote"
const LOCATION = /^(remote|hybrid|[A-Z][a-zA-Z .'-]+(,\s*([A-Z]{2}|[A-Z][a-zA-Z .'-]+)){1,2})$/;
const ROLE = /\b(intern(ship)?|engineer(ing)?|developer|researcher|research assistant|assistant|analyst|designer|scientist|manager|lead|founder|co-?founder|president|director|officer|chair|ta\b|teaching assistant|tutor|consultant|fellow|member|organizer|mentor|associate|coordinator|head of|vp\b|swe\b)/i;
const SCHOOL = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE = /\b([b3]\.?s\.?e?|[b3]\.?a\.?|m\.?s\.?|m\.?eng|ph\.?d|bachelor|master|associate|major|minor|diploma|candidate)\b/i;
const BULLET = /^[•·▪●◦*\-–]\s*/;

type Row = { text: string; dates: string; location: string };

/** Split a visual row into its main text and any right-column dates/location. */
function row(line: string): Row {
  let dates = "";
  let location = "";
  const parts: string[] = [];
  for (const raw of line.split("\t")) {
    const c = raw.trim();
    if (!c) continue;
    if (!dates && isDates(c)) dates = c;
    else if (!location && LOCATION.test(c)) location = c;
    else parts.push(c);
  }
  let text = parts.join(" ");
  // Dates glued to the end of the text: "Software Engineer Intern May 2025 – Aug 2025"
  if (!dates) {
    const m = text.match(new RegExp(`\\s*\\(?(${DATES.source})\\)?$`, "i"));
    if (m && m.index! > 0) {
      dates = m[1];
      text = text.slice(0, m.index).replace(/[|,–-]\s*$/, "").trim();
    }
  }
  return { text, dates, location };
}

const isHeaderLine = (l: string) => !BULLET.test(l) && !/[.!]$/.test(l.trim()) && l.length < 110;

// ---------- section parsers ----------

function splitTitleOrg(text: string): [string, string] | undefined {
  const parts = text.split(/\s+(?:\||@|at|–|—|,)\s+|\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const r = parts.findIndex((x) => ROLE.test(x));
  if (r < 0) return [parts[0], parts.slice(1).join(", ")];
  return [parts[r], parts.filter((_, i) => i !== r).join(", ")];
}

function parseExperience(lines: string[]): Profile["experience"] {
  const out: Profile["experience"] = [];
  let cur: Profile["experience"][number] | undefined;
  let headerCount = 0; // header lines seen for the current entry
  for (const line of lines) {
    if (!isHeaderLine(line)) {
      headerCount = 99; // bullets: next header line starts a new entry
      continue;
    }
    const r = row(line);
    if (!r.text) {
      // Dates or location on their own line (LinkedIn exports) belong to the current role.
      if (cur && r.dates && !cur.dates) cur.dates = r.dates;
      if (cur && r.location && !cur.location) cur.location = r.location;
      continue;
    }
    if (!cur || headerCount >= 2) {
      cur = { title: "", org: "", dates: "", location: "" };
      out.push(cur);
      headerCount = 0;
    }
    headerCount++;
    cur.dates ||= r.dates;
    cur.location ||= r.location;
    const both = !cur.title && !cur.org ? splitTitleOrg(r.text) : undefined;
    if (both && ROLE.test(both[0])) {
      [cur.title, cur.org] = both;
      headerCount = 2;
    } else if (!cur.title && ROLE.test(r.text) && !SCHOOL.test(r.text)) cur.title = r.text;
    else if (!cur.org) cur.org = r.text;
    else if (!cur.title) cur.title = r.text;
  }
  // An entry with only an org line and a role-less title: keep whatever we found.
  return out.filter((e) => e.title || e.org);
}

function parseEducation(lines: string[]): Profile["education"] {
  const out: Profile["education"] = [];
  for (const line of lines.filter(isHeaderLine)) {
    const r = row(line);
    if (SCHOOL.test(r.text) || !out.length) {
      out.push({ school: r.text, degree: "", dates: r.dates });
    } else {
      const e = out[out.length - 1];
      if (!e.degree && (DEGREE.test(r.text) || !e.degree)) e.degree = r.text.replace(/\s*\|?\s*GPA.*$/i, "");
      e.dates ||= r.dates;
    }
  }
  return out.filter((e) => e.school);
}

function parseProjects(lines: string[]): Profile["projects"] {
  const out: Profile["projects"] = [];
  for (const line of lines) {
    if (!isHeaderLine(line)) continue;
    const r = row(line);
    if (!r.text || r.text.length > 90) continue;
    const [name, ...rest] = r.text.split(/\s*[|]\s*|\s+[–—]\s+/);
    const stack = rest.join(",").split(/\s*,\s*/).map((x) => x.trim()).filter((x) => x && x.length <= 30);
    if (name.length >= 2) out.push({ name: name.trim(), stack, dates: r.dates });
  }
  return out;
}

function splitList(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(BULLET, "").replace(/\t/g, ", ").replace(/^[A-Za-z &/]{2,30}:\s*/, ""))
    .flatMap((l) => l.split(/\s*[,;|•·]\s*/))
    .map((x) => x.replace(/^(and|&)\s+/i, "").replace(/[.]$/, "").trim())
    .filter((x) => x.length >= 1 && x.length <= 40);
}

// ---------- header ----------

function guessName(lines: string[]): string {
  for (const l of lines.slice(0, 5)) {
    const t = l.split("\t")[0].trim();
    const words = t.split(/\s+/);
    // Not a school, degree, place or heading ("DePauw University" is not a name).
    if (SCHOOL.test(t) || DEGREE.test(t) || LOCATION.test(t) || sectionOf(t)) continue;
    // Letters in any language ("Lê", "Nguyễn"), a nickname in parentheses ("Maia (Huong) Le").
    const nameWord = /^(\p{Lu}[\p{L}'.-]*|\(\p{Lu}[\p{L}'.-]*\))$/u;
    if (words.length >= 2 && words.length <= 4 && words.every((w) => nameWord.test(w))) {
      // "MAIA LE" → "Maia Le"
      return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s'-])\w/g, (c) => c.toUpperCase()) : t;
    }
  }
  return "";
}

const LINK = /\b((?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com\/in|[a-z0-9-]+\.(?:dev|me|io|design|site|com))\/?[\w\-./]*)/gi;

function headlineFrom(p: Omit<Profile, "headline" | "can_help_with">): string {
  const edu = p.education[0];
  if (edu) {
    const major = edu.degree
      .replace(/[,;|]?\s*(minor|concentration|gpa)\b.*$/i, "") // drop minor/GPA
      .replace(/^.*?\b(?:BSE?|BA|BEng|MS|MEng|MBA|PhD)\s*,\s*/, "") // LinkedIn: "Bachelor of Science - BS, X" → "X"
      .replace(/^.*\b(?:in|of)\s+(?=[A-Z])/, "") // "Bachelor of Science in X" → "X" (last in/of)
      .replace(/^(?:[b3]\.?s\.?e?\.?|[b3]\.?a\.?|m\.?s\.?|m\.?eng\.?|ph\.?d\.?)\s+/i, "") // "B.S.E. X" → "X" (OCR reads B as 3)
      .replace(/\s*[•·|]\s*/g, " & ") // double major: "CS • Communication" → "CS & Communication"
      .replace(/[,.;:&\s]+$/, "")
      .trim();
    const year = edu.dates.match(/(?:19|20)(\d{2})(?!.*\d{4})/)?.[1];
    const school = edu.school.replace(/^the\s+/i, "");
    return [major && major.length < 40 ? major : "", `@ ${school}`, year ? `’${year}` : ""].filter(Boolean).join(" ");
  }
  const job = p.experience[0];
  return job ? [job.title, job.org].filter(Boolean).join(" @ ") : "Hacker at MHacks";
}

// ---------- main ----------

export function profileFromText(raw: string): Profile {
  const lines = raw.split("\n").map(clean).filter(Boolean);
  const text = lines.join("\n");

  const buckets = new Map<Section, string[]>();
  let current: Section = "header";
  for (const l of lines) {
    const s = sectionOf(l);
    if (s) {
      current = s;
      continue;
    }
    if (!buckets.has(current)) buckets.set(current, []);
    buckets.get(current)!.push(l);
  }
  const get = (s: Section) => buckets.get(s) ?? [];

  const education = parseEducation(get("education"));
  const experience = parseExperience(get("experience"));
  const projects = parseProjects(get("projects"));
  const interests = [...new Set(splitList(get("interests")))].slice(0, 12);

  // Skills: everything in the skills section, then known skills mentioned anywhere else.
  const seen = new Set<string>();
  const skills: string[] = [];
  const add = (s: string) => {
    const k = s.toLowerCase().replace(/\s+/g, "");
    if (!seen.has(k)) {
      seen.add(k);
      skills.push(s);
    }
  };
  splitList(get("skills")).forEach(add);
  projects.flatMap((p) => p.stack).forEach(add);
  const hits = SKILLS.map((s) => ({ s, at: text.search(s[1]) })).filter((h) => h.at >= 0).sort((x, y) => x.at - y.at);
  hits.forEach((h) => add(h.s[0]));

  const header = get("header").join("\n");
  const links = [...new Set([...(header.match(LINK) ?? []), ...(text.match(/github\.com\/[\w-]+|linkedin\.com\/in\/[\w-]+/gi) ?? [])])]
    .filter((l) => /github|linkedin|\.(dev|me|io|design|site)\b/i.test(l))
    .slice(0, 3);

  const help = new Set(hits.map((h) => h.s[2]));
  if (experience.some((e) => /design/i.test(e.title))) help.add("UI/UX design");
  if (experience.some((e) => /research/i.test(e.title))) help.add("research");

  const base = { name: guessName(lines), education, experience, projects, skills: skills.slice(0, 40), interests, links };
  return { ...base, headline: headlineFrom(base), can_help_with: [...help].slice(0, 5) };
}

export async function extractProfileLocally(bytes: Buffer, mimeType: string): Promise<Profile> {
  return profileFromText(await ocr(bytes, mimeType));
}

/** How much readable text an image has: selfies have almost none, resumes have lots. */
export async function textAmount(bytes: Buffer, mimeType: string): Promise<number> {
  return (await ocr(bytes, mimeType)).replace(/\s+/g, "").length;
}

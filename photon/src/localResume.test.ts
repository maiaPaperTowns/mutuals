import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileFromText } from "./localResume.ts";

// OCR output (one visual row per line, columns joined by tabs) of two synthetic resumes.
const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("role-first resume: full timeline, education, projects, every skill, side quests", () => {
  const p = profileFromText(fixture("resume-jakes.txt"));
  assert.equal(p.name, "Maia Le");
  assert.equal(p.headline, "Computer Science @ University of Michigan ’27");
  assert.deepEqual(
    p.experience.map((e) => [e.title, e.org, e.dates]),
    [
      ["Software Engineering Intern", "Duolingo", "May 2025 – Aug 2025"],
      ["Product Design Intern", "Figma", "Jun 2024 – Aug 2024"],
      ["Research Assistant", "Michigan HCI Lab", "Sep 2023 – Present"],
    ],
  );
  assert.deepEqual(p.projects.map((x) => x.name), ["Breadcrumbs", "Lecture Lens"]);
  assert.deepEqual(p.projects[1].stack, ["Next.js", "OpenAI API", "Tailwind"]); // "OpenAl" OCR slip fixed
  for (const s of ["TypeScript", "SwiftUI", "HTML/CSS", "Vercel", "Framer", "Notion", "Mapbox"]) assert.ok(p.skills.includes(s), s);
  assert.deepEqual(p.interests, ["Film photography", "bouldering", "making zines", "Taylor Swift trivia", "pho crawls"]);
  assert.ok(p.links.includes("github.com/example-maia"));
  assert.ok(!p.links.some((l) => l.includes("@"))); // never the email
});

test("company-first resume, ALL CAPS name, bullet-separated hobbies", () => {
  const p = profileFromText(fixture("resume-company-first.txt"));
  assert.equal(p.name, "Elena Jin");
  assert.equal(p.headline, "Computer Science @ Tufts University ’27");
  assert.deepEqual(
    p.experience.map((e) => [e.title, e.org, e.dates]),
    [
      ["Software Development Engineer Intern", "Amazon Web Services", "June 2025 – Aug 2025"],
      ["Tech Lead", "Tufts JumboCode", "Sep 2024 – Present"],
    ],
  );
  assert.equal(p.projects[0].name, "SignSpeak");
  assert.deepEqual(p.interests, ["Ceramics", "half marathons", "K-dramas", "latte art"]);
  assert.ok(p.skills.includes("Docker") && p.skills.includes("OpenCV"));
});

// FREE-WILi "Mutual Badge" helpers: each intro gets a pair color, and each side gets an IR code its badge
// beams during the high-five. Seeing your match's code proves you met in person.
import { createHash } from "node:crypto";
import type { Match } from "./doubleYes.ts";

// Brand pastels, a little more saturated so they read on RGB LEDs.
export const PAIR_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "lavender", rgb: [150, 110, 255] },
  { name: "pink", rgb: [255, 90, 120] },
  { name: "yellow", rgb: [255, 190, 20] },
  { name: "blue", rgb: [70, 150, 255] },
  { name: "green", rgb: [60, 220, 120] },
];

const hash = (s: string) => createHash("sha256").update(s).digest();

export const pairColor = (matchId: string) => PAIR_COLORS[hash(matchId)[0]! % PAIR_COLORS.length]!;

/** 31-bit code (fits FREE-WILi's signed 32-bit send_ir_data), unique per match side. */
export const irCode = (matchId: string, personId: string) => hash(`${matchId}|${personId}`).readUInt32BE(0) & 0x7fffffff;

/** Accept the IR code only if it's the *other* person's code for this match. */
export function isPartnerCode(m: Match, personId: string, code: number): boolean {
  const otherId = m.a.id === personId ? m.b.id : m.a.id;
  return code === irCode(m.id, otherId);
}

export type BadgeState = {
  phase: "idle" | "offer" | "waiting" | "matched" | "rate" | "met";
  matchId?: string;
  reason?: string; // no names before a double yes
  otherName?: string; // only after a double yes
  otherZone?: string;
  color?: { name: string; rgb: [number, number, number] };
  myIrCode?: number;
  stats: { offered: number; accepted: number; met: number; ratings: number; worthIt: number };
  // The wearer's own record: drives their pup (level from meetings, hearts from "worth it").
  me?: { intros: number; doubleYes: number; met: number; worthIt: number; notWorthIt: number; lastMetAt?: number };
};

export function badgeState(
  personId: string,
  p: { phase: BadgeState["phase"]; match?: Match },
  stats: BadgeState["stats"],
  me?: BadgeState["me"],
): BadgeState {
  const m = p.match;
  if (!m) return { phase: p.phase, stats, me };
  const mine = m.a.id === personId ? "a" : "b";
  const other = mine === "a" ? m.b : m.a;
  const revealed = m.status === "accepted";
  return {
    phase: p.phase,
    matchId: m.id,
    reason: mine === "a" ? m.reasonForA : m.reasonForB,
    otherName: revealed ? other.name : undefined,
    otherZone: revealed ? other.zone : undefined,
    color: revealed ? pairColor(m.id) : undefined,
    myIrCode: revealed ? irCode(m.id, personId) : undefined,
    stats,
    me,
  };
}

// Double-yes intro flow: nothing identifying is revealed until both people say yes.
// After a reveal: hand off (contact card), one "worth it?" follow-up, then stay quiet.
// Pure logic — sending is injected so this can be tested without Photon.

export type Person = {
  id: string; // stable key (iMessage DM space id)
  name: string;
  zone?: string; // venue zone from the map, e.g. "Zone C"
  phone?: string; // shared only after both say yes
};

export type MatchStatus = "offered" | "accepted" | "declined" | "expired";

export type Match = {
  id: string;
  a: Person;
  b: Person;
  // Plain-English reason from the recruiter agent, written WITHOUT names.
  reasonForA: string;
  reasonForB: string;
  answers: { a?: boolean; b?: boolean };
  ratings: { a?: boolean; b?: boolean };
  status: MatchStatus;
  createdAt: number;
};

export type Outbound =
  | { text: string; celebrate?: boolean }
  | { contactOf: Person };

export type Send = (personId: string, msg: Outbound) => Promise<void>;

export type Options = {
  offerTtlMs?: number;
  followUpMs?: number; // delay before "was it worth it?"
  onChange?: (m: Match) => void; // sync `match` table
  onRating?: (m: Match, personId: string, worthIt: boolean) => void; // sync `rating` table
};

const YES = /^\s*(y|yes|yeah|yep|yup|sure|ok|okay|down|👍)(?!\w)/i;
const NO = /^\s*(n|no|nope|nah|pass|not now|👎)(?!\w)/i;

export function parseAnswer(text: string): boolean | undefined {
  if (YES.test(text)) return true;
  if (NO.test(text)) return false;
  return undefined;
}

export class DoubleYes {
  private matches = new Map<string, Match>();
  private paused = new Set<string>();
  private awaitingRating = new Map<string, Match>(); // personId → match
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ttl: number;
  private followUp: number;

  constructor(private send: Send, private opts: Options = {}) {
    this.ttl = opts.offerTtlMs ?? 15 * 60 * 1000;
    this.followUp = opts.followUpMs ?? 45 * 60 * 1000;
  }

  private text(to: string, text: string, celebrate = false) {
    return this.send(to, { text, celebrate });
  }

  private changed(m: Match) {
    this.opts.onChange?.(m);
  }

  /** The match a person currently owes an answer on, if any (oldest first). */
  pendingFor(personId: string): Match | undefined {
    for (const m of this.matches.values()) {
      if (m.status !== "offered") continue;
      if (m.a.id === personId && m.answers.a === undefined) return m;
      if (m.b.id === personId && m.answers.b === undefined) return m;
    }
    return undefined;
  }

  isPaused(personId: string) {
    return this.paused.has(personId);
  }

  async offer(m: Omit<Match, "answers" | "ratings" | "status" | "createdAt">): Promise<Match> {
    for (const p of [m.a, m.b]) {
      if (this.paused.has(p.id)) throw new Error(`${p.id} has paused intros`);
    }
    const match: Match = { ...m, answers: {}, ratings: {}, status: "offered", createdAt: Date.now() };
    this.matches.set(match.id, match);
    this.changed(match);
    const ask =
      "\n\nWant an intro? Reply YES or NO. I'll only share your name, zone and number if you both say yes.";
    await Promise.all([
      this.text(match.a.id, `I found someone nearby for you. ${match.reasonForA}${ask}`),
      this.text(match.b.id, `Someone nearby could use you. ${match.reasonForB}${ask}`),
    ]);
    return match;
  }

  /** Returns true if the text was consumed (yes/no to an intro, or a rating). */
  async handleReply(personId: string, text: string): Promise<boolean> {
    const answer = parseAnswer(text);
    if (answer === undefined) return false;

    const m = this.pendingFor(personId);
    if (m) {
      await this.answer(m, personId, answer);
      return true;
    }

    const rated = this.awaitingRating.get(personId);
    if (rated) {
      this.awaitingRating.delete(personId);
      rated.ratings[rated.a.id === personId ? "a" : "b"] = answer;
      this.changed(rated);
      this.opts.onRating?.(rated, personId, answer);
      await this.text(personId, answer ? "Love that. Thanks for telling me!" : "Thanks, that helps me find better intros.");
      return true;
    }
    return false;
  }

  get(matchId: string): Match | undefined {
    return this.matches.get(matchId);
  }

  /** Answer one specific intro (from the mini app's buttons). False if it's not open for this person. */
  async answerMatch(matchId: string, personId: string, answer: boolean): Promise<boolean> {
    const m = this.matches.get(matchId);
    if (!m || m.status !== "offered") return false;
    const side = m.a.id === personId ? "a" : m.b.id === personId ? "b" : undefined;
    if (!side || m.answers[side] !== undefined) return false;
    await this.answer(m, personId, answer);
    return true;
  }

  private async answer(m: Match, personId: string, answer: boolean) {
    const side = m.a.id === personId ? "a" : "b";
    const other = side === "a" ? m.b : m.a;
    m.answers[side] = answer;

    if (!answer) {
      m.status = "declined";
      this.changed(m);
      await this.text(personId, "No problem, I won't share anything. I'll keep looking.");
      // Don't tell the other person who passed, only that this one didn't work out.
      if (m.answers[side === "a" ? "b" : "a"] === true) {
        await this.text(other.id, "That intro didn't work out this time. I'll keep looking for you.");
      }
      return;
    }

    if (!(m.answers.a && m.answers.b)) {
      this.changed(m);
      await this.text(personId, "Got it! Waiting on the other person. I'll text you if they say yes too.");
      return;
    }

    m.status = "accepted";
    this.changed(m);
    await Promise.all([this.reveal(m.a, m.b, m.reasonForA), this.reveal(m.b, m.a, m.reasonForB)]);
    this.later(this.followUp, () => this.askWorthIt(m));
  }

  private async reveal(to: Person, other: Person, reason: string) {
    const where = other.zone ? ` They're in ${other.zone}.` : "";
    await this.text(to.id, `It's a match! Meet ${other.name}.${where}\n${reason}`, true);
    if (other.phone) await this.send(to.id, { contactOf: other });
  }

  private async askWorthIt(m: Match) {
    for (const p of [m.a, m.b]) {
      if (this.paused.has(p.id)) continue;
      this.awaitingRating.set(p.id, m);
      const other = p === m.a ? m.b : m.a;
      await this.text(p.id, `Quick one: was meeting ${other.name} worth it? 👍 or 👎`);
    }
  }

  /** Expire offers nobody finished answering. Call on an interval. */
  async expire(now = Date.now()): Promise<void> {
    for (const m of this.matches.values()) {
      if (m.status !== "offered" || now - m.createdAt < this.ttl) continue;
      m.status = "expired";
      this.changed(m);
      for (const [side, p] of [["a", m.a], ["b", m.b]] as const) {
        if (m.answers[side] === true) await this.text(p.id, "That intro timed out. I'll keep looking.");
      }
    }
  }

  // ---------- privacy controls ----------

  /** "stop": no more intros; any open offer is quietly declined. */
  async pause(personId: string) {
    this.paused.add(personId);
    this.awaitingRating.delete(personId);
    const m = this.pendingFor(personId);
    if (m) {
      m.status = "declined";
      this.changed(m);
      const other = m.a.id === personId ? m.b : m.a;
      const otherSide = m.a.id === personId ? "b" : "a";
      if (m.answers[otherSide] === true) {
        await this.text(other.id, "That intro didn't work out this time. I'll keep looking for you.");
      }
    }
  }

  resume(personId: string) {
    this.paused.delete(personId);
  }

  pausedIds(): string[] {
    return [...this.paused];
  }

  restorePaused(ids: string[]) {
    for (const id of ids) this.paused.add(id);
  }

  /** "delete me": pause, then drop every match that mentions this person. */
  async forget(personId: string) {
    await this.pause(personId);
    for (const [id, m] of this.matches) {
      if (m.a.id === personId || m.b.id === personId) this.matches.delete(id);
    }
  }

  /** Real counts only, for the scoreboard. */
  stats() {
    const all = [...this.matches.values()];
    const ratings = all.flatMap((m) => [m.ratings.a, m.ratings.b]).filter((r) => r !== undefined);
    return {
      offered: all.length,
      accepted: all.filter((m) => m.status === "accepted").length,
      declined: all.filter((m) => m.status === "declined").length,
      expired: all.filter((m) => m.status === "expired").length,
      ratings: ratings.length,
      worthIt: ratings.filter(Boolean).length,
    };
  }

  private later(ms: number, fn: () => Promise<void>) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn().catch((err) => console.error("follow-up failed", err));
    }, ms);
    this.timers.add(t);
  }

  /** Cancel pending follow-ups (tests, shutdown). */
  close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

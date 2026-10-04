// Port of agents/calculation.py. Keep weights and normalization identical.
export type NetworkingSubject = {
  id: string; role?: string; goals?: string[]; skills?: string[]; interests?: string[]; offerings?: string[];
  seniority?: number; position?: { zone?: string; x?: number | null; y?: number | null } | null;
  windows?: string[][]; open_to_chat?: boolean; in_session?: boolean; embedding?: number[] | null;
};
type ScoringContext = { now: string; travel_minutes?: number | null; interaction_minutes?: number | null };
const stopwords = new Set('a an and the to of in on for with at by or is are be my me i want get find meet looking learn about more some who'.split(' '));
const influence: Record<string, number> = { recruiter: .9, founder: .8, investor: .85, mentor: .8, professor: .8,
  researcher: .7, engineer: .6, networker: .5, student: .4, event: .7 };
const roleKeywords: Record<string, string> = { recruiter: 'internship job hire hiring career role position offer',
  founder: 'startup cofounder founding venture entrepreneurship', investor: 'funding invest investment fundraising seed vc',
  mentor: 'mentor mentorship advice guidance', professor: 'research phd lab grad graduate', researcher: 'research phd lab paper' };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
function words(texts: string[]): Set<string> {
  const result = new Set<string>();
  for (const text of texts) for (const word of text.toLowerCase().match(/[a-z0-9+#]+/g) ?? []) {
    if (word.length < 2 || stopwords.has(word)) continue;
    result.add(word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  }
  return result;
}
function overlap(a: Set<string>, b: Set<string>): number | null {
  return a.size && b.size ? [...a].filter(x => b.has(x)).length / Math.min(a.size, b.size) : null;
}
function distance(a: NetworkingSubject['position'], b: NetworkingSubject['position']): number | null {
  if (!a || !b) return null;
  if (a.x != null && a.y != null && b.x != null && b.y != null) return Math.hypot(a.x - b.x, a.y - b.y);
  return a.zone && b.zone ? a.zone === b.zone ? 20 : 150 : null;
}
export function scoreNetworking(user: NetworkingSubject, target: NetworkingSubject, context: ScoringContext) {
  const role = (target.role ?? 'student').toLowerCase();
  const goalWords = words(user.goals ?? []);
  let goal = .5;
  if (goalWords.size) {
    const text = overlap(goalWords, words([role, ...(target.offerings ?? [])])) ?? 0;
    const affinity = [...goalWords].some(x => (roleKeywords[role] ?? '').split(' ').includes(x)) ? .8 : 0;
    const a = user.embedding, b = target.embedding;
    let semantic = 0;
    if (a?.length && b?.length) {
      const norm = Math.sqrt(a.reduce((n, x) => n + x * x, 0)) * Math.sqrt(b.reduce((n, x) => n + x * x, 0));
      semantic = norm ? clamp(a.slice(0, b.length).reduce((n, x, i) => n + x * b[i], 0) / norm) : 0;
    }
    goal = clamp(Math.max(text, affinity, semantic));
  }
  const skills = words(user.skills ?? []);
  const needs = words([...(user.goals ?? []), ...(user.interests ?? [])]);
  for (const skill of skills) needs.delete(skill);
  const sharedSkills = overlap(skills, words(target.skills ?? []));
  const complement = overlap(needs, words([...(target.skills ?? []), ...(target.offerings ?? [])]));
  const skill = sharedSkills === null && complement === null ? .5 : clamp(.4 * (sharedSkills ?? 0) + .6 * (complement ?? 0));
  const meters = distance(user.position, target.position);
  const proximity = meters === null ? .5 : 1 / (1 + meters / 150);
  const reach = clamp((target.open_to_chat === false ? .15 : 1) * (target.in_session ? .3 : 1) * (.5 + .5 * proximity));
  const start = Date.parse(context.now), end = start + 12 * 3600000;
  const windows = (subject: NetworkingSubject) => subject.windows?.length ? subject.windows.map(([a, b]) => [Date.parse(a), Date.parse(b)]) : [[start, end]];
  let sharedMinutes = 0;
  for (const [a, b] of windows(user)) for (const [c, d] of windows(target)) sharedMinutes += Math.max(0, Math.min(b, d) - Math.max(a, c, start)) / 60000;
  const needed = context.interaction_minutes || 10;
  const availability = clamp(needed > 0 ? sharedMinutes / needed : 1);
  const seniority = clamp(.5 * (influence[role] ?? .5) + .5 * clamp(.5 + .5 * ((target.seniority ?? 1) - (user.seniority ?? 1)) / 5));
  const travel = context.travel_minutes ?? (meters === null ? 5 : meters / 80);
  const effort = clamp((travel + needed) / 40);
  const value = .5 * goal + .25 * skill + .25 * seniority;
  const breakdown = { goal_alignment: round(goal, 3), skill_overlap_or_complementarity: round(skill, 3), reachability: round(reach, 3),
    availability: round(availability, 3), seniority_or_influence_fit: round(seniority, 3), effort_cost: round(effort, 3) };
  const details: Record<string, number> = { travel_minutes: travel, overlap_minutes: sharedMinutes, skill_overlap: sharedSkills ?? 0,
    skill_complementarity: complement ?? 0, in_session: Number(Boolean(target.in_session)), open_to_chat: Number(target.open_to_chat !== false) };
  if (meters !== null) details.distance_m = meters;
  const parts = [breakdown.goal_alignment >= .7 ? 'Strong goal match' : breakdown.goal_alignment >= .4 ? 'Good goal match' : 'Weak goal match'];
  if (breakdown.skill_overlap_or_complementarity >= .5) parts.push((complement ?? 0) >= (sharedSkills ?? 0) ? 'complementary skills' : 'shared skills');
  if (breakdown.seniority_or_influence_fit >= .7) parts.push('well placed to help');
  if (target.in_session) parts.push('currently in a session');
  else if (target.open_to_chat === false) parts.push('may not be open to chat');
  else if (breakdown.reachability >= .6) parts.push('reachable now');
  if (breakdown.availability < .5) parts.push('limited time overlap');
  parts.push(meters === null ? `~${Math.max(Math.round(travel), 1)} min away` : `${Math.max(Math.round(travel), 1)} min walk`);
  return { score: round(100 * clamp(value * reach * availability / (1 + effort)), 1), breakdown, details, reason: parts.join(', ') };
}

export function profileSubject(profile: Record<string, any>, presence?: { zoneId: string; availabilityStatus: string }): NetworkingSubject {
  return { id: profile.user_id, role: profile.role, goals: profile.goals, skills: profile.skills, interests: profile.interests,
    offerings: profile.offerings, seniority: profile.seniority, windows: profile.free_windows, embedding: profile.embedding,
    position: presence ? { zone: presence.zoneId } : null, open_to_chat: !presence || presence.availabilityStatus === 'free',
    in_session: presence?.availabilityStatus === 'in_session' };
}

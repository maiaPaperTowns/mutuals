// mutuals points & levels: the more people you actually meet, the more points, and your pup levels up.
// Same table as the FREE-WILi badge (freewili/native/photon/display/main.c), which shows them on its screen.
//   +10  someone new shows up near you on the map
//   +50  you find them (within CLOSE_METERS)
//   +10  a practice match caught on the badge (the badge reports its total; the higher total wins)
// Kept in this browser (localStorage): a per-device score for the demo, not an account-wide one.
import { useCallback, useEffect, useRef, useState } from 'react';

export const LEVEL_AT = [0, 50, 100, 200, 400];
export const LEVEL_NAME = ['New here!', 'Getting out there!', 'Making connections!', 'People magnet!', 'Legend!'];
export const PTS_NEARBY = 10;
export const PTS_FOUND = 50;

export const levelOf = (points: number) => LEVEL_AT.filter(at => points >= at).length;

/** 0..1 through the current level (1 at the top level). */
export function levelProgress(points: number): number {
  const level = levelOf(points);
  if (level >= LEVEL_AT.length) return 1;
  return (points - LEVEL_AT[level - 1]!) / (LEVEL_AT[level]! - LEVEL_AT[level - 1]!);
}

type Saved = { points: number; caught: number; nearby: string[]; met: string[] };
const KEY = 'mutuals-points-v1';
const EMPTY: Saved = { points: 0, caught: 0, nearby: [], met: [] };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Saved>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(saved: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: points last this visit */ }
}

export type Gain = { points: number; reason: string; at: number };

export function usePoints() {
  const [saved, setSaved] = useState<Saved>(load);
  const [gain, setGain] = useState<Gain | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const update = useCallback((next: Saved, reason?: string) => {
    const gained = next.points - savedRef.current.points;
    savedRef.current = next;
    setSaved(next);
    save(next);
    if (gained > 0 && reason) setGain({ points: gained, reason, at: Date.now() });
  }, []);

  /** Score what the map shows: new people nearby, and the person you're right next to. */
  const award = useCallback((nearbyIds: string[], foundId: string | undefined, nameOf: (id: string) => string) => {
    const cur = savedRef.current;
    const newNearby = nearbyIds.filter(id => !cur.nearby.includes(id));
    const newFound = foundId && !cur.met.includes(foundId) ? foundId : undefined;
    if (!newNearby.length && !newFound) return;
    const points = cur.points + newNearby.length * PTS_NEARBY + (newFound ? PTS_FOUND : 0);
    const reason = newFound ? `you found ${nameOf(newFound)}!` : `${nameOf(newNearby[0]!)} is nearby`;
    update({
      ...cur,
      points,
      nearby: [...cur.nearby, ...newNearby],
      met: newFound ? [...cur.met, newFound] : cur.met,
    }, reason);
  }, [update]);

  /** The badge's own total (practice matches); keep whichever is higher. */
  const adopt = useCallback((badgePoints: number, badgeCaught: number) => {
    const cur = savedRef.current;
    if (badgePoints <= cur.points && badgeCaught <= cur.caught) return;
    update({ ...cur, points: Math.max(cur.points, badgePoints), caught: Math.max(cur.caught, badgeCaught) }, 'practice on your badge');
  }, [update]);

  // Gains fade out after a few seconds.
  useEffect(() => {
    if (!gain) return;
    const timer = window.setTimeout(() => setGain(null), 3500);
    return () => window.clearTimeout(timer);
  }, [gain]);

  const level = levelOf(saved.points);
  return { points: saved.points, met: saved.met.length, caught: saved.caught, level, progress: levelProgress(saved.points), gain, award, adopt };
}

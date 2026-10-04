import { useEffect, useState, type ReactNode } from 'react';
import { useProcedure, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { procedures, tables } from './module_bindings';

type Event = { eventId: string; title: string; phase: string };
type Star = { eventId: string; targetId: string };

export function Accordion({ title, children }: { title: string; children: ReactNode }) {
  return <details className="home-accordion"><summary>{title}<span aria-hidden="true">⌄</span></summary><div className="accordion-content">{children}</div></details>;
}

export function HomeNavigation({ events, memberEventIds, signedIn }: { events: readonly Event[]; memberEventIds: readonly string[]; signedIn: boolean }) {
  return <nav className="home-navigation" aria-label="Events and agent chats">
    <Accordion title="Events">{events.length ? events.map(event => <a key={event.eventId} href={`/events?event=${encodeURIComponent(event.eventId)}`}>{event.title}</a>) : <p>No published events yet.</p>}<a className="accordion-all" href="/events">All events →</a></Accordion>
    <Accordion title="Assistance">{signedIn ? <>{events.filter(event => memberEventIds.includes(event.eventId)).map(event => <a key={event.eventId} href={`/assistant?event=${encodeURIComponent(event.eventId)}`}>{event.title}</a>)}<a className="accordion-all" href="/assistant">All agent chats</a></> : <p>Sign in to open your saved agent chats.</p>}</Accordion>
  </nav>;
}

export function LiveHomeNavigation({ signedIn }: { signedIn: boolean }) {
  const [events] = useTable(tables.networkingInvitations);
  const [members] = useTable(tables.myNetworkingMemberships);
  const [messages] = useTable(tables.myAssistantMessages);
  return <HomeNavigation events={events} memberEventIds={signedIn ? [...members, ...messages].map(row => row.eventId) : []} signedIn={signedIn} />;
}

export function FavoritePeople({ stars, events, names, signedIn, ongoingEventsByPerson = {}, error = '' }: { stars: readonly Star[]; events: readonly Event[]; names: Record<string, string>; signedIn: boolean; ongoingEventsByPerson?: Record<string, string[]>; error?: string }) {
  const people = new Map<string, Event[]>();
  if (signedIn) for (const star of stars) {
    const event = events.find(event => event.eventId === star.eventId);
    const saved = people.get(star.targetId) ?? [];
    if (event && !saved.some(row => row.eventId === event.eventId)) saved.push(event);
    people.set(star.targetId, saved);
  }
  for (const [id, saved] of people) for (const eventId of ongoingEventsByPerson[id] ?? []) {
    const event = events.find(event => event.eventId === eventId && event.phase === 'during');
    if (event && !saved.some(row => row.eventId === eventId)) saved.push(event);
  }
  return <aside className="home-people" aria-label="Starred people"><Accordion title="People">
    {!signedIn ? <p>Sign in to see your starred people.</p> : !people.size ? <p>Star people in an event to keep them here.</p> : <ul className="favorite-list">{[...people].sort((a, b) => Number(b[1].some(event => event.phase === 'during')) - Number(a[1].some(event => event.phase === 'during'))).map(([id, personEvents]) => {
      const ongoing = personEvents.some(event => event.phase === 'during');
      return <li key={id} className={ongoing ? 'favorite-ongoing' : ''}><span className="person-avatar" aria-hidden="true">{(names[id] || '?').slice(0, 1).toUpperCase()}</span><div><b>{names[id] || 'Saved participant'}</b>{ongoing && <small className="ongoing-label">Ongoing event</small>}<div className="favorite-events">{personEvents.map(event => <a key={event.eventId} href={`/events?event=${encodeURIComponent(event.eventId)}`}>{event.title}</a>)}</div></div><span className="favorite-marker" aria-hidden="true">★</span></li>;
    })}</ul>}
    {error && <p role="alert">{error}</p>}
  </Accordion></aside>;
}

export function LiveFavoritePeople({ signedIn }: { signedIn: boolean }) {
  const [events] = useTable(tables.networkingInvitations);
  const [stars] = useTable(tables.myEventStars);
  const [members] = useTable(tables.myNetworkingMemberships);
  const { isActive } = useSpacetimeDB();
  const list = useProcedure(procedures.getEventInterestList);
  const [resolved, setResolved] = useState<{ owner: string; names: Record<string, string>; ongoingEventsByPerson: Record<string, string[]>; error: string }>({ owner: '', names: {}, ongoingEventsByPerson: {}, error: '' });
  const owner = signedIn ? members[0]?.userId ?? '' : '';
  const key = JSON.stringify(stars.map(star => [star.eventId, star.targetId]));
  const rosterKey = JSON.stringify(members.map(member => member.eventId));
  const phaseKey = JSON.stringify(events.map(event => [event.eventId, event.phase]));
  useEffect(() => {
    let cancelled = false;
    if (!owner || !isActive) { setResolved({ owner: '', names: {}, ongoingEventsByPerson: {}, error: '' }); return; }
    void (async () => {
      const names: Record<string, string> = {};
      const ongoingEventsByPerson: Record<string, string[]> = {};
      const ongoingIds = events.filter(event => event.phase === 'during').map(event => event.eventId);
      const failures = await Promise.allSettled([...new Set([...stars.map(star => star.eventId), ...ongoingIds])].filter(eventId => members.some(member => member.eventId === eventId)).map(async eventId => {
        const remaining = new Set(stars.map(star => star.targetId));
        for (let offset = 0; remaining.size; offset += 50) {
          const result = JSON.parse(await list({ eventId, offset, limit: 50 }));
          for (const item of result.items) if (remaining.delete(item.target_id)) {
            names[item.target_id] = item.target_name;
            if (ongoingIds.includes(eventId)) (ongoingEventsByPerson[item.target_id] ??= []).push(eventId);
          }
          if (!result.ready || !result.items.length || offset + 50 >= result.total) break;
        }
      }));
      if (!cancelled) setResolved({ owner, names, ongoingEventsByPerson, error: failures.some(result => result.status === 'rejected') ? 'Some saved names could not load. Reopen this page to retry.' : '' });
    })();
    return () => { cancelled = true; };
  }, [owner, isActive, key, rosterKey, phaseKey, list]);
  return <FavoritePeople signedIn={signedIn} stars={stars} events={events} names={resolved.owner === owner ? resolved.names : {}} ongoingEventsByPerson={resolved.owner === owner ? resolved.ongoingEventsByPerson : {}} error={resolved.owner === owner ? resolved.error : ''} />;
}

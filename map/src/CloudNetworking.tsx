import { useEffect, useRef, useState } from 'react';
import { useProcedure, useReducer, useTable } from 'spacetimedb/react';
import { procedures, reducers, tables } from './module_bindings';
import { ZONES } from './types';

type Match = { target_id: string; target_name: string; role: string; location: { zone: string }; roi_score: number; reason_for_connection: string };
type Activity = { event: { event_id: string; title: string; start: string }; roi_score: number; reason: string };

export default function CloudNetworking() {
  const load = useProcedure(procedures.loadCloudProfile);
  const findPeople = useProcedure(procedures.getCloudOpportunities);
  const findEvents = useProcedure(procedures.getCloudEventRecommendations);
  const draft = useProcedure(procedures.draftCloudFollowup);
  const setPresence = useReducer(reducers.setCloudPresence);
  const leave = useReducer(reducers.leaveCloudEvent);
  const request = useReducer(reducers.requestCloudConnection);
  const respond = useReducer(reducers.respondCloudConnection);
  const [interactions] = useTable(tables.myAgentInteractions);
  const [plans] = useTable(tables.myAgentFollowUpPlans);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [hasProfile, setHasProfile] = useState(false);
  const [zone, setZone] = useState<string>(ZONES[0].id);
  const [status, setStatus] = useState('free');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [events, setEvents] = useState<Activity[] | null>(null);
  const heartbeatEpoch = useRef(0);
  const heartbeatPending = useRef<Promise<void> | null>(null);
  const heartbeatTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void load().then(value => {
      const account = JSON.parse(value);
      if (!cancelled) { setUserId(account.user_id); setHasProfile(Boolean(account.profile)); }
    }).catch(err => { if (!cancelled) setError(String(err.message ?? err)); });
    return () => { cancelled = true; };
  }, [open, load]);

  useEffect(() => {
    if (!checked) return;
    const epoch = heartbeatEpoch.current;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || heartbeatEpoch.current !== epoch || heartbeatPending.current) return;
      heartbeatPending.current = setPresence({ zoneId: zone, availabilityStatus: status, discoverable: true })
        .then(() => findPeople()).then(value => { if (heartbeatEpoch.current === epoch) setMatches(JSON.parse(value)); })
        .catch(err => { if (heartbeatEpoch.current === epoch) { setChecked(false); setError(String(err.message ?? err)); } })
        .finally(() => { heartbeatPending.current = null; });
    }, 30000);
    heartbeatTimer.current = timer;
    return () => window.clearInterval(timer);
  }, [checked, zone, status, setPresence, findPeople]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const checkIn = () => act(async () => {
    await setPresence({ zoneId: zone, availabilityStatus: status, discoverable: true });
    setChecked(true); setMatches(JSON.parse(await findPeople()));
  });
  const checkOut = () => act(async () => {
    heartbeatEpoch.current++;
    window.clearInterval(heartbeatTimer.current);
    setChecked(false);
    await heartbeatPending.current;
    try { await leave(); setMatches([]); }
    catch (err) { setChecked(true); throw err; }
  });

  return <section className="cloud-networking" aria-label="Event networking">
    <button className="network-toggle" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Meet people at the event <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div className="network-body">
      <h2>Your next connection</h2>
      <p>Check in to let participants find you. Your full profile stays private. Keep this page open while you are available; inactive check-ins expire after five minutes.</p>
      {!hasProfile && <p>Save your introduction above, then close and reopen this panel to start matching.</p>}
      <div className="network-controls">
        <label>Area<select aria-label="Networking area" value={zone} disabled={busy || checked} onChange={e => setZone(e.target.value)}>{ZONES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Availability<select aria-label="Networking availability" value={status} disabled={busy || checked} onChange={e => setStatus(e.target.value)}><option value="free">Free to talk</option><option value="busy">Busy</option><option value="in_session">In a session</option></select></label>
        <button className="intake-submit" disabled={busy || !hasProfile} type="button" onClick={checked ? checkOut : checkIn}>{checked ? 'Check out' : 'Check in and find people'}</button>
        {checked && <button type="button" disabled={busy} onClick={() => act(async () => { setMatches(JSON.parse(await findPeople())); })}>Refresh people</button>}
      </div>
      {error && <p className="intake-error" role="alert">{error}</p>}
      {busy && <p role="status">Updating your connections…</p>}
      {checked && <div className="network-cards">{matches.length ? matches.map(match => <article key={match.target_id}>
        <h3>{match.target_name}</h3><small>{match.role} · {ZONES.find(item => item.id === match.location.zone)?.label ?? match.location.zone} · ROI {match.roi_score}</small>
        <p>{match.reason_for_connection}</p><button disabled={busy} type="button" onClick={() => act(async () => { await request({ targetId: match.target_id }); })}>Request connection with {match.target_name}</button>
      </article>) : <p>No current matches. Ask another participant to check in, or try another area.</p>}</div>}
      <div className="network-activities"><h3>Activities for you</h3><button disabled={busy || !hasProfile} type="button" onClick={() => act(async () => { setEvents(JSON.parse(await findEvents({ topN: 5 }))); })}>Find activities</button>
        {events && (events.length ? events.map(item => <article key={item.event.event_id}><h4>{item.event.title}</h4><small>{new Date(item.event.start).toLocaleString()} · ROI {item.roi_score}</small><p>{item.reason}</p></article>) : <p>No upcoming activities have been published yet.</p>)}
      </div>
      {userId && interactions.length > 0 && <div className="network-cards"><h3>Your connections</h3>{interactions.map(row => {
        const data = JSON.parse(row.payloadJson);
        const incoming = row.targetId === userId;
        const name = (incoming ? data.user_name : data.target_name) || 'Participant';
        return <article key={row.interactionId}><h4>{name}</h4><p>{row.status} · {row.reason}</p>
          {incoming && row.status === 'requested' && <div className="network-actions"><button disabled={busy} aria-label={`Accept ${name}`} type="button" onClick={() => act(async () => { await respond({ interactionId: row.interactionId, accept: true }); })}>Accept</button><button disabled={busy} aria-label={`Decline ${name}`} type="button" onClick={() => act(async () => { await respond({ interactionId: row.interactionId, accept: false }); })}>Decline</button></div>}
          {['accepted', 'recorded'].includes(row.status) && <button disabled={busy} type="button" onClick={() => act(async () => { await draft({ interactionId: row.interactionId }); })}>Prepare my follow-up draft</button>}
        </article>;
      })}</div>}
      {plans.length > 0 && <div className="network-drafts"><h3>Your follow-up drafts</h3><p>Draft only. Copy it and send it yourself.</p>{plans.map(plan => <article key={plan.planId}><small>{JSON.parse(plan.channelsJson).join(', ')} · {plan.suggestedTiming}</small><textarea aria-label="Your follow-up draft" readOnly value={plan.yourDraft} /><p>{plan.rationale}</p></article>)}</div>}
    </div>}
  </section>;
}

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { procedures, reducers, tables } from './module_bindings';
import EventGpsMap from './EventGpsMap';
import { ZONES } from './types';

type Stage = 'pre' | 'during' | 'post';
type Match = { target_id: string; target_name: string; role: string; headline: string; location: { zone: string }; availability: string; fit_score: number; roi_score: number; reason_for_connection: string; starred: boolean; distance_meters: number | null };
type Account = { user_id: string; is_admin: boolean; profile_ready: boolean };
const stageNames = { pre: 'Pre', during: 'During', post: 'Post' };
const starters = {
  pre: ['Who should I prioritize and why?', 'Help me prepare a short introduction.'],
  during: ['Who on my interest list is nearby?', 'Show my connection requests.'],
  post: ['Which connections should I follow up with?', 'Help me write a thoughtful follow-up.'],
};
const initialStage = () => { const stage = new URLSearchParams(window.location.search).get('stage'); return stage === 'during' || stage === 'post' ? stage : 'pre'; };
const zoneLabel = (zone: string) => ZONES.find(row => row.id === zone)?.label ?? zone;

export default function NetworkingWorkspace({ signedIn, accountName, onSignIn, accountControl }: {
  signedIn: boolean; accountName: string; onSignIn: () => void; accountControl: ReactNode;
}) {
  const [events, eventsLoaded] = useTable(tables.networkingInvitations);
  const [members] = useTable(tables.myNetworkingMemberships);
  const [profiles, profilesLoaded] = useTable(tables.myProfile);
  const [messages] = useTable(tables.myAssistantMessages);
  const [notifications] = useTable(tables.myAssistantNotifications);
  const [starRows] = useTable(tables.myEventStars);
  const [pins] = useTable(tables.myEventMapPins);
  const [interactions] = useTable(tables.myAgentInteractions);
  const [plans] = useTable(tables.myAgentFollowUpPlans);
  const { isActive } = useSpacetimeDB();
  const status = useProcedure(procedures.networkingAccountStatus);
  const list = useProcedure(procedures.getEventInterestList);
  const create = useProcedure(procedures.createNetworkingEvent);
  const prepare = useProcedure(procedures.prepareNetworkingEvent);
  const send = useProcedure(procedures.sendAssistantMessage);
  const join = useReducer(reducers.joinNetworkingEvent);
  const leave = useReducer(reducers.leaveNetworkingEvent);
  const start = useReducer(reducers.startNetworkingEvent);
  const setStar = useReducer(reducers.setEventStar);
  const availability = useReducer(reducers.setEventAvailability);
  const markRead = useReducer(reducers.markAssistantNotificationRead);
  const saveProfile = useReducer(reducers.saveMyProfile);
  const [account, setAccount] = useState<Account | null>(null);
  const [eventId, setEventId] = useState(new URLSearchParams(window.location.search).get('event') ?? '');
  const [stage, setStage] = useState<Stage>(initialStage);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  const [ready, setReady] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [zone, setZone] = useState('main-hall');
  const [availabilityStatus, setAvailabilityStatus] = useState('free');
  const [discoverable, setDiscoverable] = useState(true);
  const [focusedId, setFocusedId] = useState('');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(false);
  const [, setTick] = useState(0);
  const [localReplies, setLocalReplies] = useState<Array<{ key: string; eventId: string; stage: Stage; content: string }>>([]);
  const pendingChat = useRef<{ eventId: string; stage: Stage; message: string; requestId: string } | null>(null);
  const refreshEpoch = useRef(0);
  const heartbeatPending = useRef<Promise<void> | null>(null);
  const heartbeatEpoch = useRef(0);
  const seenNotifications = useRef(new Set<string>());
  const listCount = useRef(pageSize);
  const event = events.find(row => row.eventId === eventId);
  const member = members.find(row => row.eventId === eventId && row.userId === account?.user_id);
  const checkedIn = Boolean(member?.discoverable && member.availabilityStatus && member.availabilityStatus !== 'offline');
  const currentNotifications = notifications.filter(row => row.eventId === eventId).sort((a,b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  const unread = currentNotifications.filter(row => !row.read).length;
  const eventInteractions = interactions.filter(row => { try { return JSON.parse(row.payloadJson).event_id === eventId; } catch { return false; } });
  const eventInteractionIds = new Set(eventInteractions.map(row => row.interactionId));
  const eventPlans = plans.filter(row => eventInteractionIds.has(row.interactionId));
  const stars = new Set(starRows.filter(row => row.eventId === eventId).map(row => row.targetId));
  const conversation = messages.filter(row => row.eventId === eventId && row.stage === stage)
    .sort((a,b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch) || (a.messageId.split('__').slice(0,-1).join('__') === b.messageId.split('__').slice(0,-1).join('__') ? (a.role === 'user' ? -1 : 1) : a.messageId.localeCompare(b.messageId)));

  useEffect(() => {
    if (!signedIn || !isActive || !profilesLoaded) { setAccount(null); return; }
    let cancelled = false;
    void (async () => {
      if (!profiles.length) await saveProfile({ displayName: accountName.trim().slice(0,60) || 'Your account', headline: '', interests: '', showOnMap: false });
      const value = JSON.parse(await status());
      if (!cancelled) setAccount(value);
    })().catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [signedIn, isActive, profilesLoaded, profiles.length, accountName, saveProfile, status]);
  useEffect(() => {
    if (!eventId && events.length) setEventId(members[0]?.eventId || events[0].eventId);
  }, [eventId, events, members]);
  const refresh = useCallback(async (count: number) => {
    if (!eventId || !account || !member) return;
    const epoch = refreshEpoch.current;
    const pages: Match[] = []; let result: { total: number; ready: boolean; items: Match[] } | undefined;
    for (let offset = 0; offset < count; offset += 50) {
      result = JSON.parse(await list({ eventId, offset, limit: Math.min(50, count - offset) }));
      pages.push(...result!.items);
      if (offset + 50 >= result!.total) break;
    }
    if (epoch === refreshEpoch.current && result) { setMatches(pages); setTotal(result.total); setReady(result.ready); listCount.current = count; }
  }, [eventId, account?.user_id, Boolean(member), list]);
  useEffect(() => {
    refreshEpoch.current++; setMatches([]); setTotal(0); setReady(false); listCount.current = pageSize;
    void refresh(pageSize).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [refresh, event?.matchingStatus, pageSize]);
  useEffect(() => {
    setZone(member?.zoneId || 'main-hall'); setAvailabilityStatus(member?.availabilityStatus && member.availabilityStatus !== 'offline' ? member.availabilityStatus : 'free');
    setDiscoverable(member?.discoverable ?? true);
  }, [member?.memberId]);
  useEffect(() => {
    if (!checkedIn || !isActive) return;
    const epoch = heartbeatEpoch.current;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || heartbeatPending.current || heartbeatEpoch.current !== epoch) return;
      heartbeatPending.current = availability({ eventId, zoneId: member!.zoneId, availabilityStatus: member!.availabilityStatus, discoverable: member!.discoverable })
        .then(() => refresh(listCount.current)).catch(err => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => { heartbeatPending.current = null; });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [checkedIn, isActive, eventId, member?.zoneId, member?.availabilityStatus, member?.discoverable, availability, refresh]);
  useEffect(() => { const timer = window.setInterval(() => setTick(value => value + 1), 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    for (const row of notifications) {
      const key = `${row.notificationId}:${row.createdAt.microsSinceUnixEpoch}`;
      if (seenNotifications.current.has(key)) continue;
      seenNotifications.current.add(key);
      if (browserNotifications && !row.read && Date.now() - Number(row.createdAt.microsSinceUnixEpoch / 1000n) < 30000 && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(row.title, { body: row.body, tag: row.notificationId });
    }
  }, [notifications, browserNotifications]);
  const act = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const selectEvent = (id: string) => {
    refreshEpoch.current++; heartbeatEpoch.current++;
    setEventId(id); setChatDraft(''); setLocalReplies([]); pendingChat.current = null; setError(''); setNotice('');
    const params = new URLSearchParams({ event: id, stage }); window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  };
  const changeStage = (value: Stage) => { setStage(value); setChatDraft(''); pendingChat.current = null; };
  const submitChat = async (message: string, selectedStage = stage) => {
    if (chatBusy) return;
    setChatBusy(true); setError('');
    const previous = pendingChat.current;
    const args = previous?.eventId === eventId && previous.stage === selectedStage && previous.message === message
      ? previous : { eventId, stage: selectedStage, message, requestId: crypto.randomUUID() };
    pendingChat.current = args;
    try {
      const result = JSON.parse(await send(args));
      setLocalReplies(value => [...value, { key: args.requestId, eventId, stage: selectedStage, content: result.reply }]);
      pendingChat.current = null; setChatDraft('');
      await refresh(listCount.current);
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setChatBusy(false); }
  };
  const request = (targetId: string, name: string) => { changeStage('during'); void submitChat(`Send a connection request to ${name}, participant ID ${targetId}.`, 'during'); };
  const respond = (interactionId: string, accept: boolean) => { changeStage('during'); void submitChat(`${accept ? 'Accept' : 'Decline'} my incoming connection request with interaction ID ${interactionId}.`, 'during'); };
  const prepareAll = async (id: string) => {
    let result;
    do { result = JSON.parse(await prepare({ eventId: id })); setNotice(`Preparing personal lists: ${result.prepared_count} / ${result.member_count}`); } while (result.matching_status !== 'ready');
    setNotice('All personal interest lists are ready.'); await refresh(pageSize);
  };

  return <div className="networking-workspace">
    <header className="chat-topbar"><a className="brand" href="/" aria-label="MHacks live map"><span className="brand-mark">mh<span>+</span></span><span><b>MHACKS</b><small>MEET YOUR PEOPLE</small></span></a>
      <nav className="chat-nav" aria-label="Main navigation"><a className="nav-link" href="/chat">My profile</a><a className="nav-link" href="/">Live map</a>{accountControl}</nav></header>
    <main className="workspace-main">
      <div className="workspace-intro"><div><span className="eyebrow">YOUR EVENT / YOUR ASSISTANTS</span><h1>Make every connection <em>count.</em></h1><p>Join an event. Find people with shared interests. Let your personal assistants help before, during and after.</p></div>
        {account && <button className="workspace-button inbox-toggle" onClick={() => setInboxOpen(value => !value)} aria-expanded={inboxOpen}>Notifications <b>{unread}</b></button>}</div>
      {error && <p className="intake-error workspace-alert" role="alert">{error}</p>}{notice && <p className="workspace-alert success" role="status">{notice}</p>}
      {!isActive && <p className="workspace-alert" role="status">Connecting to the event service…</p>}
      {inboxOpen && <section className="workspace-inbox" aria-label="Your notifications"><div className="section-heading"><h2>Your notifications</h2><button className="workspace-button" onClick={() => void act(async () => {
        if (typeof Notification === 'undefined') throw new Error('This browser does not support notifications. Your website inbox still works.');
        const permission = await Notification.requestPermission(); setBrowserNotifications(permission === 'granted');
        if (permission !== 'granted') setNotice('Browser notifications were not enabled. Your website inbox still works.');
      })}>{browserNotifications ? 'Browser notifications enabled' : 'Enable browser notifications'}</button></div>
        <p className="workspace-muted">Your private inbox updates live. Browser alerts work while this page is open.</p>
        {currentNotifications.length ? currentNotifications.map(row => <article className={`notification-card${row.read ? '' : ' unread'}`} key={row.notificationId}><div><small>{stageNames[row.stage as Stage] || row.stage} agent · {new Date(Number(row.createdAt.microsSinceUnixEpoch / 1000n)).toLocaleTimeString()}</small><h3>{row.title}</h3><p>{row.body}</p></div><div className="workspace-actions">
          {row.kind === 'nearby' && <button disabled={chatBusy || !checkedIn} onClick={() => request(row.targetId, 'this nearby participant')}>Request connection</button>}
          {row.kind === 'connection_request' && eventInteractions.some(i => i.interactionId === row.interactionId && i.status === 'requested') && <><button disabled={chatBusy} onClick={() => respond(row.interactionId, true)}>Accept</button><button disabled={chatBusy} onClick={() => respond(row.interactionId, false)}>Decline</button></>}
          {!row.read && <button disabled={busy} onClick={() => void act(async () => { await markRead({ notificationId: row.notificationId }); })}>Mark read</button>}
        </div></article>) : <p>No notifications for this event yet.</p>}</section>}
      <section className="event-invitations" aria-label="Event invitations"><div className="section-heading"><h2>Event invitations</h2><span className="workspace-muted">{events.length} published</span></div>
        {!eventsLoaded ? <p>Loading invitations…</p> : !events.length ? <div className="workspace-empty"><h3>The next event starts here.</h3><p>{account?.is_admin ? 'Publish your first invitation below. People can join until you press Start.' : 'An invitation will appear here when the organizer publishes an event.'}</p></div> : <div className="invitation-grid">{events.map(row => <article key={row.eventId} className={`invitation-card${row.eventId === eventId ? ' selected' : ''}`}>
          <small>{row.status === 'open' ? 'OPEN INVITATION' : 'ROSTER LOCKED'} · {new Date(Number(row.startAtMs)).toLocaleString()}</small><h3>{row.title}</h3><p>{row.description}</p><div className="invitation-meta"><span>{row.venue}</span><span>{row.memberCount} joined</span></div><button className="workspace-button" onClick={() => selectEvent(row.eventId)} disabled={chatBusy}>Open event →</button>
        </article>)}</div>}
      </section>
      {account?.is_admin && <CreateEvent busy={busy} onCreate={values => act(async () => { const result = JSON.parse(await create(values)); selectEvent(result.event_id); setNotice('Invitation published. Share the event link to invite participants.'); })} />}
      {event && <section className="selected-event" aria-label="Selected event"><div className="section-heading"><div><span className="eyebrow">{event.status === 'open' ? 'JOINING IS OPEN' : 'PARTICIPANT LIST IS FROZEN'}</span><h2>{event.title}</h2><p>{event.venue} · {event.memberCount} participants</p></div><div className="workspace-actions">
        <button className="workspace-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(`${window.location.origin}/events?event=${eventId}`); setNotice('Invitation link copied.'); })}>Copy invitation link</button>
        {!signedIn ? <button className="intake-submit" onClick={onSignIn}>Sign in to join</button> : !member ? <button className="intake-submit" disabled={busy || !account || !account.profile_ready || event.status !== 'open'} onClick={() => void act(async () => { await join({ eventId }); setNotice('You joined this event. Your name and headline will be discoverable to its members.'); })}>{event.status !== 'open' ? 'Joining closed' : 'Join event'}</button>
          : event.status === 'open' ? <button className="workspace-button" disabled={busy} onClick={() => void act(async () => { await leave({ eventId }); setNotice('You left the invitation list.'); })}>Leave event</button> : <span className="joined-label">✓ You are on the frozen roster</span>}
        {account?.is_admin && <button className="intake-submit" disabled={busy || event.matchingStatus === 'ready'} onClick={() => void act(async () => { await start({ eventId }); await prepareAll(eventId); })}>{event.status === 'open' ? 'Start event and lock roster' : event.matchingStatus === 'ready' ? 'All matches ready' : 'Resume preparing matches'}</button>}
      </div></div>
        {signedIn && account && !account.profile_ready && <p className="workspace-alert">Save your resume or introduction and complete indexing on <a href="/chat">My profile</a> before joining.</p>}
        {event.status === 'open' && <p className="workspace-muted">Joining shares your name and headline with event members for recommendations. Your resume stays private. The organizer locks the participant list by pressing Start; Pre then compares everyone on that list.</p>}
        {event.status === 'started' && event.matchingStatus !== 'ready' && <p role="status">Pre is preparing the frozen roster: {event.preparedCount} / {event.memberCount} personal lists ready.{account?.is_admin ? ' Use Resume if preparation was interrupted.' : ''}</p>}
        {member && <><div className="agent-tabs" role="tablist" aria-label="Your event assistants">{(['pre','during','post'] as Stage[]).map(value => <button role="tab" aria-selected={stage === value} key={value} disabled={chatBusy} onClick={() => changeStage(value)}><span>0{value === 'pre' ? 1 : value === 'during' ? 2 : 3}</span>{stageNames[value]} agent<small>{value === 'pre' ? 'Prepare & prioritize' : value === 'during' ? 'Find & connect' : 'Follow up'}</small></button>)}</div>
          <div className="agent-workspace"><div className="agent-primary">
            {stage !== 'post' && <section className="interest-section" aria-label="Your interest list"><div className="section-heading"><div><span className="eyebrow">PRE MATCHES / PERSONAL INTEREST LIST</span><h3>People for you</h3></div><label className="page-size">Show<select aria-label="People per page" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option value={5}>5</option><option value={10}>10</option></select></label></div>
              <p className="workspace-muted">Fit combines Pinecone profile similarity with goals and complementary skills. Star someone to keep them in your During alerts.</p>
              {!ready ? <p className="workspace-empty">Your personal list will appear after the event starts and Pre finishes preparing it.</p> : !matches.length ? <p className="workspace-empty">No other discoverable members yet. Matching needs at least two people.</p> : <div className="interest-cards">{matches.map((person,i) => <article className="interest-card" key={person.target_id}><span className="person-rank">{String(i + 1).padStart(2,'0')}</span><div className="person-info"><h4>{person.target_name}</h4><small>{person.role} · {zoneLabel(person.location.zone)}{person.distance_meters != null ? ` · ${person.distance_meters} m away` : ''}</small><p>{person.reason_for_connection}</p><div className="workspace-actions">
                {stage === 'during' && <><button disabled={chatBusy || !checkedIn || person.availability === 'offline'} onClick={() => request(person.target_id, person.target_name)}>Request connection</button><button disabled={!pins.some(pin => pin.userId === person.target_id && pin.eventId === eventId && Date.now() - Number(pin.updatedAt.microsSinceUnixEpoch / 1000n) <= 120000)} onClick={() => setFocusedId(person.target_id)}>Find on map</button></>}
              </div></div><div className="person-score"><b>{person.fit_score}</b><small>FIT / 100</small><button className="star-button" aria-label={`${stars.has(person.target_id) || person.starred ? 'Unstar' : 'Star'} ${person.target_name}`} aria-pressed={stars.has(person.target_id) || person.starred} disabled={busy} onClick={() => void act(async () => { await setStar({ eventId, targetId: person.target_id, starred: !(stars.has(person.target_id) || person.starred) }); await refresh(listCount.current); })}>{stars.has(person.target_id) || person.starred ? '★' : '☆'}</button></div></article>)}</div>}
              {matches.length < total && <button className="workspace-button load-more" disabled={busy} onClick={() => void act(async () => { const next = JSON.parse(await list({ eventId, offset: matches.length, limit: pageSize })); setMatches(value => [...value, ...next.items]); setTotal(next.total); listCount.current += pageSize; })}>Load more people</button>}
              {ready && <p className="workspace-muted">Showing {matches.length} of {total} people. Nearby alerts monitor your top ten and all favorites.</p>}
            </section>}
            {stage === 'during' && <><section className="event-checkin"><h3>Your event presence</h3><div className="network-controls"><label>Area<select aria-label="Event area" value={zone} disabled={busy} onChange={e => setZone(e.target.value)}>{ZONES.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label>Availability<select aria-label="Event availability" value={availabilityStatus} disabled={busy} onChange={e => setAvailabilityStatus(e.target.value)}><option value="free">Free to talk</option><option value="busy">Busy</option><option value="in_session">In a session</option></select></label><label className="event-visible"><input type="checkbox" checked={discoverable} onChange={e => setDiscoverable(e.target.checked)} />Discoverable to event members</label></div><div className="workspace-actions">
              <button className="intake-submit" disabled={busy || event.status !== 'started'} onClick={() => void act(async () => { await availability({ eventId, zoneId: zone, availabilityStatus, discoverable }); setNotice(discoverable ? 'Your event presence is updated.' : 'You are hidden from event discovery.'); await refresh(listCount.current); })}>{checkedIn ? 'Update presence' : 'Check in'}</button>
              {checkedIn && <button className="workspace-button" disabled={busy} onClick={() => void act(async () => { heartbeatEpoch.current++; await heartbeatPending.current; await availability({ eventId, zoneId: zone, availabilityStatus: 'offline', discoverable: false }); setNotice('Checked out. Event GPS and discovery are stopped.'); })}>Check out</button>}
            </div></section><EventGpsMap key={eventId} eventId={eventId} userId={account!.user_id} pins={pins} checkedIn={checkedIn} focusedId={focusedId} stars={stars} onError={setError} /></>}
            {stage !== 'pre' && <section className="event-connections"><h3>{stage === 'post' ? 'Connections to follow up' : 'Your connections'}</h3>{eventInteractions.length ? eventInteractions.map(row => {
              const data = JSON.parse(row.payloadJson), incoming = row.targetId === account?.user_id, name = incoming ? data.user_name : data.target_name;
              return <article className="connection-card" key={row.interactionId}><div><h4>{name || 'Participant'}</h4><p>{row.status === 'requested' ? incoming ? 'Incoming request' : 'Request sent' : row.status === 'accepted' ? 'Connected' : row.status === 'declined' ? 'Request declined' : row.status}</p></div><div className="workspace-actions">
                {incoming && row.status === 'requested' && <><button disabled={chatBusy} onClick={() => respond(row.interactionId, true)}>Accept</button><button disabled={chatBusy} onClick={() => respond(row.interactionId, false)}>Decline</button></>}
                {['accepted','recorded'].includes(row.status) && <button disabled={chatBusy || busy} onClick={() => { changeStage('post'); void submitChat(`Prepare my follow-up draft for accepted connection ${row.interactionId}.`, 'post'); }}>Prepare follow-up</button>}
              </div></article>;
            }) : <p className="workspace-empty">Your accepted connections and requests will appear here.</p>}
              {stage === 'post' && eventPlans.map(plan => <article className="followup-card" key={plan.planId}><span className="eyebrow">YOUR PRIVATE DRAFT · UNSENT</span><small>{JSON.parse(plan.channelsJson).join(', ')} · {plan.suggestedTiming}</small><textarea aria-label="Your follow-up draft" readOnly value={plan.yourDraft} /><p>{plan.rationale}</p><button className="workspace-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(plan.yourDraft); setNotice('Follow-up copied. You can review and send it yourself.'); })}>Copy draft</button></article>)}
              {stage === 'post' && <p className="workspace-muted">Drafts stay private to you. Review them and send through your chosen channel.</p>}
            </section>}
          </div><aside className="assistant-panel" aria-label={`${stageNames[stage]} agent chat`}><div className="assistant-heading"><span className="intake-avatar">AI</span><div><h2>{stageNames[stage]} agent</h2><small>Your personal event assistant</small></div><i className={isActive ? 'agent-online' : ''} /></div>
            <div className="assistant-thread" role="log" aria-label={`${stageNames[stage]} conversation`} aria-live="polite"><div className="assistant-bubble"><small>{stageNames[stage].toUpperCase()} AGENT</small><p>{stage === 'pre' ? 'I can help you prepare, prioritize your matches, and save favorites. Tell me what you hope to get out of this event.' : stage === 'during' ? 'I can help you find people, explain nearby alerts, send a connection request, and accept or decline your incoming requests.' : 'I can help you follow up on your accepted connections, prepare a private draft, and refine its wording.'}</p></div>
              {conversation.map(row => <div className={row.role === 'user' ? 'assistant-bubble user' : 'assistant-bubble'} key={row.messageId}><small>{row.role === 'user' ? 'YOU' : `${stageNames[stage].toUpperCase()} AGENT`}</small><p>{row.content}</p></div>)}
              {localReplies.filter(row => row.eventId === eventId && row.stage === stage && !conversation.some(saved => saved.role === 'assistant' && saved.content === row.content)).map(row => <div className="assistant-bubble" key={row.key}><small>{stageNames[stage].toUpperCase()} AGENT</small><p>{row.content}</p></div>)}
              {chatBusy && <p className="workspace-muted" role="status">Your agent is working…</p>}
            </div><div className="starter-prompts">{starters[stage].map(text => <button disabled={chatBusy} key={text} onClick={() => setChatDraft(text)}>{text}</button>)}</div><form className="assistant-composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submitChat(chatDraft.trim()); }}>
              <label className="sr-only" htmlFor="assistant-message">Message your {stageNames[stage]} agent</label><textarea id="assistant-message" maxLength={4000} placeholder={`Ask your ${stageNames[stage]} agent…`} value={chatDraft} disabled={chatBusy || !isActive} onChange={e => setChatDraft(e.target.value)} />
              <button className="intake-submit" disabled={chatBusy || !isActive || !chatDraft.trim()} type="submit">Send message</button><small>{chatDraft.length} / 4,000</small>
            </form><p className="assistant-footnote">Your conversations and notifications are saved to your account.</p>
          </aside></div>
        </>}
      </section>}
    </main><footer className="chat-footer">MHACKS / MEET YOUR PEOPLE <span>Before, during, and after. All in one place.</span></footer>
  </div>;
}

function CreateEvent({ busy, onCreate }: { busy: boolean; onCreate: (values: { title: string; description: string; venue: string; startAtMs: bigint }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [venue, setVenue] = useState(''), [date, setDate] = useState('');
  return <section className="admin-event" aria-label="Administrator event tools"><button className="workspace-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close event form' : '+ Create an event'} <small>ADMIN</small></button>{open && <form onSubmit={e => {
    e.preventDefault(); const time = new Date(date).getTime(); if (Number.isFinite(time)) void onCreate({ title, description, venue, startAtMs: BigInt(time) });
  }}><h2>Publish an invitation</h2><p>People join from the invitation link. You decide when to start and lock the roster.</p><label>Event title<input aria-label="Event title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required /></label><label>Venue<input aria-label="Event venue" value={venue} onChange={e => setVenue(e.target.value)} maxLength={200} required /></label><label>Scheduled time<input aria-label="Event time" type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Invitation message<textarea aria-label="Invitation message" value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} /></label><button className="intake-submit" disabled={busy} type="submit">Publish invitation</button></form>}</section>;
}

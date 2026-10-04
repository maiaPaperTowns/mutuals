import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Brand from './Brand';
import EventBadge from './EventBadge';
import AsiAccountLink from './AsiAccountLink';
import { useProcedure, useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { procedures, reducers, tables } from './module_bindings';
import EventGpsMap from './EventGpsMap';
import EventAreaMap, { readEventArea } from './EventAreaMap';
import EventRecap from './EventRecap';
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

export default function NetworkingWorkspace({ signedIn, accountName, onSignIn, accountControl, navigationUrl }: {
  signedIn: boolean; accountName: string; onSignIn: () => void; accountControl: ReactNode; navigationUrl?: string;
}) {
  const assistantsOnly = window.location.pathname.replace(/\/$/, '') === '/assistant';
  const [events, eventsLoaded] = useTable(tables.networkingInvitations);
  const createAsiCode = useProcedure(procedures.createAsiLinkCode);
  const asiStatus = useProcedure(procedures.getAsiLinkStatus);
  const revokeAsi = useReducer(reducers.revokeAsiChatGrant);
  const createCode = useCallback(() => createAsiCode(), [createAsiCode]);
  const getAsiStatus = useCallback(() => asiStatus(), [asiStatus]);
  const revokeAsiAccess = useCallback(() => revokeAsi(), [revokeAsi]);
  const [eventAreas] = useTable(tables.networkingEventAreas);
  const [members] = useTable(tables.myNetworkingMemberships);
  const [profiles, profilesLoaded] = useTable(tables.myProfile);
  const [messages] = useTable(tables.myAssistantMessages);
  const [notifications] = useTable(tables.myAssistantNotifications);
  const [starRows] = useTable(tables.myEventStars);
  const [pins] = useTable(tables.myEventMapPins);
  const [interactions] = useTable(tables.myAgentInteractions);
  const [plans] = useTable(tables.myAgentFollowUpPlans);
  const [exchanges] = useTable(tables.myAgentExchanges);
  const [contacts] = useTable(tables.myEventContacts);
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
  const setPhase = useReducer(reducers.setNetworkingEventPhase);
  const editEvent = useReducer(reducers.editNetworkingEvent);
  const setEventArea = useReducer(reducers.setNetworkingEventArea);
  const deleteEvent = useProcedure(procedures.deleteNetworkingEvent);
  const requestConnection = useReducer(reducers.requestEventConnection);
  const respondConnection = useReducer(reducers.respondEventConnection);
  const finishConnection = useReducer(reducers.finishEventConnection);
  const markRead = useReducer(reducers.markAssistantNotificationRead);
  const saveProfile = useReducer(reducers.saveMyProfile);
  const setContact = useReducer(reducers.setEventContact);
  const [account, setAccount] = useState<Account | null>(null);
  const [eventId, setEventId] = useState(new URLSearchParams(window.location.search).get('event') ?? '');
  const [stage, setStage] = useState<Stage>(initialStage);
  const [busy, setBusy] = useState(false);
  const [manualChatBusy, setChatBusy] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const chatBusy = manualChatBusy || recapBusy;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [total, setTotal] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [ready, setReady] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [focusedId, setFocusedId] = useState('');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(false);
  const [, setTick] = useState(0);
  const [localReplies, setLocalReplies] = useState<Array<{ key: string; userId: string; eventId: string; stage: Stage; content: string }>>([]);
  const pendingChat = useRef<{ eventId: string; stage: Stage; message: string; requestId: string } | null>(null);
  useEffect(() => {
    if (!navigationUrl || !['/events', '/assistant'].includes(window.location.pathname.replace(/\/$/, ''))) return;
    const params = new URLSearchParams(navigationUrl.split('?')[1]);
    const selected = params.get('event');
    if (selected) setEventId(selected);
    const selectedStage = params.get('stage');
    if (selectedStage === 'pre' || selectedStage === 'during' || selectedStage === 'post') setStage(selectedStage);
  }, [navigationUrl]);
  const refreshEpoch = useRef(0);
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set<string>());
  const seenNotifications = useRef(new Set<string>());
  const pageOffsetRef = useRef(0);
  const event = events.find(row => row.eventId === eventId);
  const areaPoints = readEventArea(eventAreas.find(row => row.eventId === eventId)?.areaJson);
  const eventPhase = (event?.phase || (event?.status === 'started' ? 'during' : 'pre')) as Stage;
  const member = members.find(row => row.eventId === eventId && row.userId === account?.user_id);
  const checkedIn = Boolean(member?.discoverable && member.availabilityStatus && member.availabilityStatus !== 'offline');
  const currentNotifications = notifications.filter(row => row.eventId === eventId).sort((a,b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch));
  const unread = currentNotifications.filter(row => !row.read).length;
  const eventInteractions = interactions.filter(row => { try { return JSON.parse(row.payloadJson).event_id === eventId; } catch { return false; } });
  const eventInteractionIds = new Set(eventInteractions.map(row => row.interactionId));
  const chatting = eventInteractions.some(row => ['accepted', 'recorded'].includes(row.status));
  const nearbyAlert = eventPhase === 'during' && !chatting ? currentNotifications.find(row => row.kind === 'nearby' && !row.read
    && Date.now() - Number(row.createdAt.microsSinceUnixEpoch / 1000n) < 120000
    && !dismissedAlerts.has(`${row.notificationId}:${row.createdAt.microsSinceUnixEpoch}`)) : undefined;
  const eventPlans = plans.filter(row => eventInteractionIds.has(row.interactionId));
  const eventExchanges = exchanges.filter(row => row.eventId === eventId);
  const eventContacts = contacts.filter(row => row.eventId === eventId);
  const ownContact = eventContacts.find(row => row.userId === account?.user_id);
  const stars = new Set(starRows.filter(row => row.eventId === eventId).map(row => row.targetId));
  const conversation = messages.filter(row => row.eventId === eventId && row.stage === stage && !(row.role === 'user' && row.messageId.startsWith(`${account?.user_id}__recap-${eventId}`)))
    .sort((a,b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch) || (a.messageId.split('__').slice(0,-1).join('__') === b.messageId.split('__').slice(0,-1).join('__') ? (a.role === 'user' ? -1 : 1) : a.messageId.localeCompare(b.messageId)));

  const pendingReplies = localReplies.filter(row => row.userId === account?.user_id && row.eventId === eventId && row.stage === stage && !conversation.some(saved => saved.messageId === `${account?.user_id}__${row.key}__assistant`));
  const threadMessages = [...conversation, ...pendingReplies.map(row => ({ messageId: row.key, role: 'assistant', content: row.content }))].slice(-50);
  useEffect(() => {
    setLocalReplies(value => {
      const pending = value.filter(row => row.userId === account?.user_id && !messages.some(saved => saved.messageId === `${row.userId}__${row.key}__assistant`));
      return pending.length === value.length ? value : pending;
    });
  }, [messages, account?.user_id, localReplies]);

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
    if (assistantsOnly && !eventId) setEventId(members[0]?.eventId || messages[0]?.eventId || '');
  }, [assistantsOnly, eventId, members, messages]);
  useEffect(() => {
    if (!event) return;
    if (!assistantsOnly) setStage(eventPhase);
    if (!assistantsOnly) { setChatDraft(''); pendingChat.current = null; }
    const path = window.location.pathname.replace(/\/$/, '');
    const selected = new URLSearchParams(window.location.search).get('event');
    if (['/events', '/assistant'].includes(path) && (!selected || selected === eventId)) window.history.replaceState({}, '', `${window.location.pathname}?${new URLSearchParams({ event: eventId, stage: assistantsOnly ? stage : eventPhase })}`);
  }, [eventId, eventPhase, assistantsOnly]);
  const refresh = useCallback(async (offset = pageOffsetRef.current) => {
    if (!eventId || !account || !member) return;
    const epoch = ++refreshEpoch.current;
    pageOffsetRef.current = offset;
    let result = JSON.parse(await list({ eventId, offset, limit: 5 }));
    if (epoch !== refreshEpoch.current) return;
    if (offset > 0 && offset >= result.total) {
      offset = 0; pageOffsetRef.current = 0;
      result = JSON.parse(await list({ eventId, offset, limit: 5 }));
    }
    if (epoch === refreshEpoch.current) {
      setMatches(result.items); setTotal(result.total); setReady(result.ready);
      pageOffsetRef.current = offset; setPageOffset(offset);
    }
  }, [eventId, account?.user_id, Boolean(member), list]);
  useEffect(() => {
    refreshEpoch.current++; setMatches([]); setTotal(0); setReady(false);
    pageOffsetRef.current = 0; setPageOffset(0);
    void refresh(0).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [refresh, event?.matchingStatus]);
  useEffect(() => {
    if (eventPhase !== 'during' || !member || !isActive) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh().catch(err => setError(String(err.message ?? err))); }, 15000);
    return () => window.clearInterval(timer);
  }, [eventPhase, Boolean(member), isActive, refresh]);
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
    refreshEpoch.current++;
    setEventId(id); setChatDraft(''); setLocalReplies([]); pendingChat.current = null; setError(''); setNotice('');
    const params = new URLSearchParams({ event: id, stage }); window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  };
  const changeStage = (value: Stage) => {
    setStage(value); setChatDraft(''); pendingChat.current = null;
    window.history.replaceState({}, '', `${window.location.pathname}?${new URLSearchParams({ event: eventId, stage: value })}`);
  };
  const submitChat = async (message: string, selectedStage = stage) => {
    if (chatBusy) return;
    setChatBusy(true); setError('');
    const previous = pendingChat.current;
    const args = previous?.eventId === eventId && previous.stage === selectedStage && previous.message === message
      ? previous : { eventId, stage: selectedStage, message, requestId: crypto.randomUUID() };
    pendingChat.current = args;
    try {
      const result = JSON.parse(await send(args));
      setLocalReplies(value => [...value, { key: args.requestId, userId: account!.user_id, eventId, stage: selectedStage, content: result.reply }]);
      pendingChat.current = null; setChatDraft('');
      await refresh();
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setChatBusy(false); }
  };
  const request = (targetId: string, _name: string) => void act(async () => { await requestConnection({ eventId, targetId }); setNotice('Connection request sent.'); await refresh(); });
  const respond = (interactionId: string, accept: boolean) => void act(async () => { await respondConnection({ eventId, interactionId, accept }); setNotice(accept ? 'Connected. You are both busy until the chat ends.' : 'Request declined.'); await refresh(); });
  const dismissAlert = () => { if (nearbyAlert) { setDismissedAlerts(value => new Set(value).add(`${nearbyAlert.notificationId}:${nearbyAlert.createdAt.microsSinceUnixEpoch}`)); void markRead({ notificationId: nearbyAlert.notificationId }).catch(() => {}); } };
  const prepareAll = async (id: string) => {
    let result;
    do { result = JSON.parse(await prepare({ eventId: id })); setNotice(`Preparing personal lists: ${result.prepared_count} / ${result.member_count}`); } while (result.matching_status !== 'ready');
    setNotice('All personal interest lists are ready.'); await refresh();
  };

  // The mutuals badge (FREE-WILi) mirrors During: AI nearby alerts, incoming requests, accepted connections.
  const named = (row: (typeof eventInteractions)[number]) => {
    const data = JSON.parse(row.payloadJson), incoming = row.targetId === account?.user_id;
    return { interactionId: row.interactionId, name: (incoming ? data.user_name : data.target_name) || 'Participant', incoming };
  };
  const badgeRequest = eventInteractions.filter(row => row.status === 'requested' && row.targetId === account?.user_id)
    .map(row => ({ ...named(row), reason: row.reason ?? '' }))[0];
  const badgeConnections = eventInteractions.filter(row => ['accepted', 'recorded', 'completed'].includes(row.status)).map(named);
  const badgeChatting = eventInteractions.filter(row => ['accepted', 'recorded'].includes(row.status)).map(named)[0];

  const peoplePanel = <section className="interest-section" aria-label="Your interest list"><div className="section-heading"><div><span className="eyebrow">PRE MATCHES / PERSONAL INTEREST LIST</span><h3>People</h3></div></div>
              <p className="workspace-muted">Fit combines Pinecone profile similarity with goals and complementary skills. Star someone to keep them in your During alerts.</p>
              {!ready ? <p className="workspace-empty">Your personal list will appear after the event starts and Pre finishes preparing it.</p> : !matches.length ? <p className="workspace-empty">No other discoverable members yet. Matching needs at least two people.</p> : <div className="interest-cards">{[...matches].sort((a,b) => b.fit_score - a.fit_score).map((person,i) => <article className="interest-card" key={person.target_id}><span className="person-rank">{String(pageOffset + i + 1).padStart(2,'0')}</span><div className="person-info"><h4>{person.target_name}</h4><small>{person.role} · {zoneLabel(person.location.zone)}{person.distance_meters != null ? ` · ${person.distance_meters} m away` : ''}</small><p>{person.reason_for_connection}</p><div className="workspace-actions">
                {eventPhase === 'during' && <><span>{person.availability === 'busy' ? 'Busy chatting' : person.availability === 'free' ? 'Free to talk' : 'Location unavailable'}</span><button disabled={busy || chatting || !checkedIn || person.availability !== 'free'} onClick={() => request(person.target_id, person.target_name)}>Request connection</button><button disabled={!pins.some(pin => pin.userId === person.target_id && pin.eventId === eventId && Date.now() - Number(pin.updatedAt.microsSinceUnixEpoch / 1000n) <= 120000)} onClick={() => setFocusedId(person.target_id)}>Find on map</button></>}
              </div></div><div className="person-score"><b>{person.fit_score}%</b><small>FIT</small><button className="star-button" aria-label={`${stars.has(person.target_id) || person.starred ? 'Unstar' : 'Star'} ${person.target_name}`} aria-pressed={stars.has(person.target_id) || person.starred} disabled={busy} onClick={() => void act(async () => { await setStar({ eventId, targetId: person.target_id, starred: !(stars.has(person.target_id) || person.starred) }); await refresh(); })}>{stars.has(person.target_id) || person.starred ? '★' : <img src="/redesign/favorite-star.svg" alt="" />}</button></div></article>)}</div>}
              {ready && total > 5 && <button className="workspace-button reserve-people" disabled={busy} title="Show the next five matches" onClick={() => void act(async () => { await refresh(pageOffset + 5 < total ? pageOffset + 5 : 0); })}>Reserve</button>}
              {ready && <p className="workspace-muted">Showing {matches.length ? pageOffset + 1 : 0}–{pageOffset + matches.length} of {total} people.</p>}

            </section>;
  const assistantPanel = <aside className="assistant-panel" aria-label={`${stageNames[stage]} agent chat`}><div className="assistant-heading"><span className="intake-avatar">AI</span><div><h2>{stageNames[stage]} agent</h2><small>Your personal event assistant</small></div><i className={isActive ? 'agent-online' : ''} /></div>
            <div className="assistant-thread" role="log" aria-label={`${stageNames[stage]} conversation`} aria-live="polite"><div className="assistant-bubble"><small>{stageNames[stage].toUpperCase()} AGENT</small><p>{stage === 'pre' ? 'I can help you prepare, prioritize your matches, and save favorites. Tell me what you hope to get out of this event.' : stage === 'during' ? 'I can help you find people, explain nearby alerts, send a connection request, and accept or decline your incoming requests.' : 'I can help you follow up on your accepted connections, prepare a private draft, and refine its wording.'}</p></div>
              {threadMessages.map(row => <div className={row.role === 'user' ? 'assistant-bubble user' : 'assistant-bubble'} key={row.messageId}><small>{row.role === 'user' ? 'YOU' : `${stageNames[stage].toUpperCase()} AGENT`}</small><p>{row.content}</p></div>)}
              {chatBusy && <p className="workspace-muted" role="status">Your agent is working…</p>}
            </div>
            {!!eventExchanges.length && <details className="agent-exchanges"><summary>Agent exchange · {eventExchanges.length}</summary>{eventExchanges.map(exchange => <article key={exchange.exchangeId}><b>{stageNames[exchange.fromAgent as Stage] || exchange.fromAgent} → {stageNames[exchange.toAgent as Stage] || exchange.toAgent}</b><p>{exchange.question}</p><p>{exchange.response}</p></article>)}</details>}
            <div className="starter-prompts">{starters[stage].map(text => <button disabled={chatBusy} key={text} onClick={() => setChatDraft(text)}>{text}</button>)}</div><form className="assistant-composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submitChat(chatDraft.trim()); }}>
              <label className="sr-only" htmlFor="assistant-message">Message your {stageNames[stage]} agent</label><textarea id="assistant-message" maxLength={4000} placeholder={`Ask your ${stageNames[stage]} agent…`} value={chatDraft} disabled={chatBusy || !isActive || !member} onChange={e => setChatDraft(e.target.value)} />
              <button className="intake-submit" disabled={chatBusy || !isActive || !member || !chatDraft.trim()} type="submit">Send message</button><small>{chatDraft.length} / 4,000</small>
            </form>{!member && <p className="workspace-muted">Join this event to send messages. Saved history remains here.</p>}<p className="assistant-footnote">Your conversations and notifications are saved to your account.</p>
          </aside>;

  return <div className={`networking-workspace ${assistantsOnly ? 'assistant-route' : 'event-route'}`}>
    <header className="chat-topbar"><div className="shared-brand"><Brand /><a className="nav-link" href="/">↗ Live map</a></div>
      <nav className="chat-nav" aria-label="Main navigation">{assistantsOnly && <a className="nav-link" href="/events">Events</a>}{accountControl}</nav></header>
    <main className="workspace-main">
      {assistantsOnly && <AsiAccountLink signedIn={signedIn} isActive={isActive} createCode={createCode} getStatus={getAsiStatus} revoke={revokeAsiAccess} />}
      {!assistantsOnly && <EventBadge active={eventPhase === 'during' && Boolean(member)} checkedIn={checkedIn}
        myName={profiles[0]?.displayName ?? accountName}
        nearby={nearbyAlert ? { title: nearbyAlert.title, body: nearbyAlert.body, targetId: nearbyAlert.targetId } : undefined}
        request={badgeRequest} chatting={badgeChatting} connections={badgeConnections}
        onRequest={targetId => request(targetId, '')} onRespond={respond} onDismiss={dismissAlert} />}
      <div className="workspace-intro"><div><span className="eyebrow">YOUR EVENT / YOUR ASSISTANTS</span><h1>{assistantsOnly ? 'Your agent chats' : 'Find your next event.'}</h1><p>{assistantsOnly ? 'All your event assistants and saved conversations, before, during and after.' : 'Join an event and meet people with shared interests.'}</p></div>
        {account && <button className="workspace-button inbox-toggle" onClick={() => setInboxOpen(value => !value)} aria-expanded={inboxOpen}>Notifications <b>{unread}</b></button>}</div>
      {error && <p className="intake-error workspace-alert" role="alert">{error}</p>}{notice && <p className="workspace-alert success" role="status">{notice}</p>}
      {member && eventPhase === 'during' && <details className="assistant-gps" open={!assistantsOnly}><summary>Event GPS · location controls</summary><EventGpsMap key={eventId} eventId={eventId} userId={account!.user_id} pins={pins} checkedIn={true} focusedId={focusedId} stars={stars} onError={setError} areaPoints={areaPoints} eventTitle={event!.title} onResetFocus={() => setFocusedId('')} /></details>}
      {nearbyAlert && <div className="nearby-popup" role="dialog" aria-label="Nearby connection" aria-live="polite"><span className="eyebrow">NEARBY & FREE TO TALK</span><h2>{nearbyAlert.title}</h2><p>{nearbyAlert.body}</p><div className="workspace-actions"><button className="intake-submit" aria-label="Connect with nearby person" disabled={busy || !checkedIn} onClick={() => { request(nearbyAlert.targetId, 'nearby person'); dismissAlert(); }}>Request connection</button><button className="workspace-button" onClick={dismissAlert}>Dismiss</button></div></div>}
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
      {!assistantsOnly && <details className="event-directory" open={!eventId}><summary>Events</summary><section className="event-invitations" aria-label="Event invitations"><div className="section-heading"><h2>Event invitations</h2><span className="workspace-muted">{events.length} published</span></div>
        {!eventsLoaded ? <p>Loading invitations…</p> : !events.length ? <div className="workspace-empty"><h3>The next event starts here.</h3><p>{account?.is_admin ? 'Publish your first invitation below. People can join until you press Start.' : 'An invitation will appear here when the organizer publishes an event.'}</p></div> : <div className="invitation-grid">{events.map(row => <article key={row.eventId} className={`invitation-card${row.eventId === eventId ? ' selected' : ''}`}>
          <small>{(row.phase || 'pre').toUpperCase()} · {row.status === 'open' ? 'OPEN INVITATION' : 'ROSTER LOCKED'} · {new Date(Number(row.startAtMs)).toLocaleString()}</small><h3>{row.title}</h3><p>{row.description}</p><div className="invitation-meta"><span>{row.venue}</span><span>{row.memberCount} joined</span></div><button className="workspace-button" onClick={() => selectEvent(row.eventId)} disabled={chatBusy}>Open event →</button>
        </article>)}</div>}
      </section>
      </details>}
      {!assistantsOnly && account?.is_admin && <CreateEvent busy={busy} onCreate={values => act(async () => { const result = JSON.parse(await create(values)); selectEvent(result.event_id); setNotice('Invitation published. Share the event link to invite participants.'); })} />}
      {!assistantsOnly && event && <section className="selected-event" aria-label="Selected event"><div className="event-detail-layout"><div className="event-information"><div className="section-heading"><div><span className="eyebrow">{event.status === 'open' ? 'JOINING IS OPEN' : 'PARTICIPANT LIST IS FROZEN'}</span><h2>{event.title}</h2><p>{event.venue} · {event.memberCount} participants</p></div><div className="workspace-actions">
        <button className="workspace-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(`${window.location.origin}/events?event=${eventId}`); setNotice('Invitation link copied.'); })}>Copy invitation link</button>
        {!signedIn ? <button className="intake-submit" onClick={onSignIn}>Sign in to join</button> : !member ? <button className="intake-submit" disabled={busy || !account || !account.profile_ready || event.status !== 'open'} onClick={() => void act(async () => { await join({ eventId }); setNotice('You joined this event. Your name and headline will be discoverable to its members.'); })}>{event.status !== 'open' ? 'Joining closed' : 'Join event'}</button>
          : event.status === 'open' ? <button className="workspace-button" disabled={busy} onClick={() => void act(async () => { await leave({ eventId }); setNotice('You left the invitation list.'); })}>Leave event</button> : <span className="joined-label">✓ You are on the frozen roster</span>}
      </div></div>
        {account?.is_admin && <AdminEventTools key={eventId} event={event} busy={busy || chatBusy} onPhase={phase => act(async () => {
          if (phase === 'pre') { await setPhase({ eventId, phase }); if (event.status === 'open') await start({ eventId }); if (event.matchingStatus !== 'ready') await prepareAll(eventId); }
          else await setPhase({ eventId, phase });
          setNotice(`Event is now in ${stageNames[phase]}.`);
        })} onEdit={values => act(async () => { await editEvent({ eventId, ...values }); setNotice('Event updated.'); })} onDelete={() => act(async () => { await deleteEvent({ eventId }); setEventId(''); setNotice('Event deleted. Personal profiles are preserved.'); })} />}
        {eventId === '6897a464-75b2-40d3-8dc0-d0c698d0b272' && <section className="event-demo-introduction" aria-label="About MHacks"><img src="/redesign/mhacks-demo.jpg" width={1600} height={1066} alt="MHacks participants and organizers talking at Pierpont Commons" /><small>Photo: <a href="https://www.mhacks.org/" target="_blank" rel="noreferrer">MHacks</a> · previous edition</small><h3>Introduction</h3><p>MHacks brings student builders together at the University of Michigan to create projects, exchange ideas and meet future collaborators. This demo lets you try mutuals event recommendations and your personal Pre, During and Post agents.</p></section>}
        {(account?.is_admin || !member || eventPhase !== 'during') && <EventAreaMap key={eventId} eventId={eventId} title={event.title} points={areaPoints} canEdit={account?.is_admin} busy={busy || chatBusy} onSave={async points => {
          await setEventArea({ eventId, areaJson: JSON.stringify(points) }); setNotice(points.length ? 'Event area saved.' : 'Event area cleared.');
        }} />}
        <dl className="event-metadata"><div><dt>Time</dt><dd>{new Date(Number(event.startAtMs)).toLocaleString()}</dd></div><div><dt>Location</dt><dd>{event.venue}</dd></div></dl><section className="event-description"><h3>Description</h3><p>{event.description || 'The organizer has not added a description yet.'}</p></section>
        {signedIn && account && !account.profile_ready && <p className="workspace-alert">Save your resume or introduction and complete indexing on <a href="/chat">My profile</a> before joining.</p>}
        {event.status === 'open' && <p className="workspace-muted">Joining shares your name and headline with event members for recommendations. Your resume stays private. The organizer locks the participant list by pressing Start; Pre then compares everyone on that list.</p>}
        {event.status === 'started' && event.matchingStatus !== 'ready' && <p role="status">Pre is preparing the frozen roster: {event.preparedCount} / {event.memberCount} personal lists ready.{account?.is_admin ? ' Use Resume if preparation was interrupted.' : ''}</p>}
        {member && <><a className="nav-link" href={`/assistant?event=${encodeURIComponent(eventId)}`}>Open your agent chats →</a>
          <div className="agent-workspace"><div className="agent-primary">
            {eventPhase === 'post' && <EventRecap key={`${eventId}__${account!.user_id}`} eventId={eventId} onBusy={setRecapBusy} />}

            {eventPhase === 'during' && <><section className="event-checkin"><h3>{chatting ? 'Busy · chatting' : checkedIn ? 'Free · ready to meet' : 'Waiting for location'}</h3><p>Nearby alerts start when you allow location. Accepting a connection makes you busy. Tap End chat when you finish to become free again.</p></section></>}
            {eventPhase !== 'pre' && <section className="event-connections"><h3>{eventPhase === 'post' ? 'Connections to follow up' : 'Your connections'}</h3>{eventInteractions.length ? eventInteractions.map(row => {
              const data = JSON.parse(row.payloadJson), incoming = row.targetId === account?.user_id, name = incoming ? data.user_name : data.target_name;
              const contact = eventContacts.find(contact => contact.userId === (incoming ? row.userId : row.targetId) && contact.shared);
              return <article className="connection-card" key={row.interactionId}><div><h4>{name || 'Participant'}</h4><p>{row.status === 'requested' ? incoming ? 'Incoming request' : 'Request sent' : row.status === 'accepted' ? 'Connected · chat in progress' : row.status === 'completed' ? 'Chat marked finished' : row.status === 'declined' ? 'Request declined' : row.status}</p>
                {eventPhase === 'post' && row.reason && <p>{row.reason}</p>}
                {eventPhase === 'post' && contact?.linkedinUrl && ['accepted','recorded','completed'].includes(row.status) && <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`${name || 'Participant'}'s LinkedIn`}>LinkedIn ↗</a>}
              </div><div className="workspace-actions">
                {eventPhase === 'during' && incoming && row.status === 'requested' && <><button disabled={busy || chatting} onClick={() => respond(row.interactionId, true)}>Accept</button><button disabled={busy} onClick={() => respond(row.interactionId, false)}>Decline</button></>}
                {['accepted','recorded'].includes(row.status) && <button className="intake-submit" aria-label={`End chat with ${name || 'Participant'}`} disabled={busy} onClick={() => void act(async () => { await finishConnection({ eventId, interactionId: row.interactionId }); setNotice('Chat ended. Nearby matching resumes.'); await refresh(); })}>End chat</button>}
                {eventPhase === 'post' && ['accepted','recorded','completed'].includes(row.status) && <button disabled={chatBusy || busy} onClick={() => void submitChat(`Prepare my follow-up draft for connection ${row.interactionId}.`, 'post')}>Prepare follow-up</button>}
              </div></article>;
            }) : <p className="workspace-empty">Your accepted connections and requests will appear here.</p>}
              {eventPhase === 'post' && eventPlans.map(plan => <article className="followup-card" key={plan.planId}><span className="eyebrow">YOUR PRIVATE DRAFT · UNSENT</span><small>{JSON.parse(plan.channelsJson).join(', ')} · {plan.suggestedTiming}</small><textarea aria-label="Your follow-up draft" readOnly value={plan.yourDraft} /><p>{plan.rationale}</p><button className="workspace-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(plan.yourDraft); setNotice('Follow-up copied. You can review and send it yourself.'); })}>Copy draft</button></article>)}
              {eventPhase === 'post' && <p className="workspace-muted">Drafts stay private to you. Review them and send through your chosen channel.</p>}
            </section>}
            <EventContactEditor key={eventId} contact={ownContact} busy={busy || chatBusy} onSave={values => act(async () => { await setContact({ eventId, ...values }); setNotice(values.share ? 'Your LinkedIn is shared with your accepted event connections.' : 'Your LinkedIn is private.'); })} />
          </div></div>
        </>}
        </div><aside className="event-people-panel">{member ? peoplePanel : <><h2>People</h2><p>Join this event to see your personal matches.</p></>}</aside></div>
      </section>}
      {assistantsOnly && (signedIn ? <section className="unified-assistants" aria-label="Your agent chats"><nav className="agent-event-list" aria-label="Saved event conversations"><h2>Events</h2>{events.filter(row => members.some(member => member.eventId === row.eventId) || messages.some(message => message.eventId === row.eventId)).map(row => <button key={row.eventId} disabled={chatBusy} aria-pressed={eventId === row.eventId} onClick={() => selectEvent(row.eventId)}>{row.title}</button>)}</nav><div className="unified-thread">{event ? <><h2>{event.title}</h2><div className="agent-tabs" role="tablist" aria-label="Your event assistants">{(['pre','during','post'] as Stage[]).map(value => <button role="tab" aria-selected={stage === value} key={value} disabled={chatBusy} onClick={() => changeStage(value)}>{stageNames[value]} agent</button>)}</div>{assistantPanel}</> : <p>Your saved event conversations will appear here.</p>}</div></section> : <button className="intake-submit" onClick={onSignIn}>Sign in to open your agent chats</button>)}
    </main><footer className="chat-footer">MHACKS / MEET YOUR PEOPLE <span>Before, during, and after. All in one place.</span></footer>
  </div>;
}

type EventDetails = { title: string; description: string; venue: string; startAtMs: bigint };
function EventContactEditor({ contact, busy, onSave }: {
  contact?: { linkedinUrl: string; shared: boolean }; busy: boolean; onSave: (values: { linkedinUrl: string; share: boolean }) => Promise<void>;
}) {
  const [linkedinUrl, setLinkedinUrl] = useState(contact?.linkedinUrl || ''), [share, setShare] = useState(contact?.shared || false);
  useEffect(() => { setLinkedinUrl(contact?.linkedinUrl || ''); setShare(contact?.shared || false); }, [contact?.linkedinUrl, contact?.shared]);
  return <section className="event-contact" aria-label="Your contact sharing"><h3>Your LinkedIn</h3><p className="workspace-muted">Choose whether accepted connections in this event can see your profile link. You can stop sharing at any time.</p>
    <form onSubmit={event => { event.preventDefault(); void onSave({ linkedinUrl, share }); }}><label>LinkedIn profile URL<input type="url" aria-label="LinkedIn profile URL" maxLength={300} placeholder="https://www.linkedin.com/in/your-name" value={linkedinUrl} onChange={event => setLinkedinUrl(event.target.value)} /></label>
      <label className="contact-consent"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} />Share with my accepted connections in this event</label><button className="workspace-button" disabled={busy}>Save contact sharing</button>
    </form>
  </section>;
}

function AdminEventTools({ event, busy, onPhase, onEdit, onDelete }: {
  event: EventDetails & { phase: string; matchingStatus: string; status: string }; busy: boolean;
  onPhase: (phase: Stage) => Promise<void>; onEdit: (values: EventDetails) => Promise<void>; onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(event.title), [description, setDescription] = useState(event.description), [venue, setVenue] = useState(event.venue);
  const time = new Date(Number(event.startAtMs));
  const [date, setDate] = useState(new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0,16));
  return <section className="admin-event" aria-label="Manage selected event"><span className="eyebrow">ADMIN · EVENT PHASE: {(event.phase || 'pre').toUpperCase()}</span><div className="workspace-actions">
    {(['pre','during','post'] as Stage[]).map(phase => <button className="workspace-button" key={phase} disabled={busy || (phase !== 'pre' && event.matchingStatus !== 'ready')} aria-label={`Set event to ${stageNames[phase]}`} onClick={() => void onPhase(phase)}>{phase === 'pre' && event.matchingStatus !== 'ready' ? 'Pre · prepare matches' : stageNames[phase]}</button>)}
    <button className="workspace-button" disabled={busy} onClick={() => setEditing(value => !value)}>Edit event</button><button className="workspace-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete event</button>
  </div>{confirmDelete && <div role="alert"><p>Delete this event and its matching, chat and connection records?</p><div className="workspace-actions"><button className="workspace-button" disabled={busy} onClick={() => void onDelete()}>Confirm delete event</button><button className="workspace-button" onClick={() => setConfirmDelete(false)}>Cancel</button></div></div>}
  {editing && <form onSubmit={e => { e.preventDefault(); void onEdit({ title, description, venue, startAtMs: BigInt(new Date(date).getTime()) }); }}>
    <label>Title<input aria-label="Edit event title" maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label><label>Venue<input aria-label="Edit event venue" maxLength={200} required value={venue} onChange={e => setVenue(e.target.value)} /></label><label>Date<input aria-label="Edit event date" type="datetime-local" required value={date} onChange={e => setDate(e.target.value)} /></label><label>Description<textarea aria-label="Edit event description" maxLength={3000} value={description} onChange={e => setDescription(e.target.value)} /></label><button className="intake-submit" disabled={busy}>Save event changes</button>
  </form>}</section>;
}

function CreateEvent({ busy, onCreate }: { busy: boolean; onCreate: (values: EventDetails) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [venue, setVenue] = useState(''), [date, setDate] = useState('');
  return <section className="admin-event" aria-label="Administrator event tools"><button className="workspace-button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close event form' : '+ Create an event'} <small>ADMIN</small></button>{open && <form onSubmit={e => {
    e.preventDefault(); const time = new Date(date).getTime(); if (Number.isFinite(time)) void onCreate({ title, description, venue, startAtMs: BigInt(time) });
  }}><h2>Publish an invitation</h2><p>People join from the invitation link. You decide when to start and lock the roster.</p><label>Event title<input aria-label="Event title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required /></label><label>Venue<input aria-label="Event venue" value={venue} onChange={e => setVenue(e.target.value)} maxLength={200} required /></label><label>Scheduled time<input aria-label="Event time" type="datetime-local" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Invitation message<textarea aria-label="Invitation message" value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} /></label><button className="intake-submit" disabled={busy} type="submit">Publish invitation</button></form>}</section>;
}

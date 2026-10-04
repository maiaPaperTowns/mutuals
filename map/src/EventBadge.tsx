// The mutuals FREE-WILi badge on the events page (During). Terry's event engine decides who you should meet (Pre
// fit scores, ASI reasons, live event GPS); the badge is the pocket screen and buttons for it:
//   AI nearby alert      → "someone's nearby!" + name, distance and the AI's talking points; YES = request, NO = dismiss
//   incoming request     → "<name> wants to meet!" + the AI's reason;                       YES = accept,  NO = decline
//   accepted connection  → "you found them!" (+50 pts once, added to your connections)
//   checked in / not     → "looking..." / "not discoverable"
import { useContext, useEffect } from 'react';
import { badgeSupported, useBadge, type BadgeButton, type BadgeStatus } from './badge';
import { usePoints } from './points';
import { StyleContext } from './style';

export type EventNearbyAlert = { title: string; body: string; targetId: string };
export type EventRequest = { interactionId: string; name: string; reason: string };
export type EventConnection = { interactionId: string; name: string };

const BUTTON_LABEL: Record<BadgeButton, string> = { gray: 'MENU', yellow: 'BACK', green: 'YES', blue: 'NEXT', red: 'NO' };

/** "Alex is nearby and free" + "Alex is about 42 m away. Pre fit 87/100. … Talk about: rust, robots." */
function readNearby(alert: EventNearbyAlert) {
  const name = alert.title.replace(/\s+is nearby and free$/i, '').trim() || 'someone';
  const meters = Number(/about (\d+) m/.exec(alert.body)?.[1] ?? 0);
  const fit = /fit (\d+)\/100/i.exec(alert.body)?.[1];
  const topics = /Talk about: (.+?)\.?$/.exec(alert.body)?.[1];
  const why = topics ? `Talk about: ${topics}` : fit ? `Fit ${fit}/100` : '';
  return { name, meters, why };
}

export default function EventBadge({ active, checkedIn, myName, nearby, request, chatting, connections, onRequest, onRespond, onDismiss }: {
  active: boolean;                       // the event is in During and you're a member
  checkedIn: boolean;
  myName: string;
  nearby?: EventNearbyAlert;
  request?: EventRequest;                // an incoming request waiting for your answer
  chatting?: EventConnection;            // your accepted, ongoing connection
  connections: EventConnection[];        // every accepted connection in this event
  onRequest: (targetId: string) => void;
  onRespond: (interactionId: string, accept: boolean) => void;
  onDismiss: () => void;
}) {
  const { style } = useContext(StyleContext);
  const formal = style === 'formal';
  const score = usePoints();
  const { addEventConnection } = score;

  // Accepted event connections count once each: +50 and a name in your connections list.
  const connectionKey = connections.map(c => `${c.interactionId}:${c.name}`).join('|');
  useEffect(() => {
    for (const c of connections) addEventConnection(c.interactionId, c.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the accepted list changes
  }, [connectionKey, addEventConnection]);

  let status: BadgeStatus = { state: checkedIn ? 'A' : 'H', nearby: 0, meters: 0, name: '', nearbyIds: [], page: 'events' };
  if (active && request) status = { state: 'Q', nearby: 1, meters: 0, name: request.name, nearbyIds: [], why: request.reason, page: 'events' };
  else if (active && chatting) status = { state: 'C', nearby: 1, meters: 0, name: chatting.name, nearbyIds: [], why: formal ? 'Connected: go talk' : 'connected - go say hi!', page: 'events' };
  else if (active && nearby) {
    const n = readNearby(nearby);
    status = { state: 'N', nearby: 1, meters: n.meters, name: n.name, nearbyIds: [], why: n.why, page: 'events' };
  }

  const badge = useBadge(status, { points: score.points, met: score.met }, myName, formal, score.connections.map(c => c.name),
    (button: BadgeButton) => {
      if (status.state === 'Q' && request) {
        if (button === 'green') onRespond(request.interactionId, true);
        if (button === 'red') onRespond(request.interactionId, false);
      } else if (status.state === 'N' && nearby) {
        if (button === 'green') onRequest(nearby.targetId);
        if (button === 'red') onDismiss();
      }
    }, score.adopt, score.addRadioConnection);

  if (!badgeSupported()) return null;
  const pressed = badge.lastButton;
  const result = !pressed ? '' : status.state === 'Q' ? (pressed.button === 'green' ? 'accepting' : pressed.button === 'red' ? 'declining' : 'no action')
    : status.state === 'N' ? (pressed.button === 'green' ? 'sending a connection request' : pressed.button === 'red' ? 'dismissed' : 'no action')
    : 'no action on this page';
  const text = !active ? (formal ? 'Badge alerts start when the event is in During.' : 'Your badge lights up during the event.')
    : status.state === 'Q' ? `${status.name} wants to connect · YES accept · NO decline`
    : status.state === 'N' ? `${status.name} nearby · YES to connect · NO to dismiss`
    : status.state === 'C' ? `Connected with ${status.name}`
    : checkedIn ? (formal ? 'Searching nearby' : 'Looking for your people…') : (formal ? 'Private: check in to be found' : 'Not discoverable: check in first');
  return <aside className={`event-badge${badge.connected ? ' on' : ''}${formal ? ' formal' : ''}`} aria-label="mutuals badge">
    <span className="event-badge-icon" aria-hidden="true">{formal ? '◧' : '🐶'}</span>
    <div className="event-badge-copy">
      <b>{badge.connected ? 'mutuals badge connected' : 'mutuals badge'}</b>
      <small>{badge.error || (badge.connected ? text : 'Connect your FREE-WILi to get alerts and answer with its buttons')}</small>
      {badge.connected && pressed && <small className="event-badge-press">{BUTTON_LABEL[pressed.button]} pressed → {result}</small>}
    </div>
    <button type="button" onClick={() => void (badge.connected ? badge.disconnect() : badge.connect())}>{badge.connected ? 'Disconnect' : 'Connect'}</button>
  </aside>;
}

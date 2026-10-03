import { useState } from 'react';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DEMO_PERSONAS, type Presence, type ZoneId, ZONES } from './types';

const LOCAL_ID_KEY = 'mhacks-map-participant-id';
const LOCAL_ZONE_KEY = 'mhacks-map-zone';
const getParticipantId = () => {
  const existing = localStorage.getItem(LOCAL_ID_KEY);
  if (existing) return existing;
  const created = `participant-${crypto.randomUUID()}`;
  localStorage.setItem(LOCAL_ID_KEY, created);
  return created;
};

function MapContent({ live }: { live: boolean }) {
  return live ? <LiveMapContent /> : <PreviewMapContent />;
}

function PreviewMapContent() {
  const [participantId] = useState(getParticipantId);
  const [zoneId, setZoneId] = useState<ZoneId>(() => {
    const stored = localStorage.getItem(LOCAL_ZONE_KEY);
    return ZONES.some(zone => zone.id === stored) ? (stored as ZoneId) : 'main-hall';
  });
  const [joined, setJoined] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const presences: Presence[] = [...DEMO_PERSONAS, ...(joined ? [{ participantId, zoneId, isDemoPersona: false }] : [])];
  const updateZone = async (nextZone: ZoneId) => {
    setZoneId(nextZone);
    localStorage.setItem(LOCAL_ZONE_KEY, nextZone);
  };
  const toggleJoined = async () => {
    setSaving(true);
    setMessage('');
    setJoined(value => !value);
    setSaving(false);
  };
  return renderMap({ live: false, presences, participantId, zoneId, joined, saving, message, connected: false, loaded: true, updateZone, toggleJoined });
}

function LiveMapContent() {
  const [remoteRows, isReady] = useTable(tables.presence);
  const setMyPresence = useReducer(reducers.setMyPresence);
  const leaveMap = useReducer(reducers.leaveMap);
  const { isActive } = useSpacetimeDB();
  const [participantId] = useState(getParticipantId);
  const [zoneId, setZoneId] = useState<ZoneId>(() => {
    const stored = localStorage.getItem(LOCAL_ZONE_KEY);
    return ZONES.some(zone => zone.id === stored) ? (stored as ZoneId) : 'main-hall';
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const presences: Presence[] = remoteRows.map(row => ({
        participantId: row.participantId,
        zoneId: row.zoneId,
        isDemoPersona: row.isDemoPersona,
      }));

  const joined = remoteRows.some(row => row.participantId === participantId && !row.isDemoPersona);

  const updateZone = async (nextZone: ZoneId) => {
    setZoneId(nextZone);
    localStorage.setItem(LOCAL_ZONE_KEY, nextZone);
    if (joined) {
      setSaving(true);
      setMessage('');
      try {
        await setMyPresence({ participantId, zoneId: nextZone });
      } catch {
        setMessage('区域更新失败，请重试。');
      } finally {
        setSaving(false);
      }
    }
  };

  const toggleJoined = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (joined) {
        await leaveMap({ participantId });
      } else {
        await setMyPresence({ participantId, zoneId });
      }
    } catch {
      setMessage('状态没有保存，请检查连接后重试。');
    } finally {
      setSaving(false);
    }
  };

  const connected = isActive;
  const loaded = isReady;

  return renderMap({ live: true, presences, participantId, zoneId, joined, saving, message, connected, loaded, updateZone, toggleJoined });
}

type MapViewState = {
  live: boolean;
  presences: Presence[];
  participantId: string;
  zoneId: ZoneId;
  joined: boolean;
  saving: boolean;
  message: string;
  connected: boolean;
  loaded: boolean;
  updateZone: (zone: ZoneId) => Promise<void>;
  toggleJoined: () => Promise<void>;
};

function renderMap({ live, presences, participantId, zoneId, joined, saving, message, connected, loaded, updateZone, toggleJoined }: MapViewState) {
  const counts = Object.fromEntries(ZONES.map(zone => [zone.id, presences.filter(person => person.zoneId === zone.id).length]));

  return (
    <main className="workspace">
      <section className="map-panel" aria-label="MHacks venue map">
        <div className="map-toolbar">
          <div className="map-caption"><span className="live-mark" /> LIVE NETWORK MAP <span className="caption-divider">/</span> ZONE-LEVEL ONLY</div>
          <span className="map-date">MHACKS 2026 <span>·</span> ANN ARBOR</span>
        </div>
        <div className="map-scroll">
          <div className="map-hint" aria-hidden="true">SWIPE TO EXPLORE <span>→</span></div>
          <svg className="venue-map" viewBox="0 0 960 580" role="img" aria-labelledby="map-title map-description">
            <title id="map-title">MHacks networking schematic</title>
            <desc id="map-description">A simplified, not-to-scale floor plan with six zones and anonymous opted-in participant markers.</desc>
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dadbd3" strokeWidth=".7" /></pattern>
            </defs>
            <rect x="0" y="0" width="960" height="580" fill="url(#grid)" opacity=".58" />
            <path className="walkway" d="M45 310 H900 M470 48 V532 M292 310 V540 M684 274 V548" />
            {ZONES.map(zone => {
              const zonePeople = presences.filter(person => person.zoneId === zone.id);
              return (
                <g key={zone.id} className={`zone zone-${zone.tone}${zoneId === zone.id ? ' is-selected' : ''}`} onClick={() => void updateZone(zone.id)} tabIndex={0} role="button" aria-label={`${zone.label}, ${zonePeople.length} people`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void updateZone(zone.id); }}>
                  <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="17" />
                  <text className="zone-index" x={zone.x + 17} y={zone.y + 28}>{zone.short}</text>
                  <text className="zone-name" x={zone.x + 17} y={zone.y + 54}>{zone.label}</text>
                  <text className="zone-count" x={zone.x + zone.w - 22} y={zone.y + 30} textAnchor="end">{String(zonePeople.length).padStart(2, '0')}</text>
                  <g className="markers">
                    {zonePeople.map((person, index) => {
                      const cols = Math.max(1, Math.floor((zone.w - 42) / 35));
                      const col = index % cols;
                      const row = Math.floor(index / cols);
                      const cx = zone.x + 24 + col * 34 + ((index * 7) % 8);
                      const cy = zone.y + 82 + row * 33;
                      const isMe = person.participantId === participantId;
                      return (
                        <g key={person.participantId} className={`person-marker${isMe ? ' is-me' : ''}${person.isDemoPersona ? ' is-demo' : ''}`} transform={`translate(${cx} ${cy})`}>
                          <circle className="marker-pulse" r="13" />
                          <circle className="marker-dot" r="7" />
                          <title>{isMe ? 'You · opted in' : person.isDemoPersona ? 'DEMO PERSONA · anonymous' : 'Anonymous participant'}</title>
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })}
            <g className="not-scale"><path d="M846 535h48" /><text x="846" y="558">NOT TO SCALE</text></g>
          </svg>
        </div>
        <footer className="map-footer"><span><i className="legend-dot" /> Anonymous participant</span><span><i className="legend-dot demo" /> Demo persona</span><span className="privacy-note">No names or exact location are shown</span></footer>
      </section>

      <aside className="side-panel">
        <header className="brand"><div className="brand-mark">mh<span>+</span></div><div><span className="eyebrow">FIND YOUR PEOPLE</span><h1>Make the room<br />feel smaller.</h1></div></header>
        <p className="intro">See who's open to meeting nearby. Opt in when you're ready; your identity stays off the map.</p>

        <section className="status-card" aria-live="polite">
          <div className="status-row"><span className={`status-light${connected ? ' connected' : live ? '' : ' preview'}`} /><strong>{connected ? 'Connected' : live ? 'Connecting to live map' : 'Local preview'}</strong><span className="status-label">{connected ? 'SPACETIME' : live ? 'LIVE' : 'DEMO'}</span></div>
          <p>{connected ? 'Changes sync live for everyone on this map.' : live ? 'Connecting to the shared event map…' : 'Add cloud settings to enable shared, real-time updates.'}</p>
        </section>

        <section className="join-card">
          <div className="join-copy"><span className="eyebrow">YOUR PRESENCE</span><h2>{joined ? "You're on the map" : 'Stay discoverable'}</h2><p>{joined ? `Showing in ${ZONES.find(zone => zone.id === zoneId)?.label}.` : 'Your anonymous dot appears only while you opt in.'}</p></div>
          <button className={`toggle${joined ? ' active' : ''}`} type="button" role="switch" aria-checked={joined} aria-label="Show me on the map and open to meet" disabled={saving || (live && !connected)} onClick={() => void toggleJoined()}><span /></button>
          <div className="zone-picker"><label htmlFor="zone">YOUR CURRENT AREA</label><select id="zone" value={zoneId} disabled={saving} onChange={event => void updateZone(event.target.value as ZoneId)}>{ZONES.map(zone => <option value={zone.id} key={zone.id}>{zone.label}</option>)}</select></div>
          {message && <p className="form-message" role="alert">{message}</p>}
        </section>

        <section className="people-card"><div className="section-heading"><div><span className="eyebrow">AROUND THE VENUE</span><h2>{loaded ? presences.length : '—'} <small>people</small></h2></div><span className="sync-chip">{live && connected ? 'SYNCED' : 'PREVIEW'}</span></div>
          <div className="zone-list">{ZONES.map((zone, index) => <button type="button" key={zone.id} className={`zone-list-item${zoneId === zone.id ? ' selected' : ''}`} onClick={() => void updateZone(zone.id)}><span className={`zone-swatch swatch-${zone.tone}`}>{String(index + 1).padStart(2, '0')}</span><span className="zone-list-name">{zone.label}<small>{zone.short}</small></span><span className="zone-list-count">{String(counts[zone.id] ?? 0).padStart(2, '0')}</span></button>)}</div>
        </section>

        <div className="privacy-callout"><span className="lock-icon" aria-hidden="true">◈</span><p><strong>Privacy by default.</strong> Dots are anonymous and zone-level. Your name and profile are never shown on this map.</p></div>
        <footer className="side-footer"><span>BUILT FOR MHACKS</span><span>01 / NETWORK MAP</span></footer>
      </aside>
    </main>
  );
}

export default function App({ live }: { live: boolean }) {
  return <MapContent live={live} />;
}

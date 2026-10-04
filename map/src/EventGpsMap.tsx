import { useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import { EventAreaLayer, type AreaPoint } from './EventAreaMap';

export type EventPin = { locationId: string; eventId: string; userId: string; name: string; latitude: number; longitude: number; accuracyMeters: number; updatedAt: { microsSinceUnixEpoch: bigint } };
const marker = (mine: boolean, favorite: boolean) => L.divIcon({ className: `live-pin${mine ? ' live-pin-mine' : ''}${favorite ? ' event-star-pin' : ''}`, html: `<span>${favorite ? '★' : ''}</span>`, iconSize: [22,22], iconAnchor: [11,11] });
function FocusPin({ pin }: { pin?: EventPin }) {
  const map = useMap();
  useEffect(() => { if (pin) map.flyTo([pin.latitude, pin.longitude], 18); }, [map, pin?.latitude, pin?.longitude]);
  return null;
}

export default function EventGpsMap({ eventId, userId, pins, checkedIn, focusedId, stars, onError, areaPoints = [], eventTitle = 'Event', onResetFocus }: {
  eventId: string; userId: string; pins: readonly EventPin[]; checkedIn: boolean; focusedId: string; stars: Set<string>; onError: (message: string) => void;
  areaPoints?: AreaPoint[]; eventTitle?: string; onResetFocus?: () => void;
}) {
  const update = useReducer(reducers.updateEventLocation);
  const stop = useReducer(reducers.stopEventLocation);
  const [sharing, setSharing] = useState(true);
  const [gpsStatus, setGpsStatus] = useState('');
  const latest = useRef({ update, stop, onError }); latest.current = { update, stop, onError };
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!sharing || !checkedIn) return;
    if (!navigator.geolocation) { setGpsStatus('This browser does not support location. Nearby alerts need location permission.'); return; }
    let active = true, lastSent = 0;
    const receive = (position: GeolocationPosition) => {
      if (!active || inFlight.current || Date.now() - lastSent < 5000) return;
      lastSent = Date.now();
      const { latitude, longitude, accuracy } = position.coords;
      setGpsStatus(accuracy <= 100 ? `GPS is shared with this event · ±${Math.round(accuracy)} m` : `GPS accuracy ±${Math.round(accuracy)} m is too low for nearby alerts.`);
      inFlight.current = latest.current.update({ eventId, latitude, longitude, accuracyMeters: accuracy })
        .catch(err => { if (active) latest.current.onError(err instanceof Error ? err.message : String(err)); })
        .finally(() => { inFlight.current = null; });
    };
    const failed = (error: GeolocationPositionError) => {
      if (!active) return;
      setGpsStatus(error.code === 1 ? 'Location permission was denied. Enable it in your browser, then try again.' : 'GPS is unavailable. Try moving outdoors. Nearby alerts need an accurate position.');
      if (error.code === 1) setSharing(false);
    };
    const options = { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 };
    const watcher = navigator.geolocation.watchPosition(receive, failed, options);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') navigator.geolocation.getCurrentPosition(receive, failed, options); }, 20000);
    return () => {
      active = false; navigator.geolocation.clearWatch(watcher); window.clearInterval(timer);
      // Wait for an already-sent update so cleanup cannot be overwritten by it.
      void Promise.resolve(inFlight.current).then(() => latest.current.stop({ eventId })).catch(() => {});
    };
  }, [sharing, checkedIn, eventId]);
  const visible = pins.filter(pin => pin.eventId === eventId && pin.accuracyMeters <= 100 && Date.now() - Number(pin.updatedAt.microsSinceUnixEpoch / 1000n) <= 120000);
  const mine = visible.find(pin => pin.userId === userId), focused = visible.find(pin => pin.userId === focusedId);
  const toggle = async () => {
    if (!sharing) {
      if (!navigator.geolocation) { latest.current.onError('This browser does not support GPS.'); return; }
      setSharing(true); return;
    }
    setSharing(false); setGpsStatus('GPS sharing stopped.');
    try { await inFlight.current; await stop({ eventId }); } catch (err) { if (mounted.current) latest.current.onError(String(err)); }
  };
  return <section className="event-map-section" aria-label="Event GPS map">
    <div className="section-heading"><div><span className="eyebrow">DURING / FIND YOUR PEOPLE</span><h3>People nearby</h3></div>
      <button className={sharing && checkedIn ? 'workspace-button active' : 'workspace-button'} disabled={!checkedIn} onClick={() => void toggle()}>{sharing && checkedIn ? 'Stop sharing GPS' : 'Share event GPS'}</button></div>
    <p className="workspace-muted">Allow location to find free people within 100 m using your saved Pre matches. Your location is shared with event members while this page is open. You can stop sharing at any time.</p>
    {gpsStatus && <p role="status" className="gps-status">{gpsStatus}</p>}
    <div className="event-map"><MapContainer center={mine ? [mine.latitude, mine.longitude] : [42.2912, -83.7157]} zoom={17} scrollWheelZoom={false}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <EventAreaLayer areas={[{ eventId, title: eventTitle, points: areaPoints }]} onReset={onResetFocus} />
      <FocusPin pin={focused || (areaPoints.length < 3 ? mine : undefined)} />
      {visible.map(pin => <Marker key={pin.locationId} position={[pin.latitude, pin.longitude]} icon={marker(pin.userId === userId, stars.has(pin.userId))}><Tooltip><b>{pin.userId === userId ? 'You' : pin.name}</b>{stars.has(pin.userId) ? ' · ★ Favorite' : ''}</Tooltip></Marker>)}
      {mine && <Circle center={[mine.latitude, mine.longitude]} radius={100} pathOptions={{ color: '#729f48', fillOpacity: .08, weight: 1 }} />}
    </MapContainer></div>
    <p className="workspace-muted">{visible.length} current GPS pin{visible.length === 1 ? '' : 's'} · Starred people show ★. Indoor GPS may be imprecise.</p>
  </section>;
}

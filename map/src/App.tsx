import { Fragment, useEffect, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';

const DUDERSTADT: [number, number] = [42.2912, -83.7157];
const ID_KEY = 'mhacks-map-participant-id';
type LocationPin = { participantId: string; latitude: number; longitude: number; accuracyMeters: number };

function participantId() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = `participant-${crypto.randomUUID()}`;
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

const pinIcon = (mine: boolean) => L.divIcon({
  className: `live-pin${mine ? ' live-pin-mine' : ''}`,
  html: '<span></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const venueIcon = L.divIcon({
  className: 'venue-pin',
  html: '<span class="venue-dot"></span><b>DUDERSTADT CENTER</b><small>2281 Bonisteel Blvd</small>',
  iconSize: [176, 48],
  iconAnchor: [10, 20],
});

function LiveMapContent() {
  const [rows, loaded] = useTable(tables.liveLocation);
  const setPresence = useReducer(reducers.setMyPresence);
  const updateLocation = useReducer(reducers.updateMyLocation);
  const stopLocation = useReducer(reducers.stopSharingLocation);
  const leaveMap = useReducer(reducers.leaveMap);
  const { isActive } = useSpacetimeDB();
  const [id] = useState(participantId);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [locationError, setLocationError] = useState('');
  const sharingRef = useRef(false);
  const lastSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const pins: LocationPin[] = rows.map(row => ({
    participantId: row.participantId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
  }));

  useEffect(() => {
    if (!sharing || !isActive || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(position => {
      if (!sharingRef.current) return;
      if (position.coords.accuracy > 10000) {
        setLocationError('Location accuracy is too low to show. Move outdoors or try again later.');
        return;
      }
      const now = Date.now();
      const last = lastSentRef.current;
      const movedEnough = !last || L.latLng(last.lat, last.lng).distanceTo([position.coords.latitude, position.coords.longitude]) >= 8;
      if (!movedEnough && now - (last?.time ?? 0) < 5000) return;
      lastSentRef.current = { lat: position.coords.latitude, lng: position.coords.longitude, time: now };
      setLocationError('');
      void updateLocation({
        participantId: id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }).catch(() => setLocationError('Location sync failed. Check your connection and try again.'));
    }, error => {
      setLocationError(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. Allow location in your browser settings, then try again.'
        : error.code === error.POSITION_UNAVAILABLE ? 'Your device cannot determine a location right now.' : 'Location timed out. Move outdoors or try again.');
    }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [sharing, isActive, id, updateLocation]);

  const toggleSharing = async () => {
    setBusy(true);
    setMessage('');
    setLocationError('');
    try {
      if (sharing) {
        sharingRef.current = false;
        setSharing(false);
        await stopLocation({ participantId: id });
        await leaveMap({ participantId: id });
      } else {
        if (!navigator.geolocation) throw new Error("This browser doesn't support location. Try a modern browser on your phone.");
        lastSentRef.current = null;
        await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(
          () => resolve(),
          error => reject(new Error(error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Allow location in your browser settings, then try again.'
            : error.code === error.POSITION_UNAVAILABLE ? 'Your device cannot determine a location right now.' : 'Location timed out. Move outdoors or try again.')),
          { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
        ));
        await setPresence({ participantId: id, zoneId: 'main-hall' });
        sharingRef.current = true;
        setSharing(true);
      }
    } catch (error) {
      if (!sharing) sharingRef.current = false;
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const connected = isActive;
  return <MapExperience pins={pins} myId={id} loaded={loaded} connected={connected} sharing={sharing} busy={busy} message={message || locationError} onToggle={toggleSharing} />;
}

function MapExperience({ pins, myId, loaded, connected, sharing, busy, message, onToggle, preview = false }: {
  pins: LocationPin[]; myId: string; loaded: boolean; connected: boolean; sharing: boolean; busy: boolean; message: string; onToggle: () => void; preview?: boolean;
}) {
  return <main className="map-app">
    <MapContainer center={DUDERSTADT} zoom={17} zoomControl={false} scrollWheelZoom className="leaflet-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ZoomControl position="bottomright" />
      <Marker position={DUDERSTADT} icon={venueIcon} interactive={false} />
      {pins.map(pin => <Fragment key={pin.participantId}>
        <Circle center={[pin.latitude, pin.longitude]} radius={Math.max(5, pin.accuracyMeters)} pathOptions={{ color: pin.participantId === myId ? '#174d39' : '#227c62', fillColor: pin.participantId === myId ? '#31835f' : '#58a88b', fillOpacity: 0.1, weight: 1 }} />
        <Marker position={[pin.latitude, pin.longitude]} icon={pinIcon(pin.participantId === myId)}><title>{pin.participantId === myId ? 'Your location' : 'Anonymous participant'}</title></Marker>
      </Fragment>)}
    </MapContainer>

    <header className="map-topbar"><a className="brand" href="/" aria-label="MHacks live map"><span className="brand-mark">mh<span>+</span></span><span><b>MHACKS</b><small>LIVE CAMPUS MAP</small></span></a><div className={`connection ${connected ? 'online' : ''}`}><i />{preview ? 'Local preview' : connected ? 'Live sync' : 'Connecting'}</div></header>

    <section className="map-card" aria-label="Live location sharing controls">
      <span className="eyebrow">DUDERSTADT CENTER · ANN ARBOR</span>
      <h1>Find people nearby.</h1>
      <p className="subhead">Only anonymous live locations appear here. Names and profiles stay private.</p>
      <div className="count-line"><span className="count-number">{loaded ? pins.length : '—'}</span><span>people sharing location</span><i className="count-live" /></div>
      <button className={`share-button${sharing ? ' sharing' : ''}`} type="button" role="switch" aria-checked={sharing} disabled={busy || (!connected && !preview)} onClick={onToggle}>
        <span className="switch-dot" />{busy ? 'Updating…' : sharing ? 'Stop sharing my location' : 'Share my live location'}
      </button>
      <div className="consent"><span aria-hidden="true">◉</span><p>{preview ? <>In local preview, your <strong>GPS location</strong> appears only in this browser and isn't synced to the cloud.</> : <>When enabled, your <strong>exact GPS location</strong> is visible to everyone viewing this map. You can turn sharing off at any time.</>}</p></div>
      {sharing && <p className="sharing-status">{message || (preview ? 'Local preview: your location is not sent to anyone.' : "Waiting for your phone's location… The first fix may take a few seconds.")}</p>}
      {!sharing && message && <p className="error-message" role="alert">{message}</p>}
    </section>

    <div className="map-bottom"><span>GPS accuracy shown by circles · Indoor locations may drift</span><span>Map data &copy; OpenStreetMap</span></div>
  </main>;
}

function PreviewMap() {
  const [sharing, setSharing] = useState(false);
  const [pin, setPin] = useState<LocationPin | null>(null);
  const id = useState(participantId)[0];
  useEffect(() => {
    if (!sharing || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(position => setPin({ participantId: id, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }), () => {}, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [sharing, id]);
  return <MapExperience pins={pin ? [pin] : []} myId={id} loaded connected={false} sharing={sharing} busy={false} message="" preview onToggle={() => setSharing(value => !value)} />;
}

export default function App({ live }: { live: boolean }) {
  return live ? <LiveMapContent /> : <PreviewMap />;
}

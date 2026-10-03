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
        setLocationError('当前定位精度太低，暂不显示。请到室外或稍后重试。');
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
      }).catch(() => setLocationError('位置同步失败。请确认仍在线后重试。'));
    }, error => {
      setLocationError(error.code === error.PERMISSION_DENIED
        ? '浏览器未授权定位。请在地址栏权限设置中允许定位后再试。'
        : error.code === error.POSITION_UNAVAILABLE ? '设备暂时无法获取定位。' : '定位请求超时，请到室外或重试。');
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
        if (!navigator.geolocation) throw new Error('此浏览器不支持定位。请使用手机上的现代浏览器。');
        lastSentRef.current = null;
        await new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(
          () => resolve(),
          error => reject(new Error(error.code === error.PERMISSION_DENIED
            ? '浏览器未授权定位。请在地址栏权限设置中允许定位后再试。'
            : error.code === error.POSITION_UNAVAILABLE ? '设备暂时无法获取定位。' : '定位请求超时，请到室外或重试。')),
          { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
        ));
        await setPresence({ participantId: id, zoneId: 'main-hall' });
        sharingRef.current = true;
        setSharing(true);
      }
    } catch (error) {
      if (!sharing) sharingRef.current = false;
      setMessage(error instanceof Error ? error.message : '操作失败，请检查连接后重试。');
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
        <Marker position={[pin.latitude, pin.longitude]} icon={pinIcon(pin.participantId === myId)}><title>{pin.participantId === myId ? '你的位置' : '匿名参与者'}</title></Marker>
      </Fragment>)}
    </MapContainer>

    <header className="map-topbar"><a className="brand" href="/" aria-label="MHacks live map"><span className="brand-mark">mh<span>+</span></span><span><b>MHACKS</b><small>LIVE CAMPUS MAP</small></span></a><div className={`connection ${connected ? 'online' : ''}`}><i />{preview ? '本地预览' : connected ? '实时同步中' : '连接中'}</div></header>

    <section className="map-card" aria-label="实时位置分享控制">
      <span className="eyebrow">DUDERSTADT CENTER · ANN ARBOR</span>
      <h1>找到正在这里的人。</h1>
      <p className="subhead">地图仅显示匿名实时位置，不显示姓名或个人资料。</p>
      <div className="count-line"><span className="count-number">{loaded ? pins.length : '—'}</span><span>人正在分享位置</span><i className="count-live" /></div>
      <button className={`share-button${sharing ? ' sharing' : ''}`} type="button" role="switch" aria-checked={sharing} disabled={busy || (!connected && !preview)} onClick={onToggle}>
        <span className="switch-dot" />{busy ? '正在更新…' : sharing ? '停止分享我的位置' : '分享我的实时位置'}
      </button>
      <div className="consent"><span aria-hidden="true">◉</span><p>{preview ? <>本地预览只会在此浏览器显示你的<strong> GPS 位置</strong>，不会同步到云端。</> : <>开启后，你的<strong>精确 GPS 位置</strong>会显示给所有打开本地图的人。随时可以关闭。</>}</p></div>
      {sharing && <p className="sharing-status">{message || (preview ? '本地预览：位置不会发送给其他人。' : '正在等待手机定位…首次定位可能需要几秒。')}</p>}
      {!sharing && message && <p className="error-message" role="alert">{message}</p>}
    </section>

    <div className="map-bottom"><span>GPS 精度以圆圈表示 · 室内定位可能漂移</span><span>地图数据 &copy; OpenStreetMap</span></div>
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

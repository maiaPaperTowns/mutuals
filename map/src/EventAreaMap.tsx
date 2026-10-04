import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

export type AreaPoint = [number, number];
export type EventArea = { eventId: string; title: string; points: AreaPoint[] };
const NORTH_CAMPUS: AreaPoint = [42.2912, -83.7157];

export function readEventArea(areaJson?: string): AreaPoint[] {
  try {
    const points = JSON.parse(areaJson || '[]');
    return Array.isArray(points) && points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value))) ? points : [];
  } catch { return []; }
}

export function EventAreaLayer({ areas, autoFit = true, homeLayout = false, onReset }: { areas: EventArea[]; autoFit?: boolean; homeLayout?: boolean; onReset?: () => void }) {
  const map = useMap();
  const points = areas.flatMap(area => area.points.length >= 3 ? area.points : []);
  const boundary = JSON.stringify(points);
  const fit = (centered = false) => {
    if (points.length) {
      const size = map.getSize();
      let left = 24, top = 24, right = 24, bottom = 24;
      if (homeLayout) {
        const container = map.getContainer(), app = container.closest('.map-app');
        const mapRect = container.getBoundingClientRect();
        const card = app?.querySelector('.map-card')?.getBoundingClientRect();
        const header = app?.querySelector('.map-topbar')?.getBoundingClientRect();
        top = header?.height ? header.bottom - mapRect.top + 24 : 110;
        if (size.x <= 600) bottom = card?.height ? mapRect.bottom - card.top + 24 : 355;
        else left = card?.width ? card.right - mapRect.left + 24 : 420;
      }
      const margin = centered ? .1 : .22;
      const x = Math.round(Math.max(0, size.x - left - right) * margin);
      const y = Math.round(Math.max(0, size.y - top - bottom) * margin);
      map.fitBounds(points, { paddingTopLeft: [left + x, top + y], paddingBottomRight: [right + x, bottom + y], maxZoom: 23 });
    }
    else map.setView(NORTH_CAMPUS, 17);
  };
  useEffect(() => { if (autoFit && points.length) fit(); }, [map, boundary, autoFit]);
  return <>
    {areas.filter(area => area.points.length >= 3).map(area => <Polygon key={area.eventId} positions={area.points} pathOptions={{ color: '#64833e', fillColor: '#9ab967', fillOpacity: .13, weight: 2 }}><Tooltip sticky>{area.title} · Event area</Tooltip></Polygon>)}
    <button type="button" className="workspace-button event-area-reset" aria-label="Reset to event area"
      ref={element => { if (element) L.DomEvent.disableClickPropagation(element); }} onClick={event => { event.stopPropagation(); onReset?.(); fit(true); }}>⌖ Center</button>
  </>;
}

function DrawBoundary({ enabled, points, onPoint }: { enabled: boolean; points: AreaPoint[]; onPoint: (point: AreaPoint) => void }) {
  useMapEvents({ click: event => { if (enabled) onPoint([event.latlng.lat, event.latlng.lng]); } });
  return <>
    {points.length > 1 && <Polyline positions={points.length >= 3 ? [...points, points[0]] : points} pathOptions={{ color: '#174d39', dashArray: '6 5', weight: 2 }} />}
    {points.map((point, index) => <CircleMarker key={index} center={point} radius={5} pathOptions={{ color: '#174d39', fillOpacity: 1 }}><Tooltip permanent direction="top">{index + 1}</Tooltip></CircleMarker>)}
  </>;
}

export default function EventAreaMap({ eventId, title, points, canEdit = false, busy = false, onSave }: {
  eventId: string; title: string; points: AreaPoint[]; canEdit?: boolean; busy?: boolean; onSave?: (points: AreaPoint[]) => Promise<void>;
}) {
  const [drawing, setDrawing] = useState(false), [draft, setDraft] = useState<AreaPoint[]>([]), [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const blocked = busy || saving;
  const save = async (boundary: AreaPoint[]) => {
    setError(''); setSaving(true);
    try { await onSave?.(boundary); setDrawing(false); setDraft([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <section className="event-map-section" aria-label="Event area map">
    <div className="section-heading"><div><span className="eyebrow">ACTIVITY / EVENT AREA</span><h3>{title} area</h3></div>
      {canEdit && !drawing && <div className="workspace-actions"><button className="workspace-button" disabled={blocked} onClick={() => { setDraft([]); setError(''); setDrawing(true); }}>Draw event area</button>
        {points.length >= 3 && <button className="workspace-button" disabled={blocked} onClick={() => void save([])}>Clear event area</button>}</div>}
    </div>
    <p className="workspace-muted">{drawing ? `Click at least 3 boundary points in order around the area, then save. ${draft.length} / 50 points.` : points.length >= 3 ? "The shaded boundary shows this activity's area. Center zooms in to fit the area on screen." : 'The organizer has not marked an area yet. Center returns to North Campus.'}</p>
    {drawing && <div className="workspace-actions"><button className="intake-submit" disabled={blocked || draft.length < 3} onClick={() => void save(draft)}>Save event area</button><button className="workspace-button" disabled={blocked || !draft.length} onClick={() => setDraft(value => value.slice(0, -1))}>Undo point</button><button className="workspace-button" disabled={blocked} onClick={() => { setDrawing(false); setDraft([]); setError(''); }}>Cancel drawing</button></div>}
    {error && <p role="alert" className="intake-error">{error}</p>}
    <div className={`event-map${drawing ? ' event-map-drawing' : ''}`}><MapContainer center={NORTH_CAMPUS} zoom={17} maxZoom={23} zoomSnap={.1} zoomDelta={.5} scrollWheelZoom={false} doubleClickZoom={!drawing}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={23} />
      <EventAreaLayer areas={[{ eventId, title, points }]} autoFit={!drawing} />
      <DrawBoundary enabled={drawing && !blocked && draft.length < 50} points={draft} onPoint={point => setDraft(value => [...value, point])} />
    </MapContainer></div>
  </section>;
}

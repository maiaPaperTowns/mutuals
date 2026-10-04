// @vitest-environment jsdom
import React from 'react';
import L from 'leaflet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import EventAreaMap, { EventAreaLayer, type AreaPoint } from '../src/EventAreaMap';

const boundary: AreaPoint[] = [[42.289, -83.72], [42.289, -83.71], [42.295, -83.71], [42.295, -83.72]];
const original3d = L.Browser.any3d;
beforeEach(() => {
  // Leaflet needs a viewport and SVG support; jsdom has neither layout nor SVG feature detection.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320);
  L.Browser.svg = true;
  L.Browser.any3d = true;
});
afterEach(() => { cleanup(); L.Browser.any3d = original3d; vi.restoreAllMocks(); });

it('fits the complete saved boundary on load and again after panning and reset', () => {
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
  const { container, rerender } = render(<EventAreaMap eventId="e1" title="MHacks" points={boundary} />);
  expect(fit.mock.calls[0][1]).toMatchObject({ maxZoom: 23 });
  const overview = fit.mock.calls[0][1]!.paddingTopLeft as [number, number];
  expect(container.querySelector('path.leaflet-interactive')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  expect(fit).toHaveBeenCalledTimes(2);
  const centered = fit.mock.calls[1][1]!.paddingTopLeft as [number, number];
  expect(centered[0]).toBeLessThan(overview[0]);
  expect(centered[1]).toBeLessThan(overview[1]);
  const other: AreaPoint[] = [[10, 20], [11, 20], [11, 21]];
  rerender(<EventAreaMap eventId="e2" title="Other event" points={other} />);
  expect(fit).toHaveBeenLastCalledWith(other, expect.objectContaining({ maxZoom: 23 }));
});

it('draws real map clicks, supports undo, and preserves the draft when saving fails', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Please retry')).mockResolvedValue(undefined);
  const { container } = render(<EventAreaMap eventId="e1" title="MHacks" points={[]} canEdit onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Draw event area' }));
  const map = container.querySelector('.leaflet-container')!;
  for (const [clientX, clientY] of [[100, 100], [300, 100], [300, 240]]) fireEvent.click(map, { clientX, clientY });
  expect(screen.getByText(/3 \/ 50 points/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo point' }));
  expect(screen.getByRole('button', { name: 'Save event area' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(map, { clientX: 300, clientY: 240 });
  fireEvent.click(screen.getByRole('button', { name: 'Save event area' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please retry');
  const points = save.mock.calls[0][0] as AreaPoint[];
  expect(points).toHaveLength(3);
  expect(points[0][1]).toBeLessThan(points[1][1]);
  expect(points[2][0]).toBeLessThan(points[1][0]);
  fireEvent.click(screen.getByRole('button', { name: 'Save event area' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save event area' })).toBeNull());
  expect(save).toHaveBeenLastCalledWith(points);
});

it('leaves space for the home map overlays and releases participant focus when resetting', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds'), reset = vi.fn();
  render(<MapContainer center={[42.2912, -83.7157]} zoom={17}><EventAreaLayer areas={[{ eventId: 'e1', title: 'MHacks', points: boundary }]} homeLayout onReset={reset} /></MapContainer>);
  expect(fit.mock.calls[0][1]).toMatchObject({ maxZoom: 23 });
  const overview = fit.mock.calls[0][1]!.paddingTopLeft as [number, number];
  expect(overview[0]).toBeGreaterThan(420);
  expect(overview[1]).toBeGreaterThan(110);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  expect(reset).toHaveBeenCalledOnce();
  const centered = fit.mock.calls[1][1]!.paddingTopLeft as [number, number];
  expect(centered[0]).toBeGreaterThanOrEqual(420);
  expect(centered[0]).toBeLessThan(overview[0]);
});

it('centers a small area to about 80% of the unobstructed viewport, above zoom 17', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
  const tiny: AreaPoint[] = [[42.2911, -83.7158], [42.2913, -83.7158], [42.2913, -83.7156]];
  render(<EventAreaMap eventId="tiny" title="Small event" points={tiny} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  const map = fit.mock.instances[0];
  expect(map.getZoom()).toBeGreaterThan(17);
  const projected = tiny.map(point => map.latLngToContainerPoint(point));
  const width = Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x));
  const height = Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y));
  expect(Math.max(width / (1000 - 48), height / (700 - 48))).toBeGreaterThan(.74);
  expect(Math.max(width / (1000 - 48), height / (700 - 48))).toBeLessThanOrEqual(.81);
});

it('keeps a centered home boundary between the mobile header and card', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
  render(<MapContainer center={[42.2912, -83.7157]} zoom={17}><EventAreaLayer areas={[{ eventId: 'e1', title: 'MHacks', points: boundary }]} homeLayout /></MapContainer>);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  const options = fit.mock.calls[1][1]!;
  expect((options.paddingTopLeft as [number, number])[1]).toBeGreaterThan(110);
  expect((options.paddingBottomRight as [number, number])[1]).toBeGreaterThan(355);
});

it('uses measured mobile overlays even when their gap is under 80px', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(667);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('map-topbar')) return { top: 0, bottom: 122, height: 122 } as DOMRect;
    if (this.classList.contains('map-card')) return { top: 180, bottom: 633, height: 453, width: 370 } as DOMRect;
    return { top: 0, bottom: 667, left: 0, right: 390, width: 390, height: 667 } as DOMRect;
  });
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
  render(<div className="map-app"><header className="map-topbar" /><section className="map-card" /><MapContainer center={[42.2912, -83.7157]} zoom={17}><EventAreaLayer areas={[{ eventId: 'e1', title: 'MHacks', points: boundary }]} homeLayout /></MapContainer></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  expect((fit.mock.calls[1][1]!.paddingBottomRight as [number, number])[1]).toBeGreaterThanOrEqual(511);
});

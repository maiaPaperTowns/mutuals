// @vitest-environment jsdom
import React from 'react';
import L from 'leaflet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MapContainer } from 'react-leaflet';
import EventAreaMap, { EventAreaLayer, type AreaPoint } from '../src/EventAreaMap';

const boundary: AreaPoint[] = [[42.289, -83.72], [42.289, -83.71], [42.295, -83.71], [42.295, -83.72]];
beforeEach(() => {
  // Leaflet needs a viewport and SVG support; jsdom has neither layout nor SVG feature detection.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(320);
  L.Browser.svg = true;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('fits the complete saved boundary on load and again after panning and reset', () => {
  const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
  const { container, rerender } = render(<EventAreaMap eventId="e1" title="MHacks" points={boundary} />);
  expect(fit).toHaveBeenLastCalledWith(boundary, { padding: [36, 36], maxZoom: 17 });
  expect(container.querySelector('path.leaflet-interactive')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  expect(fit).toHaveBeenCalledTimes(2);
  const other: AreaPoint[] = [[10, 20], [11, 20], [11, 21]];
  rerender(<EventAreaMap eventId="e2" title="Other event" points={other} />);
  expect(fit).toHaveBeenLastCalledWith(other, { padding: [36, 36], maxZoom: 17 });
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
  expect(fit).toHaveBeenLastCalledWith(boundary, { paddingTopLeft: [420, 110], paddingBottomRight: [36, 36], maxZoom: 17 });
  fireEvent.click(screen.getByRole('button', { name: 'Reset to event area' }));
  expect(reset).toHaveBeenCalledOnce();
});

// @vitest-environment jsdom
import React, { useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
const state = vi.hoisted(() => ({ watches: vi.fn(), stops: vi.fn(), reducer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@clerk/react', () => ({ SignIn: () => null, SignUp: () => null, useClerk: () => ({}) }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>, Marker: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => null, Tooltip: ({ children }: any) => <div>{children}</div>, ZoomControl: () => null,
  useMap: () => ({ flyTo: vi.fn(), getContainer: () => document.createElement('div') }),
}));
vi.mock('../src/EventAreaMap', () => ({ EventAreaLayer: () => null, readEventArea: () => [] }));
vi.mock('../src/badge', () => ({ badgeSupported: () => false, badgeStatus: () => ({ state: 'H', nearbyIds: [] }), useBadge: () => ({}) }));
vi.mock('../src/points', () => ({
  LEVEL_AT: [], LEVEL_NAME: [], TIER_NAME: [],
  usePoints: () => ({ points: 0, level: 1, progress: 0, met: 0, connections: [], award: vi.fn(), repairNames: vi.fn() }),
}));
vi.mock('spacetimedb/react', () => ({
  useTable: () => [[], true], useReducer: () => state.reducer,
  useSpacetimeDB: () => ({ isActive: true, identity: { toHexString: () => 'me' } }),
}));
vi.mock('../src/HomePanels', () => ({
  FavoritePeople: () => null, HomeNavigation: () => null, LiveFavoritePeople: () => null,
  LiveHomeNavigation: () => <a href="/assistant?event=e1">Assistance</a>,
}));
vi.mock('../src/NetworkingWorkspace', () => ({ default: () => {
  const [sharing, setSharing] = useState(true);
  useEffect(() => { state.watches(); return () => { state.stops(); }; }, []);
  return <div><h1>Assistant page</h1><a href="/">Live map</a><button onClick={() => setSharing(false)}>{sharing ? 'Stop GPS' : 'GPS stopped'}</button></div>;
} }));
vi.mock('../src/LiveProfileChat', () => ({ default: () => <div>Profile page</div> }));
vi.mock('../src/ProfileChat', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('navigates without a document reload and preserves active page instances across round trips and browser Back', async () => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const watchPosition = vi.fn().mockReturnValue(1), clearWatch = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, geolocation: {
    watchPosition, clearWatch,
    getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 42.29, longitude: -83.71, accuracy: 10 } } as GeolocationPosition),
  } });
  render(<App live authEnabled={false} signedIn accountName="Terry" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Share my live location' }));
  await waitFor(() => expect(watchPosition).toHaveBeenCalledOnce());
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  act(() => { screen.getByRole('link', { name: 'Assistance' }).dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(window.location.pathname).toBe('/assistant');
  await screen.findByRole('heading', { name: 'Assistant page' });
  fireEvent.click(screen.getByRole('button', { name: 'Stop GPS' }));
  fireEvent.click(screen.getByRole('link', { name: 'Live map' }));
  expect(state.stops).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'Assistance' }));
  expect(screen.getByRole('button', { name: 'GPS stopped' })).toBeTruthy();
  expect(state.watches).toHaveBeenCalledOnce();
  window.history.back();
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(state.stops).not.toHaveBeenCalled();
  expect(clearWatch).not.toHaveBeenCalled();
  expect(watchPosition).toHaveBeenCalledOnce();
});




// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import LiveProfileChat from '../src/LiveProfileChat';

const state = vi.hoisted(() => ({ rows: [] as object[], loaded: true, active: true, save: vi.fn(), load: vi.fn(), submit: vi.fn() }));
vi.mock('../src/CloudNetworking', () => ({ default: () => null }));
vi.mock('spacetimedb/react', () => ({
  useTable: () => [state.rows, state.loaded],
  useReducer: () => state.save,
  useProcedure: (definition: { accessorName: string }) => definition.accessorName === 'loadCloudProfile' ? state.load : state.submit,
  useSpacetimeDB: () => ({ isActive: state.active }),
}));
beforeEach(() => {
  vi.stubEnv('VITE_ASI_API_URL', 'http://localhost:8101');
  state.rows = []; state.loaded = true; state.active = true; state.save.mockReset().mockResolvedValue(undefined);
  state.load.mockReset().mockResolvedValue(JSON.stringify({ profile: null })); state.submit.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const props = { signedIn: true, accountName: 'Terry', getToken: async () => 'clerk-jwt', onSignIn: () => {}, accountControl: null };

it('creates a private account profile before looking up the ASI profile', async () => {
  state.load.mockImplementation(async () => {
    expect(state.save).toHaveBeenCalledWith({ displayName: 'Terry', headline: '', interests: '', showOnMap: false });
    return JSON.stringify({ profile: null });
  });
  render(<LiveProfileChat {...props} />);
  await waitFor(() => expect(state.load).toHaveBeenCalledOnce());
});
it('retains an existing profile and waits for the authenticated database connection', async () => {
  state.rows = [{ displayName: 'Existing name', showOnMap: true }]; state.active = false;
  const { rerender } = render(<LiveProfileChat {...props} />);
  expect(screen.getByRole('status').textContent).toContain('Loading'); expect(state.load).not.toHaveBeenCalled();
  state.active = true; rerender(<LiveProfileChat {...props} />);
  await waitFor(() => expect(state.load).toHaveBeenCalledOnce()); expect(state.save).not.toHaveBeenCalled();
});
it('does not send profile data when account creation fails', async () => {
  state.save.mockRejectedValue(new Error('Account could not be saved'));
  const fetcher = vi.spyOn(globalThis, 'fetch');
  render(<LiveProfileChat {...props} />);
  await screen.findByRole('alert'); expect(fetcher).not.toHaveBeenCalled();
  expect(state.load).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CloudNetworking from '../src/CloudNetworking';
import { tables } from '../src/module_bindings';

const cloud = vi.hoisted(() => ({ load: vi.fn(), presence: vi.fn(), leave: vi.fn(), matches: vi.fn(), events: vi.fn(), respond: vi.fn(), draft: vi.fn(), plans: [] as object[], interactions: [] as object[] }));
vi.mock('spacetimedb/react', () => ({
  useProcedure: (d: { accessorName: string }) => ({ loadCloudProfile: cloud.load, getCloudOpportunities: cloud.matches, getCloudEventRecommendations: cloud.events, draftCloudFollowup: cloud.draft }[d.accessorName]),
  useReducer: (d: { accessorName: string }) => ({ setCloudPresence: cloud.presence, leaveCloudEvent: cloud.leave, respondCloudConnection: cloud.respond }[d.accessorName] ?? vi.fn()),
  useTable: (d: unknown) => [d === tables.myAgentFollowUpPlans ? cloud.plans : cloud.interactions, true],
}));
beforeEach(() => {
  for (const fn of [cloud.load, cloud.presence, cloud.leave, cloud.matches, cloud.events, cloud.respond, cloud.draft]) fn.mockReset();
  cloud.load.mockResolvedValue(JSON.stringify({ user_id: 'me', profile: { name: 'Terry' } }));
  cloud.presence.mockResolvedValue(undefined); cloud.leave.mockResolvedValue(undefined);
  cloud.matches.mockResolvedValue('[]'); cloud.events.mockResolvedValue('[]'); cloud.plans = []; cloud.interactions = [];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('starts matching only after explicit opt-in and stops it on checkout', async () => {
  render(<CloudNetworking />);
  expect(cloud.presence).not.toHaveBeenCalled(); expect(cloud.matches).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Meet people at the event' }));
  await screen.findByRole('button', { name: 'Check in and find people' });
  fireEvent.click(screen.getByRole('button', { name: 'Check in and find people' }));
  await screen.findByText('No current matches. Ask another participant to check in, or try another area.');
  expect(cloud.presence).toHaveBeenCalledWith({ zoneId: 'main-hall', availabilityStatus: 'free', discoverable: true });
  fireEvent.click(screen.getByRole('button', { name: 'Check out' }));
  await waitFor(() => expect(cloud.leave).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: 'Check in and find people' });
});

it('does not claim a failed check-in succeeded', async () => {
  cloud.presence.mockRejectedValue(new Error('Database disconnected'));
  render(<CloudNetworking />);
  fireEvent.click(screen.getByRole('button', { name: 'Meet people at the event' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Check in and find people' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Database disconnected');
  expect(cloud.matches).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Check out' })).toBeNull();
});

it('waits for an in-flight heartbeat before checkout and blocks late timer callbacks', async () => {
  let tick: () => void = () => {};
  vi.spyOn(window, 'setInterval').mockImplementation(callback => { tick = callback as () => void; return 1; });
  let finishHeartbeat: () => void = () => {};
  render(<CloudNetworking />);
  fireEvent.click(screen.getByRole('button', { name: 'Meet people at the event' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Check in and find people' }));
  await screen.findByText('No current matches. Ask another participant to check in, or try another area.');
  cloud.presence.mockImplementationOnce(() => new Promise<void>(resolve => { finishHeartbeat = resolve; }));
  tick();
  fireEvent.click(screen.getByRole('button', { name: 'Check out' }));
  expect(cloud.leave).not.toHaveBeenCalled();
  finishHeartbeat();
  await waitFor(() => expect(cloud.leave).toHaveBeenCalledOnce());
  tick();
  expect(cloud.presence).toHaveBeenCalledTimes(2);
});

it('offers an incoming request response and labels drafts as unsent', async () => {
  cloud.interactions = [{ interactionId: 'request', userId: 'peer', targetId: 'me', status: 'requested', payloadJson: '{"user_name":"Alex"}' }];
  cloud.plans = [{ planId: 'plan', interactionId: 'accepted', peerId: 'peer', yourDraft: 'Great meeting you.', channelsJson: '["email"]', suggestedTiming: 'Tomorrow', rationale: '', approved: false, sendStatus: null }];
  cloud.respond.mockResolvedValue(undefined);
  render(<CloudNetworking />);
  fireEvent.click(screen.getByRole('button', { name: 'Meet people at the event' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept Alex' }));
  await waitFor(() => expect(cloud.respond).toHaveBeenCalledWith({ interactionId: 'request', accept: true }));
  expect(screen.getByText('Draft only. Copy it and send it yourself.')).toBeTruthy();
  expect(screen.getByDisplayValue('Great meeting you.')).toBeTruthy();
});

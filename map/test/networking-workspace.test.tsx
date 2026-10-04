// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NetworkingWorkspace from '../src/NetworkingWorkspace';
import { tables } from '../src/module_bindings';

const state = vi.hoisted(() => ({
  invites: [] as any[], members: [] as any[], messages: [] as any[], notifications: [] as any[],
  status: vi.fn(), list: vi.fn(), create: vi.fn(), prepare: vi.fn(), send: vi.fn(), join: vi.fn(), start: vi.fn(), star: vi.fn(),
  noop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('spacetimedb/react', () => ({
  useSpacetimeDB: () => ({ isActive: true }),
  useProcedure: (d: { accessorName: string }) => ({ networkingAccountStatus: state.status, getEventInterestList: state.list, createNetworkingEvent: state.create, prepareNetworkingEvent: state.prepare, sendAssistantMessage: state.send }[d.accessorName] ?? vi.fn()),
  useReducer: (d: { accessorName: string }) => ({ joinNetworkingEvent: state.join, startNetworkingEvent: state.start, setEventStar: state.star }[d.accessorName] ?? state.noop),
  useTable: (d: unknown) => [d === tables.networkingInvitations ? state.invites : d === tables.myNetworkingMemberships ? state.members : d === tables.myAssistantMessages ? state.messages : d === tables.myAssistantNotifications ? state.notifications : d === tables.myProfile ? [{ displayName: 'Terry' }] : [], true],
}));
const props = { signedIn: true, accountName: 'Terry', onSignIn: vi.fn(), accountControl: null };
beforeEach(() => {
  window.history.replaceState({}, '', '/events?event=e1');
  for (const fn of [state.status, state.list, state.create, state.prepare, state.send, state.join, state.start, state.star]) fn.mockReset();
  state.invites = [{ eventId: 'e1', title: 'Builders meetup', description: 'Meet engineers', venue: 'Duderstadt', startAtMs: 1790000000000n, status: 'open', matchingStatus: 'waiting', memberCount: 2, preparedCount: 0 }];
  state.members = []; state.messages = []; state.notifications = [];
  state.status.mockResolvedValue('{"user_id":"me","is_admin":false,"profile_ready":true}');
  state.join.mockResolvedValue(undefined); state.start.mockResolvedValue(undefined); state.star.mockResolvedValue(undefined);
  state.list.mockResolvedValue('{"ready":true,"total":0,"items":[]}');
  state.prepare.mockResolvedValue('{"matching_status":"ready","prepared_count":2,"member_count":2}');
  state.send.mockResolvedValue('{"reply":"Start with Alex.","actions":[]}');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('public invitation requires sign-in, then joining is explicit and roster closure disables it', async () => {
  const { rerender } = render(<NetworkingWorkspace {...props} signedIn={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in to join' }));
  expect(props.onSignIn).toHaveBeenCalled(); expect(state.join).not.toHaveBeenCalled();
  rerender(<NetworkingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Join event' }));
  await waitFor(() => expect(state.join).toHaveBeenCalledWith({ eventId: 'e1' }));
  state.invites = [{ ...state.invites[0], status: 'started', matchingStatus: 'ready' }];
  rerender(<NetworkingWorkspace {...props} />);
  expect(screen.getByRole('button', { name: 'Joining closed' }).hasAttribute('disabled')).toBe(true);
});

it('loads five recommendations then more without losing favorites', async () => {
  state.invites[0].status = 'started'; state.invites[0].matchingStatus = 'ready';
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me', availabilityStatus: 'offline', discoverable: true, zoneId: '' }];
  const card = (i: number) => ({ target_id: `u${i}`, target_name: `Person ${i}`, role: 'Engineer', location: { zone: 'lounge' }, fit_score: 85, reason_for_connection: 'Shared interests', starred: false, availability: 'free' });
  state.list.mockImplementation(async ({ offset }: { offset: number }) => JSON.stringify({ ready: true, total: 7, items: offset === 0 ? [1,2,3,4,5].map(card) : [6,7].map(card) }));
  render(<NetworkingWorkspace {...props} />);
  await screen.findByText('Person 1');
  fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));
  await screen.findByText('Person 7'); expect(screen.getByText('Person 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Star Person 1' }));
  await waitFor(() => expect(state.star).toHaveBeenCalledWith({ eventId: 'e1', targetId: 'u1', starred: true }));
});

it('an ASI failure preserves the typed message and retry uses the same request id', async () => {
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  state.send.mockRejectedValueOnce(new Error('ASI unavailable'));
  render(<NetworkingWorkspace {...props} />);
  const input = await screen.findByRole('textbox', { name: 'Message your Pre agent' });
  fireEvent.change(input, { target: { value: 'Who should I meet?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('ASI unavailable'); expect((input as HTMLTextAreaElement).value).toBe('Who should I meet?');
  const id = state.send.mock.calls[0][0].requestId;
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
  expect(state.send.mock.calls[1][0].requestId).toBe(id);
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NetworkingWorkspace from '../src/NetworkingWorkspace';
import { tables } from '../src/module_bindings';

const state = vi.hoisted(() => ({
  invites: [] as any[], members: [] as any[], messages: [] as any[], notifications: [] as any[], interactions: [] as any[], exchanges: [] as any[], contacts: [] as any[],
  status: vi.fn(), list: vi.fn(), create: vi.fn(), prepare: vi.fn(), send: vi.fn(), join: vi.fn(), start: vi.fn(), star: vi.fn(),
  noop: vi.fn().mockResolvedValue(undefined), asiStatus: vi.fn().mockResolvedValue('{"connected":false}'),
  phase: vi.fn(), edit: vi.fn(), remove: vi.fn(), finish: vi.fn(), request: vi.fn(), respond: vi.fn(), recap: vi.fn(), contact: vi.fn(),
}));
vi.mock('spacetimedb/react', () => ({
  useSpacetimeDB: () => ({ isActive: true }),
  useProcedure: (d: { accessorName: string }) => ({ getAsiLinkStatus: state.asiStatus, networkingAccountStatus: state.status, getEventInterestList: state.list, createNetworkingEvent: state.create, prepareNetworkingEvent: state.prepare, sendAssistantMessage: state.send, deleteNetworkingEvent: state.remove, generateEventRecap: state.recap }[d.accessorName] ?? vi.fn()),
  useReducer: (d: { accessorName: string }) => ({ joinNetworkingEvent: state.join, startNetworkingEvent: state.start, setEventStar: state.star, setNetworkingEventPhase: state.phase, editNetworkingEvent: state.edit, finishEventConnection: state.finish, requestEventConnection: state.request, respondEventConnection: state.respond, setEventContact: state.contact }[d.accessorName] ?? state.noop),
  useTable: (d: unknown) => [d === tables.networkingInvitations ? state.invites : d === tables.myNetworkingMemberships ? state.members : d === tables.myAssistantMessages ? state.messages : d === tables.myAssistantNotifications ? state.notifications : d === tables.myAgentInteractions ? state.interactions : d === tables.myAgentExchanges ? state.exchanges : d === tables.myEventContacts ? state.contacts : d === tables.myProfile ? [{ displayName: 'Terry' }] : [], true],
}));
const props = { signedIn: true, accountName: 'Terry', onSignIn: vi.fn(), accountControl: null };
beforeEach(() => {
  window.history.replaceState({}, '', '/events?event=e1');
  for (const fn of [state.status, state.list, state.create, state.prepare, state.send, state.join, state.start, state.star]) fn.mockReset();
  state.invites = [{ eventId: 'e1', title: 'Builders meetup', description: 'Meet engineers', venue: 'Duderstadt', startAtMs: 1790000000000n, status: 'open', matchingStatus: 'waiting', memberCount: 2, preparedCount: 0 }];
  state.members = []; state.messages = []; state.notifications = []; state.interactions = []; state.exchanges = []; state.contacts = [];
  for (const fn of [state.phase, state.edit, state.remove, state.finish, state.request, state.respond, state.contact]) fn.mockReset().mockResolvedValue(undefined);
  state.recap.mockReset().mockResolvedValue('{"reply":"You connected with Alex over shared Python interests."}');
  state.status.mockResolvedValue('{"user_id":"me","is_admin":false,"profile_ready":true}');
  state.join.mockResolvedValue(undefined); state.start.mockResolvedValue(undefined); state.star.mockResolvedValue(undefined);
  state.list.mockResolvedValue('{"ready":true,"total":0,"items":[]}');
  state.prepare.mockResolvedValue('{"matching_status":"ready","prepared_count":2,"member_count":2}');
  state.send.mockResolvedValue('{"reply":"Start with Alex.","actions":[]}');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('automatically recaps Post once, shows agent exchanges and shared LinkedIn, and saves explicit contact consent', async () => {
  state.invites[0] = { ...state.invites[0], phase: 'post', status: 'started', matchingStatus: 'ready' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  state.interactions = [{ interactionId: 'i1', userId: 'me', targetId: 'alex', status: 'completed', payloadJson: '{"event_id":"e1","target_name":"Alex"}' }];
  state.contacts = [{ contactId: 'e1__alex', eventId: 'e1', userId: 'alex', linkedinUrl: 'https://www.linkedin.com/in/alex', shared: true }];
  state.exchanges = [{ exchangeId: 'x1', eventId: 'e1', fromAgent: 'post', toAgent: 'pre', question: 'Why this connection?', response: 'Both build Python maps.' }];
  const { rerender } = render(<React.StrictMode><NetworkingWorkspace {...props} /></React.StrictMode>);
  expect(await screen.findByRole('region', { name: 'Event recap' })).toBeTruthy();
  await screen.findByText('You connected with Alex over shared Python interests.');
  expect(state.recap).toHaveBeenCalledOnce();
  expect(state.recap).toHaveBeenCalledWith({ eventId: 'e1' });
  expect(screen.getByRole('link', { name: "Alex's LinkedIn" }).getAttribute('href')).toBe('https://www.linkedin.com/in/alex');
  expect(screen.getByText('Post → Pre')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'LinkedIn profile URL' }), { target: { value: 'https://www.linkedin.com/in/terry' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Share with my accepted connections in this event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save contact sharing' }));
  await waitFor(() => expect(state.contact).toHaveBeenCalledWith({ eventId: 'e1', linkedinUrl: 'https://www.linkedin.com/in/terry', share: true }));
  state.contacts = []; rerender(<React.StrictMode><NetworkingWorkspace {...props} /></React.StrictMode>);
  expect(screen.queryByRole('link', { name: "Alex's LinkedIn" })).toBeNull();
  expect(state.recap).toHaveBeenCalledOnce();
});

it('shows an event-area map and reset control before joining, with drawing restricted to admins', async () => {
  const { rerender } = render(<NetworkingWorkspace {...props} signedIn={false} />);
  expect(await screen.findByRole('region', { name: 'Event area map' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset to event area' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Draw event area' })).toBeNull();
  state.status.mockResolvedValue('{"user_id":"me","is_admin":true,"profile_ready":true}');
  rerender(<NetworkingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Draw event area' }));
  expect(screen.getByRole('button', { name: 'Save event area' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel drawing' }));
  expect(screen.getByRole('button', { name: 'Draw event area' })).toBeTruthy();
});

it('During follows the event phase, shows a nearby conversation popup, and ends an active chat without a model call', async () => {
  state.invites[0] = { ...state.invites[0], phase: 'during', status: 'started', matchingStatus: 'ready' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me', availabilityStatus: 'free', discoverable: true }];
  state.notifications = [{ notificationId: 'n1', eventId: 'e1', stage: 'during', kind: 'nearby', targetId: 'alex', title: 'Alex is nearby and free', body: 'Talk about: Python mapping projects.', read: false, createdAt: { microsSinceUnixEpoch: BigInt(Date.now()) * 1000n } }];
  const { rerender } = render(<NetworkingWorkspace {...props} />);
  const popup = await screen.findByRole('dialog', { name: 'Nearby connection' });
  expect(popup.textContent).toContain('Python mapping projects');
  expect(screen.queryByRole('combobox', { name: 'Event area' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Event availability' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connect with nearby person' }));
  await waitFor(() => expect(state.request).toHaveBeenCalledWith({ eventId: 'e1', targetId: 'alex' }));
  state.interactions = [{ interactionId: 'i1', userId: 'me', targetId: 'alex', status: 'accepted', payloadJson: '{"event_id":"e1","target_name":"Alex"}' }];
  state.members[0].availabilityStatus = 'busy';
  rerender(<NetworkingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'End chat with Alex' }));
  await waitFor(() => expect(state.finish).toHaveBeenCalledWith({ eventId: 'e1', interactionId: 'i1' }));
  expect(state.send).not.toHaveBeenCalled();
});

it('admin can switch the real event phase, edit metadata and delete through event tools', async () => {
  state.status.mockResolvedValue('{"user_id":"me","is_admin":true,"profile_ready":true}');
  state.invites[0] = { ...state.invites[0], phase: 'pre', status: 'started', matchingStatus: 'ready' };
  render(<NetworkingWorkspace {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Set event to During' }));
  await waitFor(() => expect(state.phase).toHaveBeenCalledWith({ eventId: 'e1', phase: 'during' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit event' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit event title' }), { target: { value: 'New meetup name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save event changes' }));
  await waitFor(() => expect(state.edit).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', title: 'New meetup name' })));
  fireEvent.click(screen.getByRole('button', { name: 'Delete event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete event' }));
  await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ eventId: 'e1' }));
});

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

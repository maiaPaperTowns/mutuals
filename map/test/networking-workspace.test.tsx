// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('keeps historical agent threads usable across phases in the unified assistant route', async () => {
  window.history.replaceState({}, '', '/assistant?event=e1&stage=pre');
  state.invites[0] = { ...state.invites[0], phase: 'post', status: 'started', matchingStatus: 'ready' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  state.messages = [{ messageId: 'old', eventId: 'e1', stage: 'pre', role: 'assistant', content: 'Your saved Pre advice', createdAt: { microsSinceUnixEpoch: 1n } }];
  const { rerender } = render(<NetworkingWorkspace {...props} />);
  expect(await screen.findByText('Your saved Pre advice')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Post agent/ }).hasAttribute('disabled')).toBe(false);
  const input = screen.getByRole('textbox', { name: 'Message your Pre agent' });
  fireEvent.change(input, { target: { value: 'Explain my preparation again.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', stage: 'pre' })));
  state.invites[0] = { ...state.invites[0], phase: 'during' };
  rerender(<NetworkingWorkspace {...props} />);
  expect(screen.getByRole('textbox', { name: 'Message your Pre agent' })).toBeTruthy();
  expect(screen.queryByText('Waiting for location')).toBeNull();
});

it('ranks the event People panel by descending saved Fit', async () => {
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  const match = (name: string, fit: number) => ({ target_id: name, target_name: name, role: 'Builder', fit_score: fit, location: { zone: '' }, reason_for_connection: 'Shared goals' });
  state.list.mockResolvedValue(JSON.stringify({ ready: true, total: 2, items: [match('Lower', 60), match('Higher', 95)] }));
  render(<NetworkingWorkspace {...props} />);
  await screen.findByText('Higher');
  const panel = screen.getByRole('region', { name: 'Your interest list' });
  expect(panel.textContent!.indexOf('Higher')).toBeLessThan(panel.textContent!.indexOf('Lower'));
});

it('keeps event GPS publishing available in unified chats during an ongoing event', async () => {
  window.history.replaceState({}, '', '/assistant?event=e1&stage=during');
  state.invites[0] = { ...state.invites[0], phase: 'during', status: 'started', matchingStatus: 'ready' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  const watchPosition = vi.fn().mockReturnValue(1), clearWatch = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, geolocation: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } });
  try {
    const { unmount } = render(<NetworkingWorkspace {...props} />);
    await waitFor(() => expect(watchPosition).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText('Event GPS · location controls'));
    expect(screen.getByRole('button', { name: 'Stop sharing GPS' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Pre agent' }));
    expect(watchPosition).toHaveBeenCalledOnce();
    unmount(); expect(clearWatch).toHaveBeenCalledWith(1);
  } finally { vi.unstubAllGlobals(); }
});

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
  expect(screen.getByRole('link', { name: 'Open your agent chats →' }).getAttribute('href')).toBe('/assistant?event=e1');
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

it('Reserve replaces five ranked people at a time, preserves stars and wraps the final group', async () => {
  state.invites[0].status = 'started'; state.invites[0].matchingStatus = 'ready';
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  const card = (i: number) => ({ target_id: `u${i}`, target_name: `Person ${i}`, role: 'Engineer', location: { zone: 'lounge' }, fit_score: 100 - i, reason_for_connection: 'Shared interests', starred: i === 1, availability: 'free' });
  state.list.mockImplementation(async ({ offset, limit }: { offset: number; limit: number }) => JSON.stringify({ ready: true, total: 12, items: Array.from({ length: 12 }, (_, i) => card(i + 1)).slice(offset, offset + limit) }));
  render(<NetworkingWorkspace {...props} />);
  await screen.findByText('Person 1');
  expect(screen.getByRole('button', { name: 'Unstar Person 1' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'People per page' })).toBeNull();
  for (const [first, last, offset] of [[6,10,5],[11,12,10],[1,5,0]]) {
    fireEvent.click(screen.getByRole('button', { name: 'Reserve' }));
    await screen.findByText(`Person ${first}`);
    expect(screen.getByText(`Person ${last}`)).toBeTruthy();
    expect(screen.queryByText(`Person ${first === 1 ? 11 : 1}`)).toBeNull();
    expect(state.list).toHaveBeenLastCalledWith({ eventId: 'e1', offset, limit: 5 });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Unstar Person 1' }));
  await waitFor(() => expect(state.star).toHaveBeenCalledWith({ eventId: 'e1', targetId: 'u1', starred: false }));
});

it('an ASI failure preserves the typed message and retry uses the same request id', async () => {
  window.history.replaceState({}, '', '/assistant?event=e1&stage=pre');
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


it.each([false, true])('does not resurrect an expired reply when subscription arrives first: %s', async (subscriptionFirst) => {
  window.history.replaceState({}, '', '/assistant?event=e1&stage=pre');
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  let resolveSend!: (reply: string) => void;
  if (subscriptionFirst) state.send.mockImplementation(() => new Promise<string>(resolve => { resolveSend = resolve; }));
  const { rerender } = render(<NetworkingWorkspace {...props} />);
  const input = await screen.findByRole('textbox', { name: 'Message your Pre agent' });
  fireEvent.change(input, { target: { value: 'Advice please' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
  if (!subscriptionFirst) await screen.findByText('Start with Alex.');
  const id = state.send.mock.calls[0][0].requestId;
  state.messages = [{ messageId: `me__${id}__assistant`, eventId: 'e1', stage: 'pre', role: 'assistant', content: 'Start with Alex.', createdAt: { microsSinceUnixEpoch: 1n } }];
  rerender(<NetworkingWorkspace {...props} />);
  if (subscriptionFirst) await act(async () => resolveSend('{"reply":"Start with Alex.","actions":[]}'));
  await waitFor(() => expect(screen.getAllByText('Start with Alex.').length).toBe(1));
  state.messages = Array.from({ length: 51 }, (_, i) => ({ messageId: `saved-${i}`, eventId: 'e1', stage: 'pre', role: 'assistant', content: `Saved reply ${i}`, createdAt: { microsSinceUnixEpoch: BigInt(i + 2) } }));
  rerender(<NetworkingWorkspace {...props} />);
  expect(screen.queryByText('Start with Alex.')).toBeNull();
  expect(screen.queryByText('Saved reply 0')).toBeNull();
  expect(screen.getByText('Saved reply 50')).toBeTruthy();
});

it('polling during Reserve uses the requested page and ignores an older response', async () => {
  state.invites[0] = { ...state.invites[0], status: 'started', matchingStatus: 'ready', phase: 'during' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  const callbacks: Array<() => void> = [];
  const interval = window.setInterval;
  vi.spyOn(window, 'setInterval').mockImplementation(((callback: () => void, delay: number) => {
    callbacks.push(callback);
    return interval(callback, delay);
  }) as typeof window.setInterval);
  const card = (i: number) => ({ target_id: `u${i}`, target_name: `Person ${i}`, fit_score: 100 - i, location: { zone: '' } });
  const page = (offset: number) => JSON.stringify({ ready: true, total: 10, items: Array.from({ length: 5 }, (_, i) => card(offset + i + 1)) });
  state.list.mockResolvedValue(page(0));
  render(<NetworkingWorkspace {...props} />);
  await screen.findByText('Person 1');
  const poll = callbacks[callbacks.length - 1];
  let oldPoll!: (value: string) => void;
  let reserveReply!: (value: string) => void;
  state.list.mockImplementationOnce(() => new Promise<string>(resolve => { oldPoll = resolve; }))
    .mockImplementationOnce(() => new Promise<string>(resolve => { reserveReply = resolve; })).mockResolvedValue(page(5));
  act(() => poll());
  fireEvent.click(screen.getByRole('button', { name: 'Reserve' }));
  await act(async () => { poll(); });
  await screen.findByText('Person 6');
  expect(state.list).toHaveBeenLastCalledWith({ eventId: 'e1', offset: 5, limit: 5 });
  await act(async () => oldPoll(page(0)));
  await act(async () => reserveReply(page(5)));
  expect(screen.getByText('Person 6')).toBeTruthy();
  expect(screen.queryByText('Person 1')).toBeNull();
});

it('returns to the first group when the remaining recommendations shrink below the current offset', async () => {
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  let total = 7;
  state.list.mockImplementation(async ({ offset }: { offset: number }) => JSON.stringify({ ready: true, total, items: Array.from({ length: total }, (_, i) => ({ target_id: `u${i}`, target_name: `Person ${i + 1}`, fit_score: 100 - i, location: { zone: '' } })).slice(offset, offset + 5) }));
  render(<NetworkingWorkspace {...props} />);
  await screen.findByText('Person 1');
  fireEvent.click(screen.getByRole('button', { name: 'Reserve' }));
  await screen.findByText('Person 6');
  total = 5;
  fireEvent.click(screen.getByRole('button', { name: 'Star Person 6' }));
  await screen.findByText('Person 1');
  expect(screen.getByText('Person 5')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reserve' })).toBeNull();
});

it('keeps the same GPS watcher and manual Stop state when navigating between Events and Assistance', async () => {
  state.invites[0] = { ...state.invites[0], phase: 'during', status: 'started', matchingStatus: 'ready' };
  state.members = [{ eventId: 'e1', userId: 'me', memberId: 'e1__me' }];
  const watchPosition = vi.fn().mockReturnValue(1), clearWatch = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, geolocation: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } });
  try {
    const { rerender } = render(<NetworkingWorkspace {...props} />);
    await waitFor(() => expect(watchPosition).toHaveBeenCalledOnce());
    window.history.pushState({}, '', '/assistant?event=e1');
    rerender(<NetworkingWorkspace {...props} />);
    expect(watchPosition).toHaveBeenCalledOnce();
    expect(clearWatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing GPS' }));
    await waitFor(() => expect(clearWatch).toHaveBeenCalledWith(1));
    window.history.pushState({}, '', '/events?event=e1');
    rerender(<NetworkingWorkspace {...props} />);
    expect(screen.getByRole('button', { name: 'Share event GPS' })).toBeTruthy();
    expect(watchPosition).toHaveBeenCalledOnce();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The real SDK's host syscalls exist only inside SpacetimeDB. These unit tests
// supply table contexts directly; no native syscall is invoked.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('spacetime:sys@')) {
      return { url: 'data:text/javascript,export const moduleHooks = Symbol.for("test.moduleHooks"); export function row_iter_bsatn_close() { throw new Error("Unexpected native syscall in unit test"); }', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const nodeConsole = globalThis.console;
const module = await import('../../../map/spacetimedb/src/index.ts');
globalThis.console = nodeConsole;

test('event areas are admin-only, public boundaries isolated by event, and removed with their event', () => {
  assert.equal(typeof module.setNetworkingEventArea, 'function');
  const { ctx, tx, db, eventId, peer } = networkingFixture(1);
  const areaJson = '[[42.289,-83.72],[42.289,-83.71],[42.295,-83.71],[42.295,-83.72]]';
  assert.throws(() => module.setNetworkingEventArea({ ...tx, sender: peer }, { eventId, areaJson }), /administrator/);
  assert.throws(() => module.setNetworkingEventArea(tx, { eventId: 'missing', areaJson }), /unavailable/);
  for (const invalid of ['broken', '{}', '[[1,2],[3,4]]', '[[91,2],[3,4],[5,6]]', '[[1,2],[2,4],[3,6]]']) {
    assert.throws(() => module.setNetworkingEventArea(tx, { eventId, areaJson: invalid }), /area|boundary/i);
  }
  module.setNetworkingEventArea(tx, { eventId, areaJson });
  assert.deepEqual(module.networkingEventAreas({ db }), [{ eventId, areaJson }]);
  assert.equal(db.networkingEvent.eventId.find(eventId).title, 'Engineering meetup');
  module.setNetworkingEventArea(tx, { eventId, areaJson: '[]' });
  assert.deepEqual(module.networkingEventAreas({ db }), []);
  module.setNetworkingEventArea(tx, { eventId, areaJson });
  ctx.newUuidV4 = () => 'other-event';
  const other = JSON.parse(module.createNetworkingEvent(ctx, { title: 'Other event', description: '', venue: 'North Campus', startAtMs: 1_790_000_000_000n }));
  module.setNetworkingEventArea(tx, { eventId: other.event_id, areaJson });
  module.deleteNetworkingEvent(ctx, { eventId });
  assert.deepEqual(module.networkingEventAreas({ db }), [{ eventId: other.event_id, areaJson }]);
});

test('leaving cloud networking removes presence and revokes discoverability', () => {
  const { ctx, tx, db, owner } = cloudFixture();
  module.submitCloudIntroduction(ctx, { message: 'I build software', resumeText: '', filename: '' });
  module.setCloudPresence(tx, { zoneId: 'lounge', discoverable: true, availabilityStatus: 'free' });
  assert.ok(db.agentPresence.userId.find(owner.toHexString()));
  module.leaveCloudEvent(tx, {});
  assert.equal(db.agentPresence.userId.find(owner.toHexString()), undefined);
  assert.equal(JSON.parse(db.agentProfile.userId.find(owner.toHexString()).payloadJson).discoverable, false);
});

test('the new private profile column has a migration default', () => {
  const profileTable = module.default.moduleDef.tables.find(table => table.sourceName === 'userProfile');
  assert.ok(profileTable);
  assert.equal(profileTable.defaultValues.length, 1);
  assert.equal(profileTable.defaultValues[0].colId, 6);
});

test('the original account view keeps its six-column client contract', () => {
  const { db, ctx, owner } = fixture();
  db.userProfile.identity.update({ ...db.userProfile.identity.find(owner), updatedAt: 1, agentProfileJson: '{"introduction":"Private resume facts"}' });
  const profile = module.myProfile({ ...ctx, sender: owner });
  assert.equal(Object.keys(profile).length, 6);
  assert.equal('agentProfileJson' in profile, false);
});

function identity(hex: string) {
  return { toHexString: () => hex };
}

function table(primary: string, unique: string[] = []) {
  const rows = new Map<string, any>();
  const key = (value: any) => value?.toHexString?.() ?? value;
  const write = (row: any) => {
    for (const column of unique) {
      for (const existing of rows.values()) {
        if (key(existing[primary]) !== key(row[primary]) && key(existing[column]) === key(row[column])) {
          throw new Error(`Unique constraint: ${column}`);
        }
      }
    }
    rows.set(key(row[primary]), row);
    return row;
  };
  return new Proxy({ insert: write, iter: () => rows.values() }, {
    get(target, column: string) {
      if (column in target) return target[column as keyof typeof target];
      return {
        find: (value: any) => [...rows.values()].find(row => key(row[column]) === key(value)),
        filter: (value: any) => [...rows.values()].filter(row => key(row[column]) === key(value)),
        update: write,
        delete: (value: any) => rows.delete(key(value)),
      };
    },
  }) as any;
}

function fixture() {
  const owner = identity('a'.repeat(64));
  const peer = identity('b'.repeat(64));
  const service = identity('c'.repeat(64));
  const db = {
    networkingEvent: table('eventId'), networkingEventPhase: table('eventId'), networkingEventArea: table('eventId'), networkingMember: table('memberId'), eventInterestList: table('listId'),
    eventStar: table('starId'), eventLocation: table('locationId'), assistantMessage: table('messageId'),
    eventLocationExpiry: table('scheduledId'),
    assistantNotification: table('notificationId'), assistantTurn: table('turnId'),
    cloudProviderConfig: table('name'), cloudAdmin: table('identity'), cloudOperation: table('userId'),
    agentService: table('identity'), agentAuthSubject: table('subject', ['ownerIdentity']),
    agentUserLink: table('userId', ['authSubject', 'ownerIdentity']), agentProfile: table('userId'),
    userProfile: table('identity'), agentPresence: table('userId'), agentLinkCode: table('code'),
    agentInteraction: table('interactionId'), agentTranscript: table('interactionId'),
    agentFollowUpPlan: table('planId'), agentRoiHistoryTable: table('entryId'),
    liveLocation: table('participantId'), presence: table('participantId'), participantOwner: table('participantId'),
  };
  db.agentService.insert({ identity: service });
  db.agentAuthSubject.insert({ subject: 'clerk-a', ownerIdentity: owner });
  db.userProfile.insert({ identity: owner, displayName: 'Map Name', headline: 'Map Headline', interests: 'Python, Maps', showOnMap: false });
  const ctx = { db, sender: service, timestamp: 1 } as any;
  const link = (userId = owner.toHexString()) => db.agentUserLink.insert({ userId, authSubject: 'clerk-a', ownerIdentity: owner, agentScope: 'agent' });
  const seedRelated = () => {
    db.agentInteraction.insert({ interactionId: 'i-ab', userId: 'alice', targetId: 'bob', agentScope: 'agent' });
    db.agentTranscript.insert({ interactionId: 'i-ab', userId: 'alice', targetId: 'bob', text: 'Private conversation', agentScope: 'agent' });
    db.agentFollowUpPlan.insert({ planId: 'p-ab', interactionId: 'i-ab', userA: 'alice', userB: 'bob', payloadJson: '{"drafts":{"alice":"alice@example.com"}}', agentScope: 'agent' });
    db.agentRoiHistoryTable.insert({ entryId: 'r-b', userId: 'bob', interactionId: 'i-ab', payloadJson: '{"target_id":"alice"}', agentScope: 'agent' });
    db.agentProfile.insert({ userId: 'bob', payloadJson: '{"user_id":"bob","name":"Bob"}', agentScope: 'agent' });
  };
  return { db, ctx, owner, peer, link, seedRelated };
}

function cloudFixture() {
  const f = fixture();
  const calls: Array<{ url: string; body: any }> = [];
  f.db.cloudProviderConfig.insert({ name: 'asi_api_key', value: 'fake-asi-key' });
  f.db.cloudProviderConfig.insert({ name: 'pinecone_api_key', value: 'fake-pinecone-key' });
  f.db.cloudProviderConfig.insert({ name: 'pinecone_host', value: 'https://test.svc.pinecone.io' });
  const tx = { ...f.ctx, sender: f.owner, timestamp: { microsSinceUnixEpoch: 1_790_000_000_000_000n },
    senderAuth: { jwt: { issuer: 'https://novel-griffon-9073.clerk.accounts.dev', audience: ['mhacks-live-map'], subject: 'clerk-a' } }, newUuidV4: () => 'cloud-test-id' };
  const ctx = { sender: f.owner, timestamp: tx.timestamp, newUuidV4: () => 'cloud-test-id',
    withTx: (fn: any) => fn(tx), http: { fetch: (url: string, options: any) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      calls.push({ url, body });
      let data: any = {};
      if (url.includes('chat/completions')) data = { choices: [{ message: { content: '{"name":"Wrong Name","skills":["Python"],"goals":["meet engineers"]}' } }] };
      if (url.endsWith('/embed')) data = { data: [{ values: Array(1024).fill(0.1) }] };
      return { ok: true, status: 200, json: () => data, text: () => JSON.stringify(data) };
    } } } as any;
  return { ...f, tx, ctx, calls };
}

function networkingFixture(count = 3) {
  const f = cloudFixture();
  f.db.cloudAdmin.insert({ identity: f.owner });
  const saved = JSON.parse(module.submitCloudIntroduction(f.ctx, { message: 'Python maps', resumeText: '', filename: '' }));
  const event = JSON.parse(module.createNetworkingEvent(f.ctx, { title: 'Engineering meetup', description: 'Meet builders', venue: 'Duderstadt', startAtMs: 1_790_000_000_000n }));
  const users: any[] = [f.owner];
  module.joinNetworkingEvent(f.tx, { eventId: event.event_id });
  for (let i = 1; i < count; i++) {
    const id = identity(i.toString(16).padStart(64, '0'));
    const profile = { ...saved, user_id: id.toHexString(), name: `Peer ${i}`, embedding: Array(1024).fill(i === 1 ? 0.1 : -0.1) };
    f.db.userProfile.insert({ identity: id, displayName: profile.name, headline: 'Engineer', interests: 'Python', agentProfileJson: JSON.stringify(profile) });
    f.db.agentUserLink.insert({ userId: id.toHexString(), authSubject: `clerk-${i}`, ownerIdentity: id, agentScope: 'agent' });
    module.joinNetworkingEvent({ ...f.tx, sender: id, senderAuth: { jwt: { ...f.tx.senderAuth.jwt, subject: `clerk-${i}` } } }, { eventId: event.event_id });
    users.push(id);
  }
  return { ...f, eventId: event.event_id, users, forUser: (id: any) => ({ ...f.tx, sender: id, senderAuth: { jwt: { ...f.tx.senderAuth.jwt, subject: `clerk-${users.indexOf(id)}` } } }) };
}

function automaticDuringFixture(count = 3) {
  const f = networkingFixture(count);
  let serial = 0;
  f.tx.newUuidV4 = () => `interaction-${++serial}`;
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  for (const [index, id] of f.users.entries()) module.updateEventLocation(f.forUser(id), {
    eventId: f.eventId, latitude: 42.29 + index * .0001, longitude: -83.71, accuracyMeters: 5,
  });
  return f;
}

test('GPS automatically joins During and requests reuse the exact saved Pre ROI and reason', () => {
  const f = automaticDuringFixture(2), targetId = f.users[1].toHexString();
  const list = f.db.eventInterestList.listId.find(`${f.eventId}__${f.owner.toHexString()}`);
  const items = JSON.parse(list.itemsJson);
  items[0].roi_score = 73.2; items[0].reason_for_connection = 'Discuss Python mapping projects';
  f.db.eventInterestList.listId.update({ ...list, itemsJson: JSON.stringify(items) });
  module.requestEventConnection(f.tx, { eventId: f.eventId, targetId });
  const connection = [...f.db.agentInteraction.iter()][0];
  assert.equal(connection.roiScoreAtMatch, 73.2);
  assert.equal(connection.reason, 'Discuss Python mapping projects');
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${targetId}`).availabilityStatus, 'free');
  assert.match([...f.db.assistantNotification.iter()].find(row => row.kind === 'nearby').body, /Talk about|Discuss/);
});

test('three people: acceptance makes both busy, blocks overlapping acceptance, and ending notifies both ways', () => {
  const f = automaticDuringFixture(), [a,b,c] = f.users, bId = b.toHexString();
  module.setEventStar(f.tx, { eventId: f.eventId, targetId: c.toHexString(), starred: true });
  module.setEventStar(f.forUser(c), { eventId: f.eventId, targetId: a.toHexString(), starred: true });
  module.requestEventConnection(f.tx, { eventId: f.eventId, targetId: bId });
  module.requestEventConnection(f.forUser(b), { eventId: f.eventId, targetId: a.toHexString() });
  assert.equal([...f.db.agentInteraction.iter()].length, 1, 'reversed request is idempotent');
  module.requestEventConnection(f.forUser(c), { eventId: f.eventId, targetId: bId });
  const pair = [...f.db.agentInteraction.iter()].find(row => row.userId === a.toHexString());
  const other = [...f.db.agentInteraction.iter()].find(row => row.userId === c.toHexString());
  module.respondEventConnection(f.forUser(b), { eventId: f.eventId, interactionId: pair.interactionId, accept: true });
  for (const id of [a,b]) assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${id.toHexString()}`).availabilityStatus, 'busy');
  assert.throws(() => module.respondEventConnection(f.forUser(b), { eventId: f.eventId, interactionId: other.interactionId, accept: true }), /busy|chat/);
  assert.equal(f.db.agentInteraction.interactionId.find(other.interactionId).status, 'requested');
  module.setEventAvailability(f.tx, { eventId: f.eventId, zoneId: 'main-hall', availabilityStatus: 'free', discoverable: true });
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${a.toHexString()}`).availabilityStatus, 'busy', 'client cannot override active chat');
  for (const row of [...f.db.assistantNotification.iter()]) f.db.assistantNotification.notificationId.update({ ...row, read: true });
  assert.throws(() => module.finishEventConnection(f.forUser(c), { eventId: f.eventId, interactionId: pair.interactionId }), /account|interaction/);
  module.finishEventConnection(f.tx, { eventId: f.eventId, interactionId: pair.interactionId });
  assert.equal(f.db.agentInteraction.interactionId.find(pair.interactionId).status, 'completed');
  for (const id of [a,b]) assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${id.toHexString()}`).availabilityStatus, 'free');
  const unread = [...f.db.assistantNotification.iter()].filter(row => row.kind === 'nearby' && !row.read);
  assert.ok(unread.some(row => row.userId === c.toHexString() && row.targetId === a.toHexString()), 'others hear that A is free');
  assert.ok(unread.some(row => row.userId === a.toHexString() && row.targetId === c.toHexString()), 'A hears about nearby free people');
  module.finishEventConnection(f.tx, { eventId: f.eventId, interactionId: pair.interactionId });
});

test('admin controls phase and metadata, Post stops GPS, and delete isolates event data', () => {
  const f = automaticDuringFixture(2);
  assert.throws(() => module.editNetworkingEvent(f.forUser(f.users[1]), { eventId: f.eventId, title: 'Changed', description: '', venue: 'Hall', startAtMs: 1n }), /administrator/);
  assert.throws(() => module.setNetworkingEventPhase(f.forUser(f.users[1]), { eventId: f.eventId, phase: 'post' }), /administrator/);
  module.editNetworkingEvent(f.tx, { eventId: f.eventId, title: 'Changed', description: 'New description', venue: 'Hall', startAtMs: 1n });
  assert.equal(f.db.networkingEvent.eventId.find(f.eventId).title, 'Changed');
  module.requestEventConnection(f.tx, { eventId: f.eventId, targetId: f.users[1].toHexString() });
  const connection = [...f.db.agentInteraction.iter()][0];
  module.respondEventConnection(f.forUser(f.users[1]), { eventId: f.eventId, interactionId: connection.interactionId, accept: true });
  module.finishEventConnection(f.tx, { eventId: f.eventId, interactionId: connection.interactionId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'post' });
  assert.equal(module.networkingInvitations(f.tx)[0].phase, 'post');
  assert.equal([...f.db.eventLocation.iter()].length, 0);
  assert.throws(() => module.updateEventLocation(f.tx, { eventId: f.eventId, latitude: 42, longitude: -83, accuracyMeters: 5 }), /During|during/);
  // Use a separate model adapter to verify completed connections reach Post.
  f.ctx.http.fetch = () => ({ ok: true, json: () => ({ choices: [{ message: { content: '{"draft_a":"Thanks for chatting","draft_b":"Great meeting","rationale":"Common goals"}' } }] }) });
  module.draftCloudFollowup(f.ctx, { interactionId: connection.interactionId });
  f.db.assistantMessage.insert({ messageId: 'unrelated', eventId: 'another-event', userId: f.owner.toHexString() });
  module.deleteNetworkingEvent(f.ctx, { eventId: f.eventId });
  assert.equal(f.db.networkingEvent.eventId.find(f.eventId), undefined);
  for (const table of [f.db.networkingMember, f.db.eventInterestList, f.db.eventLocation, f.db.assistantNotification, f.db.agentInteraction, f.db.agentFollowUpPlan, f.db.agentRoiHistoryTable]) assert.equal([...table.iter()].length, 0);
  assert.ok(f.db.userProfile.identity.find(f.owner));
  assert.ok(f.db.assistantMessage.messageId.find('unrelated'));
});

test('legacy response calls preserve event busy and phase rules', () => {
  const f = automaticDuringFixture(), [a,b,c] = f.users;
  module.requestEventConnection(f.tx, { eventId: f.eventId, targetId: b.toHexString() });
  module.requestEventConnection(f.forUser(c), { eventId: f.eventId, targetId: b.toHexString() });
  const rows = [...f.db.agentInteraction.iter()];
  const pair = rows.find(row => row.userId === a.toHexString());
  const other = rows.find(row => row.userId === c.toHexString());
  module.respondCloudConnection(f.forUser(b), { interactionId: pair.interactionId, accept: true });
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${b.toHexString()}`).availabilityStatus, 'busy');
  assert.throws(() => module.respondCloudConnection(f.forUser(b), { interactionId: other.interactionId, accept: true }), /busy/);
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'post' });
  assert.throws(() => module.respondCloudConnection(f.forUser(b), { interactionId: other.interactionId, accept: true }), /During/);
});

test('expired or disconnected GPS clears free presence and blocks connections', () => {
  const f = automaticDuringFixture(2), peer = f.users[1];
  const later = { ...f.tx, timestamp: { microsSinceUnixEpoch: f.tx.timestamp.microsSinceUnixEpoch + 121_000_000n } };
  assert.throws(() => module.requestEventConnection(later, { eventId: f.eventId, targetId: peer.toHexString() }), /presence/);
  module.expireEventLocation(later, { arg: { locationId: `${f.eventId}__${f.owner.toHexString()}` } } as any);
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${f.owner.toHexString()}`).availabilityStatus, 'offline');
  module.clientDisconnected(f.forUser(peer));
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${peer.toHexString()}`).availabilityStatus, 'offline');
});

test('assistant and follow-up writes honor persisted phase even when it changes during a model call', () => {
  const f = automaticDuringFixture(2);
  assert.throws(() => module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'post', message: 'Follow up', requestId: 'wrong-phase' }), /phase/);
  module.requestEventConnection(f.tx, { eventId: f.eventId, targetId: f.users[1].toHexString() });
  const pair = [...f.db.agentInteraction.iter()][0];
  module.respondEventConnection(f.forUser(f.users[1]), { eventId: f.eventId, interactionId: pair.interactionId, accept: true });
  module.finishEventConnection(f.tx, { eventId: f.eventId, interactionId: pair.interactionId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'post' });
  f.ctx.http.fetch = () => {
    module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'pre' });
    return { ok: true, json: () => ({ choices: [{ message: { content: '{"draft_a":"Draft","draft_b":"Peer draft","rationale":"Shared skills"}' } }] }) };
  };
  assert.throws(() => module.draftCloudFollowup(f.ctx, { interactionId: pair.interactionId }), /phase/);
  assert.equal([...f.db.agentFollowUpPlan.iter()].length, 0);
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  assert.throws(() => module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'during', message: 'Hello', requestId: 'changed-phase' }), /phase/);
  assert.equal([...f.db.assistantMessage.iter()].filter(row => row.role === 'assistant').length, 0);
});

test('event creation requires provisioned admin identity, never a display name', () => {
  const f = cloudFixture();
  f.db.userProfile.identity.update({ ...f.db.userProfile.identity.find(f.owner), displayName: 'Terry' });
  assert.throws(() => module.createNetworkingEvent(f.ctx, { title: 'Meetup', description: '', venue: 'Hall', startAtMs: 1n }), /administrator/);
  assert.equal(f.db.networkingEvent.iter().next().done, true);
});

test('joining is idempotent and start atomically freezes membership and profiles', () => {
  const f = networkingFixture();
  module.joinNetworkingEvent(f.tx, { eventId: f.eventId });
  assert.equal([...f.db.networkingMember.iter()].length, 3);
  assert.throws(() => module.startNetworkingEvent(f.forUser(f.users[1]), { eventId: f.eventId }), /administrator/);
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  assert.equal(f.db.networkingEvent.eventId.find(f.eventId).status, 'started');
  const snapshots = [...f.db.networkingMember.iter()].map(r => r.profileSnapshotJson);
  assert.ok(snapshots.every(Boolean));
  assert.throws(() => module.joinNetworkingEvent(f.tx, { eventId: f.eventId }), /closed|started/);
  assert.throws(() => module.leaveNetworkingEvent(f.tx, { eventId: f.eventId }), /frozen|started/);
});

test('Pre compares every frozen member and paginates the complete private list', () => {
  const f = networkingFixture(8);
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  // Changing a live profile must not replace the event snapshot.
  f.db.userProfile.identity.update({ ...f.db.userProfile.identity.find(f.users[1]), agentProfileJson: '{"embedding":null}' });
  const state = JSON.parse(module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId }));
  assert.equal(state.matching_status, 'ready');
  assert.equal([...f.db.eventInterestList.iter()].length, 8);
  const page = JSON.parse(module.getEventInterestList(f.ctx, { eventId: f.eventId, offset: 0, limit: 5 }));
  assert.equal(page.total, 7); assert.equal(page.items.length, 5);
  assert.equal(page.items[0].target_id, f.users[1].toHexString());
  assert.ok(page.items.every((c: any) => !('embedding' in c) && !('introduction' in c)));
  const tail = JSON.parse(module.getEventInterestList(f.ctx, { eventId: f.eventId, offset: 5, limit: 5 }));
  assert.equal(tail.items.length, 2);
  assert.ok(f.calls.some(c => c.url.endsWith('/vectors/upsert') && c.body.namespace.startsWith('networking-')));
  assert.equal(f.calls.filter(c => c.url.endsWith('/query')).length, 8);
  const outsider = { ...f.ctx, withTx: (fn: any) => fn({ ...f.tx, sender: f.peer }) };
  f.db.userProfile.insert({ identity: f.peer, displayName: 'Outsider', headline: '', interests: '' });
  assert.throws(() => module.getEventInterestList(outsider, { eventId: f.eventId, offset: 0, limit: 5 }), /join|member/);
});

test('GPS proximity alerts require opted-in fresh accurate positions and respect cooldown', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  for (const id of f.users.slice(0, 2)) module.setEventAvailability(f.forUser(id), { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  module.updateEventLocation(f.tx, { eventId: f.eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  const peerTx = f.forUser(f.users[1]);
  module.updateEventLocation(peerTx, { eventId: f.eventId, latitude: 42.2902, longitude: -83.71, accuracyMeters: 200 });
  assert.equal([...f.db.assistantNotification.iter()].filter(r => r.kind === 'nearby').length, 0);
  module.updateEventLocation(peerTx, { eventId: f.eventId, latitude: 42.2902, longitude: -83.71, accuracyMeters: 5 });
  assert.equal([...f.db.assistantNotification.iter()].filter(r => r.kind === 'nearby').length, 2);
  module.updateEventLocation(peerTx, { eventId: f.eventId, latitude: 42.2902, longitude: -83.71, accuracyMeters: 5 });
  assert.equal([...f.db.assistantNotification.iter()].filter(r => r.kind === 'nearby').length, 2);
  assert.equal(module.myAssistantNotifications({ ...f.tx, sender: f.peer }).length, 0);
  const mine = module.myAssistantNotifications(f.tx);
  assert.equal(mine.length, 1);
  assert.throws(() => module.markAssistantNotificationRead(peerTx, { notificationId: mine[0].notificationId }), /account/);
  module.stopEventLocation(f.tx, { eventId: f.eventId });
  assert.equal(f.db.eventLocation.locationId.find(`${f.eventId}__${f.owner.toHexString()}`), undefined);
});

test('assistant chats call ASI, persist separate personal stage histories and reuse request ids', () => {
  const f = networkingFixture();
  const args = { eventId: f.eventId, stage: 'pre', message: 'Who should I meet?', requestId: 'request-1' };
  const response = JSON.parse(module.sendAssistantMessage(f.ctx, args));
  assert.ok(response.reply);
  assert.equal(module.myAssistantMessages(f.tx).length, 2);
  module.sendAssistantMessage(f.ctx, args);
  assert.equal(module.myAssistantMessages(f.tx).length, 2);
  assert.equal(module.myAssistantMessages(f.forUser(f.users[1])).length, 0);
  assert.throws(() => module.sendAssistantMessage(f.ctx, { ...args, stage: 'unknown', requestId: 'request-2' }), /stage/);
  const call = f.calls.filter(c => c.url.includes('chat/completions')).at(-1)!;
  assert.equal(call.body.model, 'asi1');
  assert.ok(call.body.tools.some((t: any) => t.function.name === 'get_interest_list'));
  assert.equal(call.body.tools.some((t: any) => t.function.name === 'respond_connection'), false);
});

test('assistant retries a transient ASI server error without repeating an applied action', () => {
  const f = networkingFixture();
  const targetId = f.users[1].toHexString();
  let attempts = 0;
  f.ctx.http.fetch = () => {
    attempts++;
    if (attempts === 2) return { ok: false, status: 503 };
    const message = attempts === 1
      ? { tool_calls: [{ id: 'star-call', type: 'function', function: { name: 'set_star', arguments: JSON.stringify({ target_id: targetId, starred: true }) } }] }
      : { content: 'The participant is starred.' };
    return { ok: true, status: 200, json: () => ({ choices: [{ message }] }) };
  };
  const result = JSON.parse(module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'pre', message: 'Star this participant.', requestId: 'transient-request' }));
  assert.equal(attempts, 3);
  assert.equal(result.actions.length, 1);
  assert.equal([...f.db.eventStar.iter()].length, 1);
  attempts = 0;
  f.ctx.http.fetch = () => { attempts++; return { ok: false, status: 403 }; };
  assert.throws(() => module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'pre', message: 'Hello.', requestId: 'auth-failure' }), /HTTP 403/);
  assert.equal(attempts, 1);
  attempts = 0;
  f.ctx.http.fetch = () => { attempts++; return { ok: false, status: 500 }; };
  assert.throws(() => module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'pre', message: 'Hello again.', requestId: 'persistent-failure' }), /HTTP 500/);
  assert.equal(attempts, 2);
});

test('event connections are idempotent, scoped to members, and only the receiver can answer', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  for (const id of f.users) module.setEventAvailability(f.forUser(id), { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  for (const [index, id] of f.users.entries()) module.updateEventLocation(f.forUser(id), { eventId: f.eventId, latitude: 42.29, longitude: -83.71 + index, accuracyMeters: 5 });
  const args = { eventId: f.eventId, targetId: f.users[1].toHexString() };
  module.requestEventConnection(f.tx, args); module.requestEventConnection(f.tx, args);
  assert.equal([...f.db.agentInteraction.iter()].length, 1);
  assert.equal(module.myAssistantNotifications(f.forUser(f.users[1]))[0].kind, 'connection_request');
  assert.throws(() => module.respondEventConnection(f.tx, { eventId: f.eventId, interactionId: 'cloud-test-id', accept: true }), /target/);
  module.respondEventConnection(f.forUser(f.users[1]), { eventId: f.eventId, interactionId: 'cloud-test-id', accept: false });
  assert.equal(f.db.agentInteraction.interactionId.find('cloud-test-id').status, 'declined');
  assert.equal(module.myAssistantNotifications(f.tx)[0].kind, 'connection_response');
  assert.throws(() => module.requestEventConnection(f.tx, { eventId: f.eventId, targetId: f.peer.toHexString() }), /member|join/);
});

test('assistant tools cannot escape their stage or event and retry does not repeat an applied tool', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  const args = { eventId: f.eventId, stage: 'pre', message: 'Star the first participant.', requestId: 'tools-1' };
  const fetch = f.ctx.http.fetch;
  let completions = 0;
  f.ctx.http.fetch = (url: string, options: any) => {
    if (!url.includes('chat/completions')) return fetch(url, options);
    completions++;
    if (completions === 2 || completions === 3) return { ok: false, status: 503 };
    const body = JSON.parse(options.body);
    return { ok: true, json: () => ({ choices: [{ message: body.tools ? { content: null, tool_calls: [{ id: 'tool-1', function: {
      name: 'set_star', arguments: JSON.stringify({ target_id: f.users[1].toHexString(), starred: true }),
    } }] } : { content: 'This participant is now starred.' } }] }) };
  };
  assert.throws(() => module.sendAssistantMessage(f.ctx, args), /ASI.*503/);
  assert.equal([...f.db.eventStar.iter()].length, 1);
  const appliedAt = [...f.db.assistantTurn.iter()][0].resultJson;
  assert.ok(appliedAt.includes('set_star'));
  module.sendAssistantMessage(f.ctx, args);
  assert.equal([...f.db.eventStar.iter()].length, 1);
  let forbiddenAttempts = 0;
  f.ctx.http.fetch = () => ({ ok: true, json: () => ({ choices: [{ message: forbiddenAttempts++ === 0 ? { tool_calls: [{ id: 'bad', function: { name: 'request_connection', arguments: '{}' } }] } : { content: 'This action is not allowed.' } }] }) });
  // Directly calling a During-only tool through Pre is rejected before writes.
  try { module.sendAssistantMessage(f.ctx, { ...args, requestId: 'tools-2' }); } catch { /* empty provider reply is acceptable; no tool write is */ }
  assert.equal([...f.db.agentInteraction.iter()].length, 0);
});

test('account deletion cleans event snapshots, private conversations and GPS', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId }); module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'pre', message: 'Hello', requestId: 'delete-chat' });
  module.deleteCloudAccount(f.ctx, {} as any);
  assert.equal(f.db.networkingMember.memberId.find(`${f.eventId}__${f.owner.toHexString()}`), undefined);
  assert.equal(module.myAssistantMessages(f.tx).length, 0);
  assert.equal([...f.db.assistantTurn.iter()].length, 0);
  assert.ok(f.calls.some(c => c.url.endsWith('/vectors/delete') && c.body.namespace === `networking-${f.eventId}`));
});

test('a During agent can read live data then execute a requested action in the same turn', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  const fetch = f.ctx.http.fetch;
  let round = 0;
  f.ctx.http.fetch = (url: string, options: any) => {
    if (!url.includes('chat/completions')) return fetch(url, options);
    round++;
    const tool = round === 1 ? { name: 'get_interest_list', arguments: '{}' } : { name: 'set_star', arguments: JSON.stringify({ target_id: f.users[1].toHexString(), starred: true }) };
    return { ok: true, json: () => ({ choices: [{ message: round < 3 ? { content: null, tool_calls: [{ id: `round-${round}`, function: tool }] } : { content: 'I read your list and starred the participant.' } }] }) };
  };
  const response = JSON.parse(module.sendAssistantMessage(f.ctx, { eventId: f.eventId, stage: 'during', message: 'Read my list and star this participant.', requestId: 'multi-step' }));
  assert.ok(response.reply); assert.equal([...f.db.eventStar.iter()].length, 1); assert.equal(round, 3);
});

test('event GPS is removed on disconnect and by server expiration even without browser cleanup', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  module.setEventAvailability(f.tx, { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  module.updateEventLocation(f.tx, { eventId: f.eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  const expiry = [...f.db.eventLocationExpiry.iter()][0];
  assert.ok(expiry);
  const later = { ...f.tx, timestamp: { microsSinceUnixEpoch: f.tx.timestamp.microsSinceUnixEpoch + 121_000_000n } };
  module.expireEventLocation(later, { arg: expiry });
  assert.equal(f.db.eventLocation.locationId.find(`${f.eventId}__${f.owner.toHexString()}`), undefined);
  module.updateEventLocation(f.tx, { eventId: f.eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  module.clientDisconnected(f.tx);
  assert.equal(f.db.eventLocation.locationId.find(`${f.eventId}__${f.owner.toHexString()}`), undefined);
});

test('checkout revokes legacy discovery and activity in another event cannot renew an old check-in', () => {
  const f = networkingFixture();
  module.startNetworkingEvent(f.tx, { eventId: f.eventId });
  module.prepareNetworkingEvent(f.ctx, { eventId: f.eventId });
  module.setNetworkingEventPhase(f.tx, { eventId: f.eventId, phase: 'during' });
  for (const id of f.users.slice(0,2)) module.setEventAvailability(f.forUser(id), { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  module.setEventAvailability(f.tx, { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'offline', discoverable: false });
  assert.equal(f.db.agentPresence.userId.find(f.owner.toHexString()), undefined);
  module.setEventAvailability(f.tx, { eventId: f.eventId, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  f.ctx.newUuidV4 = () => 'second-event';
  const second = JSON.parse(module.createNetworkingEvent(f.ctx, { title: 'Second event', description: '', venue: 'Hall', startAtMs: 1_790_000_000_000n }));
  for (const id of f.users.slice(0,2)) module.joinNetworkingEvent(f.forUser(id), { eventId: second.event_id });
  module.startNetworkingEvent(f.tx, { eventId: second.event_id });
  module.prepareNetworkingEvent(f.ctx, { eventId: second.event_id });
  module.setNetworkingEventPhase(f.tx, { eventId: second.event_id, phase: 'during' });
  const timestamp = { microsSinceUnixEpoch: f.tx.timestamp.microsSinceUnixEpoch + 600_000_000n };
  for (const id of f.users.slice(0,2)) module.setEventAvailability({ ...f.forUser(id), timestamp }, { eventId: second.event_id, zoneId: 'lounge', availabilityStatus: 'free', discoverable: true });
  assert.throws(() => module.requestEventConnection({ ...f.tx, timestamp }, { eventId: f.eventId, targetId: f.users[1].toHexString() }), /presence|expire|checked/);
});

test('cloud configuration stays private and status never returns secret values', () => {
  const { ctx } = cloudFixture();
  const status = module.cloudBackendStatus(ctx, {} as any);
  assert.equal(JSON.stringify(status).includes('fake-asi-key'), false);
  assert.equal(JSON.stringify(status).includes('fake-pinecone-key'), false);
  const config = module.default.moduleDef.tables.find(t => t.sourceName === 'cloudProviderConfig');
  assert.equal(config?.tableAccess.tag, 'Private');
});

test('cloud intake rejects anonymous callers before contacting providers', () => {
  const { ctx, tx, calls } = cloudFixture();
  tx.senderAuth = { jwt: undefined } as any;
  assert.throws(() => module.submitCloudIntroduction(ctx, { message: 'hello', resumeText: '', filename: '' }), /Sign in/);
  assert.equal(calls.length, 0);
});

test('cloud intake calls both real interfaces and retains canonical map fields', () => {
  const { ctx, db, owner, calls } = cloudFixture();
  const profile = JSON.parse(module.submitCloudIntroduction(ctx, { message: 'I build Python maps.', resumeText: '', filename: '' }));
  assert.equal(profile.name, 'Map Name');
  assert.equal(profile.headline, 'Map Headline');
  assert.deepEqual(profile.interests, ['Python', 'Maps']);
  assert.deepEqual(profile.skills, ['Python']);
  assert.equal(profile.embedding.length, 1024);
  assert.equal(JSON.parse(db.userProfile.identity.find(owner).agentProfileJson).introduction, 'I build Python maps.');
  assert.ok(calls.some(c => c.url.endsWith('/vectors/upsert')));
});

test('cloud ASI failures preserve previous canonical profile', () => {
  const { ctx, db, owner } = cloudFixture();
  db.userProfile.identity.update({ ...db.userProfile.identity.find(owner), agentProfileJson: '{"skills":["old skill"]}' });
  ctx.http.fetch = () => ({ ok: false, status: 401 });
  assert.throws(() => module.submitCloudIntroduction(ctx, { message: 'new facts', resumeText: '', filename: '' }), /ASI.*401/);
  assert.deepEqual(JSON.parse(db.userProfile.identity.find(owner).agentProfileJson).skills, ['old skill']);
});

test('cloud Pinecone failures preserve saved profile and expose pending index state', () => {
  const { ctx, db, owner } = cloudFixture();
  const fetch = ctx.http.fetch;
  ctx.http.fetch = (url: string, options: any) => url.endsWith('/embed') ? { ok: false, status: 503 } : fetch(url, options);
  const profile = JSON.parse(module.submitCloudIntroduction(ctx, { message: 'Python maps', resumeText: '', filename: '' }));
  assert.deepEqual(profile.skills, ['Python']);
  assert.equal(profile.embedding, null);
  assert.equal(profile.vector_status, 'pending');
  assert.ok(db.userProfile.identity.find(owner).agentProfileJson);
});

test('cloud intake refuses overlapping submissions and stale deleted-account results', () => {
  const { ctx, db, owner } = cloudFixture();
  db.cloudOperation.insert({ userId: owner.toHexString(), operationId: 'busy', startedAtMs: 1_790_000_000_000n });
  assert.throws(() => module.submitCloudIntroduction(ctx, { message: 'maps', resumeText: '', filename: '' }), /already|progress/);
  db.cloudOperation.userId.delete(owner.toHexString());
  const fetch = ctx.http.fetch;
  ctx.http.fetch = (url: string, options: any) => {
    const result = fetch(url, options);
    if (url.includes('chat/completions')) db.userProfile.identity.delete(owner);
    return result;
  };
  assert.throws(() => module.submitCloudIntroduction(ctx, { message: 'maps', resumeText: '', filename: '' }), /deleted|changed/);
  assert.equal(db.agentProfile.userId.find(owner.toHexString()), undefined);
});

test('cloud provider probe requires an explicitly provisioned administrator', () => {
  const { ctx, calls } = cloudFixture();
  assert.throws(() => module.verifyCloudProviders(ctx, {} as any), /administrator/);
  assert.equal(calls.length, 0);
});

test('cloud event recommendations retain unindexed catalog events', () => {
  const { ctx, db, tx } = cloudFixture();
  db.userProfile.identity.update({ ...db.userProfile.identity.find(tx.sender), agentProfileJson: '{"goals":["internship"],"skills":["Python"],"embedding":null}' });
  db.agentEvent = table('eventId');
  const start = new Date(Number(tx.timestamp.microsSinceUnixEpoch / 1000n)).toISOString();
  const end = new Date(Number(tx.timestamp.microsSinceUnixEpoch / 1000n) + 3600000).toISOString();
  db.agentEvent.insert({ eventId: 'career', agentScope: 'agent', payloadJson: JSON.stringify({ event_id: 'career', title: 'Career fair', host_role: 'recruiter', topics: ['Python'], offerings: ['internships'], start, end, embedding: null }) });
  assert.equal(JSON.parse(module.getCloudEventRecommendations(ctx, { topN: 5 })).length, 1);
});

test('cloud matching excludes demo pins, opted-out and stale participants', () => {
  const { ctx, tx, db, owner, peer } = cloudFixture();
  db.userProfile.identity.update({ ...db.userProfile.identity.find(owner), agentProfileJson: '{"goals":["internship"],"skills":["Python"]}' });
  module.setCloudPresence(tx, { zoneId: 'main-hall', discoverable: true, availabilityStatus: 'free' });
  db.userProfile.insert({ identity: peer, displayName: 'Peer', headline: '', interests: '', agentProfileJson: '{"role":"recruiter","skills":["Python"],"offerings":["internship"],"seniority":4}' });
  db.agentUserLink.insert({ userId: peer.toHexString(), authSubject: 'clerk-b', ownerIdentity: peer, agentScope: 'agent' });
  const peerTx = { ...tx, sender: peer, senderAuth: { jwt: { ...tx.senderAuth.jwt, subject: 'clerk-b' } } };
  module.setCloudPresence(peerTx, { zoneId: 'main-hall', discoverable: false, availabilityStatus: 'free' });
  assert.deepEqual(JSON.parse(module.getCloudOpportunities(ctx, {} as any)), []);
  module.setCloudPresence(peerTx, { zoneId: 'main-hall', discoverable: true, availabilityStatus: 'free' });
  const cards = JSON.parse(module.getCloudOpportunities(ctx, {} as any));
  assert.equal(cards.length, 1); assert.equal(cards[0].target_id, peer.toHexString());
  assert.equal('goals' in cards[0], false);
  db.agentPresence.userId.update({ ...db.agentPresence.userId.find(peer.toHexString()), updatedAt: { microsSinceUnixEpoch: 1n } });
  assert.deepEqual(JSON.parse(module.getCloudOpportunities(ctx, {} as any)), []);
  assert.equal(db.agentPresence.userId.find(owner.toHexString()).discoverable, true);
});

test('cloud connection responses are restricted to the target and followups require acceptance', () => {
  const { ctx, tx, db, peer } = cloudFixture();
  db.agentInteraction.insert({ interactionId: 'cloud-i', userId: tx.sender.toHexString(), targetId: peer.toHexString(), status: 'requested',
    recordingConsentJson: '{}', payloadJson: JSON.stringify({ interaction_id: 'cloud-i', user_id: tx.sender.toHexString(), target_id: peer.toHexString(), status: 'requested' }), agentScope: 'agent' });
  assert.throws(() => module.respondCloudConnection(tx, { interactionId: 'cloud-i', accept: true }), /target/);
  assert.throws(() => module.draftCloudFollowup(ctx, { interactionId: 'cloud-i' }), /accepted/);
});

test('cloud account deletion refuses active indexing and removes the Pinecone vector first', () => {
  const { ctx, tx, db, calls } = cloudFixture();
  module.submitCloudIntroduction(ctx, { message: 'Python maps', resumeText: '', filename: '' });
  const id = tx.sender.toHexString();
  db.cloudOperation.insert({ userId: id, operationId: 'busy', startedAtMs: BigInt(Number(tx.timestamp.microsSinceUnixEpoch / 1000n)) });
  assert.throws(() => module.deleteCloudAccount(ctx, {} as any), /progress/);
  db.cloudOperation.userId.delete(id);
  module.deleteCloudAccount(ctx, {} as any);
  assert.ok(calls.some(c => c.url.endsWith('/vectors/delete')));
  assert.equal(db.userProfile.identity.find(tx.sender), undefined);
  assert.equal(db.agentProfile.userId.find(id), undefined);
});

test('cloud deletion also removes a map account whose intake never created an agent link', () => {
  const { ctx, tx, db } = cloudFixture();
  const id = tx.sender.toHexString();
  db.participantOwner.insert({ participantId: id, ownerIdentity: tx.sender });
  db.presence.insert({ participantId: id, zoneId: 'main-hall' });
  db.liveLocation.insert({ participantId: id, latitude: 1, longitude: 2 });
  assert.equal(db.agentUserLink.userId.find(id), undefined);
  module.deleteCloudAccount(ctx, {} as any);
  assert.equal(db.userProfile.identity.find(tx.sender), undefined);
  assert.equal(db.agentAuthSubject.ownerIdentity.find(tx.sender), undefined);
  assert.equal(db.liveLocation.participantId.find(id), undefined);
  assert.equal(db.presence.participantId.find(id), undefined);
});

test('cloud followup drafts stay private and approval never claims unconfigured delivery', () => {
  const { ctx, tx, db, peer } = cloudFixture();
  module.submitCloudIntroduction(ctx, { message: 'Python maps', resumeText: '', filename: '' });
  db.userProfile.insert({ identity: peer, displayName: 'Peer', headline: '', interests: '', agentProfileJson: '{"user_id":"peer","followup_prefs":{"allowed_channels":["email"]}}' });
  db.agentUserLink.insert({ userId: 'peer', authSubject: 'clerk-b', ownerIdentity: peer, agentScope: 'agent' });
  db.agentInteraction.insert({ interactionId: 'accepted-i', userId: tx.sender.toHexString(), targetId: 'peer', status: 'accepted',
    reason: 'Shared skills', roiScoreAtMatch: 61, payloadJson: '{}', agentScope: 'agent' });
  ctx.http.fetch = () => ({ ok: true, status: 200, json: () => ({ choices: [{ message: { content: '{"draft_a":"My draft","draft_b":"Peer private draft","rationale":"Shared skills"}' } }] }) });
  const result = JSON.parse(module.draftCloudFollowup(ctx, { interactionId: 'accepted-i' }));
  assert.equal(result.draft, 'My draft');
  assert.equal(JSON.stringify(result).includes('Peer private draft'), false);
  module.approveCloudFollowup(tx, { planId: result.plan_id });
  const plan = JSON.parse(db.agentFollowUpPlan.planId.find(result.plan_id).payloadJson);
  assert.equal(plan.send_status[tx.sender.toHexString()], 'approved; delivery_provider_not_connected');
  const history = db.agentRoiHistoryTable.entryId.find(`${tx.sender.toHexString()}__accepted-i`);
  assert.ok(history);
  module.recordCloudOutcome(tx, { planId: result.plan_id, outcome: 'Helpful conversation' });
  assert.equal(JSON.parse(db.agentRoiHistoryTable.entryId.find(history.entryId).payloadJson).outcome, 'Helpful conversation');
});

test('cloud followups do not persist a channel revoked during model drafting', () => {
  const { ctx, tx, db, peer } = cloudFixture();
  module.submitCloudIntroduction(ctx, { message: 'Python maps', resumeText: '', filename: '' });
  db.userProfile.insert({ identity: peer, displayName: 'Peer', headline: '', interests: '', agentProfileJson: '{"user_id":"peer","followup_prefs":{"allowed_channels":["email"]}}' });
  db.agentUserLink.insert({ userId: 'peer', authSubject: 'clerk-b', ownerIdentity: peer, agentScope: 'agent' });
  db.agentInteraction.insert({ interactionId: 'accepted-i', userId: tx.sender.toHexString(), targetId: 'peer', status: 'accepted',
    reason: '', roiScoreAtMatch: 50, payloadJson: '{}', agentScope: 'agent' });
  ctx.http.fetch = () => {
    db.userProfile.identity.update({ ...db.userProfile.identity.find(peer), agentProfileJson: '{"user_id":"peer","followup_prefs":{"allowed_channels":[]}}' });
    return { ok: true, status: 200, json: () => ({ choices: [{ message: { content: '{"draft_a":"Draft","draft_b":"Other","rationale":"Match"}' } }] }) };
  };
  assert.throws(() => module.draftCloudFollowup(ctx, { interactionId: 'accepted-i' }), /preferences|changed/);
  assert.equal([...db.agentFollowUpPlan.iter()].length, 0);
});

test('verified legacy mapping preserves the imported key across identity resolution', () => {
  const { db, ctx } = fixture();
  db.agentProfile.insert({ userId: 'legacy-a', payloadJson: '{"user_id":"legacy-a","skills":["Python"]}', agentScope: 'agent' });
  module.linkAgentUser(ctx, { authSubject: 'clerk-a', legacyUserId: 'legacy-a' } as any);
  module.linkAgentUser(ctx, { authSubject: 'clerk-a' } as any);
  assert.equal(db.agentUserLink.authSubject.find('clerk-a').userId, 'legacy-a');
  assert.equal(db.agentProfile.userId.find('legacy-a')?.userId, 'legacy-a');
});

test('identity resolution preserves an existing verified legacy mapping', () => {
  const { db, ctx, link } = fixture();
  link('legacy-a');
  module.linkAgentUser(ctx, { authSubject: 'clerk-a' } as any);
  assert.equal(db.agentUserLink.authSubject.find('clerk-a').userId, 'legacy-a');
});

test('an empty default identity link can migrate without losing its messaging binding', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  db.agentUserLink.userId.update({ ...db.agentUserLink.userId.find(owner.toHexString()), messagingIdentity: 'agent-alice' });
  db.agentProfile.insert({ userId: 'legacy-a', payloadJson: '{"user_id":"legacy-a"}', agentScope: 'agent' });
  module.linkAgentUser(ctx, { authSubject: 'clerk-a', legacyUserId: 'legacy-a' } as any);
  assert.equal(db.agentUserLink.userId.find(owner.toHexString()), undefined);
  assert.equal(db.agentUserLink.userId.find('legacy-a').messagingIdentity, 'agent-alice');
});

test('legacy migration cannot hide data already written under the default identity', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  db.agentProfile.insert({ userId: owner.toHexString(), payloadJson: '{"goals":["Existing goal"]}', agentScope: 'agent' });
  db.agentProfile.insert({ userId: 'legacy-a', payloadJson: '{"user_id":"legacy-a"}', agentScope: 'agent' });
  assert.throws(() => module.linkAgentUser(ctx, { authSubject: 'clerk-a', legacyUserId: 'legacy-a' } as any), /has data/);
  assert.equal(db.agentUserLink.authSubject.find('clerk-a').userId, owner.toHexString());
});

test('a service cannot reassign a legacy account that already has a verified owner', () => {
  const { db, ctx, peer } = fixture();
  db.agentProfile.insert({ userId: 'legacy-b', payloadJson: '{"user_id":"legacy-b"}', agentScope: 'agent' });
  db.agentUserLink.insert({ userId: 'legacy-b', authSubject: 'clerk-b', ownerIdentity: peer, agentScope: 'agent' });
  assert.throws(() => module.linkAgentUser(ctx, { authSubject: 'clerk-a', legacyUserId: 'legacy-b' } as any), /another verified owner/);
  assert.equal(db.agentUserLink.userId.find('legacy-b').authSubject, 'clerk-b');
});

test('legacy migration preserves an orphan peer ROI reference to the current identity', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  db.agentProfile.insert({ userId: 'legacy-a', payloadJson: '{"user_id":"legacy-a"}', agentScope: 'agent' });
  db.agentRoiHistoryTable.insert({ entryId: 'orphan-peer-roi', userId: 'bob', interactionId: 'missing', payloadJson: JSON.stringify({ target_id: owner.toHexString() }), agentScope: 'agent' });
  assert.throws(() => module.linkAgentUser(ctx, { authSubject: 'clerk-a', legacyUserId: 'legacy-a' } as any), /has data/);
  assert.equal(db.agentUserLink.authSubject.find('clerk-a').userId, owner.toHexString());
  module.deleteMyAgentData(ctx, { userId: owner.toHexString() });
  assert.equal(db.agentRoiHistoryTable.entryId.find('orphan-peer-roi'), undefined);
});

test('participants cannot invoke service writes or read the service profile view', () => {
  const { db, ctx, owner } = fixture();
  db.agentProfile.insert({ userId: 'legacy-a', payloadJson: '{"skills":["Private skill"]}', agentScope: 'agent' });
  assert.throws(() => module.linkAgentUser({ ...ctx, sender: owner }, { authSubject: 'clerk-a', legacyUserId: 'legacy-a' } as any), /reserved/);
  assert.deepEqual(module.agentProfiles({ ...ctx, sender: owner }), []);
});

test('ordinary ASI requests cannot roll back a freshly saved map profile', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  db.agentProfile.insert({ userId: owner.toHexString(), payloadJson: '{"user_id":"unused","name":"Old Name","headline":"Old Headline","interests":["Old Topic"],"goals":["Meet people"]}', agentScope: 'agent' });
  module.saveMyProfile({ ...ctx, sender: owner, senderAuth: { jwt: { issuer: 'https://novel-griffon-9073.clerk.accounts.dev', audience: ['mhacks-live-map'], subject: 'clerk-a' } } }, { displayName: 'Fresh Name', headline: 'Fresh Headline', interests: 'Python, Maps', showOnMap: false });
  module.linkAgentUser(ctx, { authSubject: 'clerk-a' } as any);
  const profile = db.userProfile.identity.find(owner);
  assert.equal(profile.displayName, 'Fresh Name');
  const agent = JSON.parse(module.agentProfiles(ctx)[0].payloadJson);
  assert.equal(agent.name, 'Fresh Name');
  assert.deepEqual(agent.interests, ['Python', 'Maps']);
  assert.deepEqual(agent.goals, ['Meet people']);
});

test('saving ASI preferences preserves canonical map fields and returns them on reads', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  module.putAgentProfile(ctx, { userId: owner.toHexString(), payloadJson: JSON.stringify({ user_id: owner.toHexString(), name: 'Stale Name', headline: 'Stale Headline', interests: ['Stale'], goals: ['New goal'] }) });
  assert.equal(db.userProfile.identity.find(owner).displayName, 'Map Name');
  assert.equal(JSON.parse(module.agentProfiles(ctx)[0].payloadJson).name, 'Map Name');
  assert.deepEqual(JSON.parse(module.agentProfiles(ctx)[0].payloadJson).goals, ['New goal']);
});

test('empty map fields retain private extracted facts without publishing them', () => {
  const { db, ctx, owner, link } = fixture();
  link();
  db.userProfile.identity.update({ ...db.userProfile.identity.find(owner), headline: '', interests: '' });
  module.putAgentProfile(ctx, { userId: owner.toHexString(), payloadJson: JSON.stringify({ user_id: owner.toHexString(), name: 'Resume name', headline: 'Robot builder', interests: ['Robotics'], skills: ['Python'] }) });
  const privateProfile = JSON.parse(module.agentProfiles(ctx)[0].payloadJson);
  assert.equal(privateProfile.name, 'Map Name');
  assert.equal(privateProfile.headline, 'Robot builder');
  assert.deepEqual(privateProfile.interests, ['Robotics']);
  const mapProfile = db.userProfile.identity.find(owner);
  assert.equal(mapProfile.headline, '');
  assert.equal(mapProfile.interests, '');
  assert.equal(mapProfile.showOnMap, false);
});

test('deleting an interaction removes its plans, transcripts and both participants ROI', () => {
  const { db, ctx, seedRelated } = fixture();
  seedRelated();
  module.deleteAgentRecord(ctx, { collection: 'interactions', key: 'i-ab' });
  assert.equal(db.agentInteraction.interactionId.find('i-ab'), undefined);
  assert.equal(db.agentTranscript.interactionId.find('i-ab'), undefined);
  assert.equal(db.agentFollowUpPlan.planId.find('p-ab'), undefined);
  assert.equal(db.agentRoiHistoryTable.entryId.find('r-b'), undefined);
  assert.ok(db.agentProfile.userId.find('bob'));
});

test('account deletion also cleans orphan plans, transcripts and peer ROI', () => {
  const { db, ctx, link, seedRelated } = fixture();
  link('alice'); seedRelated();
  db.agentInteraction.interactionId.delete('i-ab');
  module.deleteMyAgentData(ctx, { userId: 'alice' });
  assert.equal(db.agentFollowUpPlan.planId.find('p-ab'), undefined);
  assert.equal(db.agentTranscript.interactionId.find('i-ab'), undefined);
  assert.equal(db.agentRoiHistoryTable.entryId.find('r-b'), undefined);
  assert.ok(db.agentProfile.userId.find('bob'));
});

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
    senderAuth: { jwt: { issuer: 'https://novel-griffon-9073.clerk.accounts.dev', audience: ['mhacks-live-map'], subject: 'clerk-a' } } };
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

// Actual SpacetimeDB + SDK integration. Provider responses are synthetic and
// isolated; production cloud credentials and user profiles are never read.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, writeFile, symlink, rm, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '../../../map/src/module_bindings/index.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = process.env.SPACETIME_CLI ?? 'spacetime';
const standalone = process.env.SPACETIME_STANDALONE ?? 'spacetimedb-standalone';
const runtimeRoot = join(repo, 'map/.test-runtime/networking-integration');
const runDir = join(runtimeRoot, randomUUID()), moduleDir = join(runDir, 'module');
const dbName = `network-test-${randomUUID().slice(0, 8)}`;
const configPath = join(runDir, 'cli.toml');
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const connections: DbConnection[] = [];
let dbProcess: ReturnType<typeof spawn> | undefined;
const dbLogs: string[] = [];
const listen = (server: ReturnType<typeof createServer>) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const end = Date.now() + 30000;
  do { try { if (await check()) return; } catch {} await pause(); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
const cliArgs = ['--root-dir', join(runDir, 'cli'), '--config-path', configPath];
function sql(query: string, server: string) { return execFileSync(cli, [...cliArgs, 'sql', dbName, query, '--server', server], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
async function connect(uri: string, token: string) {
  return new Promise<DbConnection>((resolve, reject) => DbConnection.builder().withUri(uri).withDatabaseName(dbName).withToken(token)
    .onConnect(conn => { connections.push(conn); resolve(conn); }).onConnectError((_, error) => reject(error)).build());
}
async function subscribe(conn: DbConnection) {
  await new Promise<void>((resolve, reject) => conn.subscriptionBuilder().onApplied(() => resolve()).onError(ctx => reject(ctx.event)).subscribe([
    'SELECT * FROM networking_invitations', 'SELECT * FROM my_networking_memberships', 'SELECT * FROM my_assistant_messages',
    'SELECT * FROM my_assistant_notifications', 'SELECT * FROM my_event_map_pins', 'SELECT * FROM my_agent_interactions', 'SELECT * FROM my_agent_follow_up_plans',
    'SELECT * FROM my_agent_exchanges', 'SELECT * FROM my_event_contacts',
  ]));
}
try {
  await mkdir(join(moduleDir, 'src'), { recursive: true });
  await writeFile(join(runDir, 'public.pem'), keys.publicKey); await writeFile(join(runDir, 'private.pem'), keys.privateKey);
  const free = createServer(), dbPort = await listen(free); await new Promise<void>(resolve => free.close(() => resolve()));
  const server = `http://127.0.0.1:${dbPort}`;
  dbProcess = spawn(standalone, ['start', '--listen-addr', `127.0.0.1:${dbPort}`, '--data-dir', join(runDir, 'database'),
    '--jwt-pub-key-path', join(runDir, 'public.pem'), '--jwt-priv-key-path', join(runDir, 'private.pem'), '--in-memory', '--non-interactive'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  dbProcess.stdout?.on('data', data => dbLogs.push(String(data))); dbProcess.stderr?.on('data', data => dbLogs.push(String(data)));
  await until(async () => (await fetch(`${server}/v1/ping`)).ok, 'database startup');
  // First get this isolated server's local issuer. Nothing is printed or used
  // on Maincloud; the temporary module trusts this local test issuer only.
  const { token: localToken } = await (await fetch(`${server}/v1/identity`, { method: 'POST' })).json() as { token: string };
  await writeFile(configPath, `spacetimedb_token = "${localToken}"\n`);
  const issuer = JSON.parse(Buffer.from(localToken.split('.')[1], 'base64url').toString()).iss;
  let source = (await readFile(join(repo, 'map/spacetimedb/src/index.ts'), 'utf8')).replaceAll('\r\n', '\n');
  source = source.replace("const CLERK_ISSUER = 'https://novel-griffon-9073.clerk.accounts.dev';", `const CLERK_ISSUER = ${JSON.stringify(issuer)};`);
  // The native HTTP client intentionally blocks loopback/private hosts. Inject
  // only the provider adapter into this temporary module. Production HTTP is
  // verified separately by the Maincloud provider probe and website smoke test.
  const adapterStart = source.indexOf('function providerJson('), adapterEnd = source.indexOf('function asiComplete(', adapterStart);
  source = source.slice(0, adapterStart) + `function providerJson(ctx: CloudContext, url: string, body: any, _headers: Record<string,string>, _label: string): any {
    return ctx.withTx(tx => {
      const row = tx.db.cloudProviderConfig.name.find('test_provider_counts');
      const counts = row ? JSON.parse(row.value) : { asi: 0, vectors: 0, query: 0 };
      let result: any = {};
      if (url.includes('chat/completions')) { counts.asi++; result = { choices: [{ message: { content: body.messages[0].content.includes('Write two short') ? '{"draft_a":"Great meeting you.","draft_b":"Thanks for connecting.","rationale":"Shared Python interests","suggested_timing":"Tomorrow"}' : 'I am your personal event assistant.' } }] }; }
      if (url.includes('vectors/upsert')) counts.vectors += body.vectors.length;
      if (url.endsWith('/query')) counts.query++;
      const stored = { name: 'test_provider_counts', value: JSON.stringify(counts) };
      if (row) tx.db.cloudProviderConfig.name.update(stored); else tx.db.cloudProviderConfig.insert(stored);
      return result;
    });
  }\n\n` + source.slice(adapterEnd);
  source += `\nexport const seedNetworkingTestUser = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
    const id = ctx.sender.toHexString();
    const profile = { user_id: id, name, role: 'engineer', skills: ['Python'], interests: ['maps'], goals: ['meet engineers'], offerings: ['mentoring'], seniority: 2, free_windows: [], embedding: Array(1024).fill(.1), followup_prefs: { allowed_channels: ['email'] } };
    ctx.db.userProfile.insert({ identity: ctx.sender, displayName: name, headline: 'Engineer', interests: 'Maps', showOnMap: false, updatedAt: ctx.timestamp, agentProfileJson: JSON.stringify(profile) });
    ctx.db.agentUserLink.insert({ userId: id, authSubject: ctx.senderAuth.jwt!.subject, ownerIdentity: ctx.sender, messagingIdentity: undefined, createdAt: ctx.timestamp, updatedAt: ctx.timestamp, agentScope: 'agent' });
  });\n`;
  source = "import { Timestamp } from 'spacetimedb';\n" + source;
  source += `\nexport const ageNetworkingTestLocation = spacetimedb.reducer({ eventId: t.string() }, (ctx, { eventId }) => {
    const locationId = eventKey(eventId, ctx.sender.toHexString());
    const location = ctx.db.eventLocation.locationId.find(locationId)!;
    ctx.db.eventLocation.locationId.update({ ...location, updatedAt: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - 121000000n) });
    const expiry = ctx.db.eventLocationExpiry.locationId.find(locationId)!;
    ctx.db.eventLocationExpiry.scheduledId.update({ ...expiry, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 50000n) });
  });\n`;
  await writeFile(join(moduleDir, 'src/index.ts'), source);
  for (const name of ['networking.ts','assistantAgents.ts','mapProfile.ts']) await writeFile(join(moduleDir, 'src', name), await readFile(join(repo, 'map/spacetimedb/src', name)));
  for (const name of ['package.json','tsconfig.json']) await writeFile(join(moduleDir, name), await readFile(join(repo, 'map/spacetimedb', name)));
  await symlink(join(repo, 'map/spacetimedb/node_modules'), join(moduleDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  execFileSync(cli, [...cliArgs, 'publish', dbName, '--server', server, '--module-path', moduleDir, '--yes'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const token = (subject: string) => {
    const head = Buffer.from('{"alg":"ES256","typ":"JWT"}').toString('base64url'), seconds = Math.floor(Date.now()/1000);
    const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: subject, aud: ['mhacks-live-map'], iat: seconds, exp: seconds + 3600 })).toString('base64url');
    const content = `${head}.${payload}`; return `${content}.${sign('SHA256', Buffer.from(content), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const subjects = ['admin','peer','third','outsider'];
  const users = await Promise.all(subjects.map(subject => connect(`ws://127.0.0.1:${dbPort}`, token(subject))));
  const [admin, peer, third, outsider] = users;
  for (let i=0;i<users.length;i++) {
    // Temporary fixture reducer is intentionally absent from generated
    // production bindings, so invoke it through the isolated HTTP API.
    const response = await fetch(`${server}/v1/database/${dbName}/call/seed_networking_test_user`, { method: 'POST', headers: { Authorization: `Bearer ${token(subjects[i])}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['Admin','Peer','Third','Outsider'][i]]) });
    assert.equal(response.ok, true, `Test seed failed: ${response.status}`);
    await subscribe(users[i]);
  }
  sql(`INSERT INTO cloud_admin (identity) VALUES (0x${admin.identity.toHexString()})`, server);
  sql("INSERT INTO cloud_provider_config (name, value) VALUES ('asi_api_key', 'synthetic'), ('pinecone_api_key', 'synthetic'), ('pinecone_host', 'https://synthetic.svc.pinecone.io')", server);
  const event = JSON.parse(await admin.procedures.createNetworkingEvent({ title: 'Synthetic event', description: 'Local integration only', venue: 'Local test venue', startAtMs: BigInt(Date.now()) }));
  const eventId = event.event_id;
  await admin.reducers.joinNetworkingEvent({ eventId }); await peer.reducers.joinNetworkingEvent({ eventId }); await third.reducers.joinNetworkingEvent({ eventId });
  const asi = await connect(`ws://127.0.0.1:${dbPort}`, token('asi-service'));
  sql(`INSERT INTO asi_chat_service (identity) VALUES (0x${asi.identity.toHexString()})`, server);
  const sessionKey = 'a'.repeat(64), peerSession = 'b'.repeat(64);
  const callHosted = async (name: string, args: unknown[]) => {
    const response = await fetch(`${server}/v1/database/${dbName}/call/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token('asi-service')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    assert.equal(response.ok, true, `Hosted ${name} failed: ${response.status}`);
    return JSON.parse(await response.json());
  };
  const code = JSON.parse(await admin.procedures.createAsiLinkCode()).code;
  await assert.rejects(outsider.procedures.redeemAsiLinkCode({ code, sessionKey, requestId: 'link1' }), /dedicated ACP/);
  assert.equal((await callHosted('redeem_asi_link_code', [code, sessionKey, 'link1'])).linked, true);
  assert.equal((await callHosted('redeem_asi_link_code', [code, sessionKey, 'link1'])).linked, true);
  assert.equal(JSON.parse(await admin.procedures.getAsiLinkStatus()).connected, true);
  assert.equal(JSON.parse(await peer.procedures.getAsiLinkStatus()).connected, false);
  assert.equal(JSON.parse(await asi.procedures.getAsiChatContext({ sessionKey })).profile.name, 'Admin');
  assert.equal((await callHosted('get_asi_chat_context', [sessionKey])).profile.name, 'Admin');
  await assert.rejects(asi.procedures.getAsiChatContext({ sessionKey: peerSession }), /authorization/);
  const preTurn = await callHosted('send_asi_assistant_message', [sessionKey, eventId, 'Explain your role.', 'asi_pre1']); assert.ok(preTurn.reply);
  assert.equal((await callHosted('send_asi_assistant_message', [sessionKey, eventId, 'Explain your role.', 'asi_pre1'])).reply, preTurn.reply);
  await assert.rejects(outsider.reducers.startNetworkingEvent({ eventId }), /administrator/);
  await admin.reducers.startNetworkingEvent({ eventId });
  await assert.rejects(outsider.reducers.joinNetworkingEvent({ eventId }), /closed|started/);
  const prepared = JSON.parse(await admin.procedures.prepareNetworkingEvent({ eventId })); assert.equal(prepared.matching_status, 'ready');
  const matches = JSON.parse(await admin.procedures.getEventInterestList({ eventId, offset: 0, limit: 5 })); assert.equal(matches.total, 2);
  await assert.rejects(outsider.procedures.getEventInterestList({ eventId, offset: 0, limit: 5 }), /member|join/);
  await assert.rejects(outsider.reducers.setNetworkingEventPhase({ eventId, phase: 'during' }), /administrator/);
  await admin.reducers.setNetworkingEventPhase({ eventId, phase: 'during' });
  assert.match((await callHosted('send_asi_assistant_message', [sessionKey, eventId, 'Find people here.', 'asi_during1'])).reply, /website|GPS/i);
  await admin.reducers.updateEventLocation({ eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  await peer.reducers.updateEventLocation({ eventId, latitude: 42.2902, longitude: -83.71, accuracyMeters: 5 });
  await third.reducers.updateEventLocation({ eventId, latitude: 42.2903, longitude: -83.71, accuracyMeters: 5 });
  await until(() => Array.from(admin.db.myAssistantNotifications.iter()).some(row => row.kind === 'nearby'), 'nearby notification');
  assert.equal(Array.from(outsider.db.myEventMapPins.iter()).length, 0); assert.equal(Array.from(outsider.db.myAssistantNotifications.iter()).length, 0);
  await admin.reducers.requestEventConnection({ eventId, targetId: peer.identity.toHexString() });
  await peer.reducers.setEventContact({ eventId, linkedinUrl: 'https://www.linkedin.com/in/synthetic-peer', share: true });
  assert.equal(Array.from(admin.db.myEventContacts.iter()).length, 0, 'pending connection cannot read shared contact');
  await until(() => Array.from(peer.db.myAgentInteractions.iter()).length === 1, 'connection request');
  const request = Array.from(peer.db.myAgentInteractions.iter())[0];
  assert.equal(request.roiScoreAtMatch, matches.items.find((row: any) => row.target_id === peer.identity.toHexString()).roi_score);
  await peer.reducers.requestEventConnection({ eventId, targetId: admin.identity.toHexString() });
  assert.equal(Array.from(peer.db.myAgentInteractions.iter()).length, 1, 'reverse duplicate request');
  await third.reducers.requestEventConnection({ eventId, targetId: peer.identity.toHexString() });
  await until(() => Array.from(peer.db.myAgentInteractions.iter()).length === 2, 'third participant pending request');
  const other = Array.from(peer.db.myAgentInteractions.iter()).find(row => row.userId.toString() === third.identity.toHexString())!;
  await assert.rejects(admin.reducers.respondEventConnection({ eventId, interactionId: request.interactionId, accept: true }), /target/);
  await peer.reducers.respondEventConnection({ eventId, interactionId: request.interactionId, accept: true });
  await until(() => Array.from(admin.db.myNetworkingMemberships.iter()).some(row => row.eventId === eventId && row.availabilityStatus === 'busy'), 'automatic busy state');
  await assert.rejects(peer.reducers.respondEventConnection({ eventId, interactionId: other.interactionId, accept: true }), /busy|chat/);
  await admin.reducers.finishEventConnection({ eventId, interactionId: request.interactionId });
  await until(() => Array.from(peer.db.myNetworkingMemberships.iter()).some(row => row.eventId === eventId && row.availabilityStatus === 'free'), 'free after End chat');
  await until(() => Array.from(third.db.myAssistantNotifications.iter()).some(row => row.kind === 'nearby' && row.targetId === admin.identity.toHexString()), 'third participant notified after chat');
  const manualRequests: string[] = [];
  for (const stage of ['pre','during','post']) {
    await admin.reducers.setNetworkingEventPhase({ eventId, phase: stage });
    const requestId = randomUUID(); manualRequests.push(requestId);
    const response = JSON.parse(await admin.procedures.sendAssistantMessage({ eventId, stage, message: 'Explain your role without changing anything.', requestId })); assert.ok(response.reply);
  }
  await until(() => Array.from(admin.db.myAssistantMessages.iter()).filter(row => manualRequests.some(id => row.messageId.includes(id))).length === 6, 'private chat history');
  assert.equal(Array.from(peer.db.myAssistantMessages.iter()).some(row => manualRequests.some(id => row.messageId.includes(id))), false);
  const historicalRequest = { eventId, stage: 'pre', message: 'Explain my saved Pre preparation again.', requestId: randomUUID() };
  const historicalReply = JSON.parse(await admin.procedures.sendAssistantMessage(historicalRequest));
  assert.ok(historicalReply.reply);
  assert.equal(JSON.parse(await admin.procedures.sendAssistantMessage(historicalRequest)).reply, historicalReply.reply);
  await until(() => Array.from(admin.db.myAssistantMessages.iter()).filter(row => row.messageId.includes(historicalRequest.requestId)).length === 2, 'historical Pre chat during Post');
  assert.equal(Array.from(peer.db.myAssistantMessages.iter()).some(row => row.messageId.includes(historicalRequest.requestId)), false);
  await assert.rejects(outsider.procedures.sendAssistantMessage({ ...historicalRequest, requestId: randomUUID() }), /member|join/);
  const recap = JSON.parse(await admin.procedures.generateEventRecap({ eventId })); assert.ok(recap.reply);
  await until(() => Array.from(admin.db.myAgentExchanges.iter()).length === 2, 'Post asks Pre and During');
  assert.deepEqual(Array.from(admin.db.myAgentExchanges.iter()).map(row => row.toAgent).sort(), ['during','pre']);
  assert.equal(Array.from(peer.db.myAgentExchanges.iter()).length, 0); assert.equal(Array.from(outsider.db.myAgentExchanges.iter()).length, 0);
  assert.equal(JSON.parse(await admin.procedures.generateEventRecap({ eventId })).reply, recap.reply);
  const asiRecap = await callHosted('generate_asi_event_recap', [sessionKey, eventId, 'asi_recap1']); assert.ok(asiRecap.reply);
  assert.equal((await callHosted('generate_asi_event_recap', [sessionKey, eventId, 'asi_recap1'])).reply, asiRecap.reply);
  await admin.reducers.revokeAsiChatGrant();
  await assert.rejects(asi.procedures.getAsiChatContext({ sessionKey }), /authorization/);
  const replacementCode = JSON.parse(await admin.procedures.createAsiLinkCode()).code;
  await asi.procedures.redeemAsiLinkCode({ code: replacementCode, sessionKey: peerSession, requestId: 'link2' });
  await asi.reducers.unlinkAsiChat({ sessionKey: peerSession });
  assert.equal(JSON.parse(await admin.procedures.getAsiLinkStatus()).connected, false);
  await until(() => Array.from(admin.db.myEventContacts.iter()).length === 1, 'accepted contact shared');
  assert.equal(Array.from(third.db.myEventContacts.iter()).length, 0, 'pending third participant cannot read contact');
  await peer.reducers.setEventContact({ eventId, linkedinUrl: 'https://www.linkedin.com/in/synthetic-peer', share: false });
  await until(() => Array.from(admin.db.myEventContacts.iter()).length === 0, 'contact withdrawal');
  const draft = JSON.parse(await admin.procedures.draftCloudFollowup({ interactionId: request.interactionId })); assert.ok(draft.draft);
  await admin.reducers.setNetworkingEventPhase({ eventId, phase: 'during' });
  for (const [index, member] of [admin, peer, third].entries()) await member.reducers.updateEventLocation({ eventId, latitude: 42.29 + index * .0002, longitude: -83.71, accuracyMeters: 5 });
  await admin.reducers.stopEventLocation({ eventId }); await until(() => Array.from(peer.db.myEventMapPins.iter()).length === 2, 'GPS stop');
  await admin.reducers.updateEventLocation({ eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  await until(() => Array.from(peer.db.myEventMapPins.iter()).length === 3, 'GPS restart');
  const aged = await fetch(`${server}/v1/database/${dbName}/call/age_networking_test_location`, { method: 'POST', headers: { Authorization: `Bearer ${token('admin')}`, 'Content-Type': 'application/json' }, body: JSON.stringify([eventId]) });
  assert.equal(aged.ok, true);
  await until(() => Array.from(peer.db.myEventMapPins.iter()).length === 2, 'scheduled GPS expiry');
  await admin.reducers.updateEventLocation({ eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 });
  await until(() => Array.from(admin.db.myEventMapPins.iter()).length === 3, 'GPS before disconnect');
  peer.disconnect();
  await until(() => Array.from(admin.db.myEventMapPins.iter()).length === 2, 'GPS disconnect cleanup');
  await admin.reducers.editNetworkingEvent({ eventId, title: 'Edited synthetic event', description: 'Local only', venue: 'Test hall', startAtMs: BigInt(Date.now()) });
  await admin.reducers.setNetworkingEventPhase({ eventId, phase: 'post' });
  await until(() => Array.from(admin.db.myEventMapPins.iter()).length === 0, 'Post stops GPS discovery');
  await assert.rejects(admin.reducers.updateEventLocation({ eventId, latitude: 42.29, longitude: -83.71, accuracyMeters: 5 }), /During/);
  await assert.rejects(outsider.procedures.deleteNetworkingEvent({ eventId }), /administrator/);
  await admin.procedures.deleteNetworkingEvent({ eventId });
  await until(() => Array.from(admin.db.networkingInvitations.iter()).length === 0 && Array.from(admin.db.myAgentInteractions.iter()).length === 0, 'event deletion cascade');
  const countsResponse = await fetch(`${server}/v1/database/${dbName}/sql`, { method: 'POST', headers: { Authorization: `Bearer ${localToken}`, 'Content-Type': 'text/plain' }, body: "SELECT value FROM cloud_provider_config WHERE name = 'test_provider_counts'" });
  const counts = JSON.parse((await countsResponse.json())[0].rows[0][0]);
  assert.equal(counts.query, 3); assert.equal(counts.vectors, 3); assert.equal(counts.asi, 12);
  console.log(JSON.stringify({ result: 'PASS', runtime: 'actual local SpacetimeDB + SDK', participants: 3, outsider: 1, providers: 'synthetic test adapter', checks: ['admin identity and event phases','frozen roster','cached ROI unchanged in During','member privacy','automatic GPS presence and topics','reverse duplicate request','busy acceptance blocks third person','End chat restores free and notifications','three private agent histories','Post consultations and cached recap','accepted contact sharing and withdrawal','completed follow-up','GPS stop/expiry/disconnect','admin edit/delete cascade'], provider_counts: counts }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error && typeof error === 'object' && 'stderr' in error) console.error(String(error.stderr).slice(-5000));
  if (error && typeof error === 'object' && 'stdout' in error) console.error(String(error.stdout).slice(-5000));
  console.error(dbLogs.slice(-5).join('').slice(-3000)); process.exitCode = 1;
} finally {
  for (const conn of connections) conn.disconnect();
  if (dbProcess && dbProcess.exitCode === null) { const done = new Promise<void>(resolve => dbProcess!.once('exit', () => resolve())); dbProcess.kill(); await done; }
  // Check the absolute boundary before recursive removal; unlink the dependency
  // junction first so no repository dependencies are ever traversed.
  if (!resolve(runDir).startsWith(resolve(runtimeRoot) + '\\') && !resolve(runDir).startsWith(resolve(runtimeRoot) + '/')) throw new Error('Unsafe test cleanup target');
  await unlink(join(moduleDir, 'node_modules')).catch(() => {}); await rm(runDir, { recursive: true, force: true });
}

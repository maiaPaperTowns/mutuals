import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '../../../map/src/module_bindings/index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.SPACETIME_CLI ?? 'spacetime';
const standalone = process.env.SPACETIME_STANDALONE ?? 'spacetimedb-standalone';
const python = process.env.TEST_PYTHON ?? join(root, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const runDir = join(root, '.test-runtime', randomUUID());
const moduleDir = join(runDir, 'module');
const database = `asi-test-${randomUUID().slice(0, 8)}`;
const configPath = join(runDir, 'cli.toml');
const gatewayToken = randomUUID();
const children = new Set<ChildProcess>();
const connections = new Set<DbConnection>();
const logs: string[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function start(bin: string, args: string[], env = process.env): ChildProcess {
  const child = spawn(bin, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  child.stdout?.on('data', data => logs.push(String(data)));
  child.stderr?.on('data', data => logs.push(String(data)));
  child.on('error', error => logs.push(error.message));
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    child.once('exit', () => resolve());
    child.kill();
  });
  children.delete(child);
}

async function until(check: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 25_000;
  do {
    try { if (await check()) return; } catch { /* wait for startup/stream propagation */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}\n${logs.slice(-8).join('')}`);
}

async function connect(uri: string, token?: string): Promise<{ conn: DbConnection; identity: string; token: string }> {
  return new Promise((resolve, reject) => {
    DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect((conn, identity, sessionToken) => {
        connections.add(conn);
        resolve({ conn, identity: identity.toHexString(), token: sessionToken });
      }).onConnectError((_, error) => reject(error)).build();
  });
}

async function subscribe(conn: DbConnection, queries: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => conn.subscriptionBuilder()
    .onApplied(() => resolve()).onError(ctx => reject(ctx.event)).subscribe(queries));
}

await mkdir(join(moduleDir, 'src'), { recursive: true });
const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
await writeFile(join(runDir, 'jwt-public.pem'), keys.publicKey);
await writeFile(join(runDir, 'jwt-private.pem'), keys.privateKey);
const productionSource = await readFile(join(root, '../../map/spacetimedb/src/index.ts'), 'utf8');
// Test fixtures are compiled only into this temporary local module. The real
// production handlers above are unchanged; no fixture reducer ships in map/.
await writeFile(join(moduleDir, 'src/index.ts'), productionSource + `
export const testSeedUser = spacetimedb.reducer({ subject: t.string(), name: t.string() }, (ctx, { subject, name }) => {
  ctx.db.userProfile.insert({ identity: ctx.sender, displayName: name, headline: 'Engineer', interests: 'Python, Maps', showOnMap: false, updatedAt: ctx.timestamp, agentProfileJson: undefined });
  ctx.db.agentAuthSubject.insert({ subject, ownerIdentity: ctx.sender });
});
`);
for (const name of ['networking.ts', 'assistantAgents.ts']) {
  await writeFile(join(moduleDir, 'src', name), await readFile(join(root, '../../map/spacetimedb/src', name)));
}
await writeFile(join(moduleDir, 'package.json'), await readFile(join(root, '../../map/spacetimedb/package.json')));
await writeFile(join(moduleDir, 'tsconfig.json'), await readFile(join(root, '../../map/spacetimedb/tsconfig.json')));
await symlink(resolve(root, '../../map/spacetimedb/node_modules'), join(moduleDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
const dbPort = await freePort();
const serverUrl = `http://127.0.0.1:${dbPort}`;
const uri = `ws://127.0.0.1:${dbPort}`;
const gatewayPort = await freePort();
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const startDatabase = () => start(standalone, ['start', '--listen-addr', `127.0.0.1:${dbPort}`, '--data-dir', join(runDir, 'database'), '--jwt-pub-key-path', join(runDir, 'jwt-public.pem'), '--jwt-priv-key-path', join(runDir, 'jwt-private.pem'), '--non-interactive']);
const cliArgs = ['--root-dir', join(runDir, 'cli'), '--config-path', configPath];
const sql = (query: string) => execFileSync(cli, [...cliArgs, 'sql', '--server', serverUrl, '--no-config', '--confirmed', 'true', database, query], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let dbProcess: ChildProcess;
let gatewayProcess: ChildProcess;

try {
  dbProcess = startDatabase();
  await until(async () => (await fetch(`${serverUrl}/v1/ping`)).ok, 'local database startup');
  const publish = execFileSync(cli, [...cliArgs, 'publish', database, '--server', serverUrl, '--module-path', moduleDir, '--no-config', '--yes=skip-login'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const ownerIdentity = /Logged in with identity ([a-f0-9]{64})/.exec(publish)?.[1];
  const serviceToken = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(await readFile(configPath, 'utf8'))?.[1];
  assert.ok(ownerIdentity && serviceToken, 'the test publisher must have a local identity');
  sql(`INSERT INTO agent_service (identity) VALUES (0x${ownerIdentity})`);
  const gatewayEnv = { ...process.env, SPACETIMEDB_URI: uri, SPACETIMEDB_DATABASE: database, SPACETIMEDB_SERVICE_TOKEN: serviceToken, SPACETIME_GATEWAY_TOKEN: gatewayToken, SPACETIME_GATEWAY_PORT: String(gatewayPort), SPACETIME_GATEWAY_HOST: '127.0.0.1' };
  const startGateway = () => start(process.execPath, ['--import', 'tsx', 'src/server.ts'], gatewayEnv);
  gatewayProcess = startGateway();
  const response = (path: string, method = 'GET', value?: unknown, token = gatewayToken) => fetch(`${gatewayUrl}/api${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value),
  });
  const request = async (path: string, method = 'GET', value?: unknown): Promise<any> => {
    const res = await response(path, method, value);
    assert.equal(res.status, 200, `${method} ${path}: ${await res.clone().text()}`);
    return res.json();
  };
  const put = (collection: string, key: string, value: unknown) => request(`/collections/${collection}/${key}`, 'PUT', value);
  await until(async () => (await response('/collections/profiles')).status === 200, 'gateway subscriptions');
  assert.equal((await response('/collections/profiles', 'GET', undefined, 'wrong-token')).status, 401);
  const alice = await connect(uri);
  const bob = await connect(uri);
  const newUser = await connect(uri);
  const stranger = await connect(uri);
  for (const [user, subject, name] of [[alice, 'clerk-a', 'Map Alice'], [bob, 'clerk-b', 'Map Bob'], [newUser, 'clerk-c', 'New User']] as const) {
    const res = await fetch(`${serverUrl}/v1/database/${database}/call/test_seed_user`, { method: 'POST', headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' }, body: JSON.stringify([subject, name]) });
    assert.equal(res.status, 200, await res.text());
  }
  sql(`UPDATE user_profile SET headline = '', interests = '' WHERE identity = 0x${newUser.identity}`);
  await subscribe(newUser.conn, ['SELECT * FROM my_profile', 'SELECT * FROM my_profile_details']);
  for (const id of ['alice', 'bob']) await put('profiles', id, { user_id: id, name: `Legacy ${id}`, role: 'engineer', skills: ['Python'], goals: ['Meet engineers'], interests: ['Old'], updated_at: '2025-01-02T03:04:05Z' });
  for (const [subject, id] of [['clerk-a', 'alice'], ['clerk-b', 'bob']]) {
    await request('/identity/link-legacy', 'POST', { auth_subject: subject, user_id: id });
    assert.equal((await request('/identity/resolve', 'POST', { auth_subject: subject })).user_id, id);
  }
  await subscribe(alice.conn, ['SELECT * FROM my_agent_interactions', 'SELECT * FROM my_agent_transcripts']);
  await subscribe(bob.conn, ['SELECT * FROM my_agent_interactions', 'SELECT * FROM my_agent_transcripts']);
  await subscribe(stranger.conn, ['SELECT * FROM agent_profiles', 'SELECT * FROM my_agent_interactions', 'SELECT * FROM my_agent_transcripts']);
  assert.equal([...stranger.conn.db.agentProfiles.iter()].length, 0);
  await assert.rejects(stranger.conn.reducers.putAgentProfile({ userId: 'alice', payloadJson: '{"user_id":"alice","name":"Stolen"}' }));
  const code = await request('/link-codes', 'POST', { user_id: 'alice' });
  assert.equal((await request('/link-codes/redeem', 'POST', { code: code.code, messaging_identity: 'test-messaging-alice' })).user_id, 'alice');
  assert.equal((await request('/messaging/test-messaging-alice')).user_id, 'alice');
  assert.equal((await response('/link-codes/redeem', 'POST', { code: code.code, messaging_identity: 'test-attacker' })).status, 400);
  sql(`UPDATE user_profile SET display_name = 'Fresh Alice' WHERE identity = 0x${alice.identity}`);
  assert.equal((await request('/identity/resolve', 'POST', { auth_subject: 'clerk-a', user_id: 'bob' })).user_id, 'alice');
  await until(async () => (await request('/collections/profiles/alice')).name === 'Fresh Alice', 'canonical profile subscription');
  const aliceProfile = await request('/collections/profiles/alice');
  await put('profiles', 'alice', { ...aliceProfile, name: 'Outdated resume name', skills: ['Python', 'SQL'] });
  const updatedProfile = await request('/collections/profiles/alice');
  assert.equal(updatedProfile.name, 'Fresh Alice');
  assert.deepEqual(updatedProfile.skills, ['Python', 'SQL']);
  const event = { event_id: 'event-1', title: 'Python Workshop', start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString(), topics: ['Python'], offerings: ['Meet engineers'], zone: 'workshop' };
  await put('events', event.event_id, event);
  const interaction = { interaction_id: 'i-ab', user_id: 'alice', target_id: 'bob', status: 'accepted', roi_score_at_match: 75, reason: 'Shared Python interests', recording_consent: {}, recording_active: false, audio_ref: null, transcript_ref: null, created_at: '2025-01-02T03:04:05Z' };
  await put('interactions', 'i-ab', interaction);
  assert.equal((await response('/collections/transcripts/i-ab', 'PUT', { interaction_id: 'i-ab', text: 'Private transcript' })).status, 500);
  interaction.recording_consent = { alice: true, bob: true };
  await put('interactions', 'i-ab', interaction);
  await put('transcripts', 'i-ab', { interaction_id: 'i-ab', text: 'Private transcript' });
  await until(() => [...alice.conn.db.myAgentTranscripts.iter()].length === 1 && [...bob.conn.db.myAgentTranscripts.iter()].length === 1, 'two-party transcript consent');
  assert.equal([...stranger.conn.db.myAgentTranscripts.iter()].length, 0);
  interaction.recording_consent = { alice: true, bob: false };
  await put('interactions', 'i-ab', interaction);
  await until(() => [...alice.conn.db.myAgentTranscripts.iter()].length === 0, 'consent revocation on subscribed reads');
  interaction.recording_consent = { alice: true, bob: true };
  await put('interactions', 'i-ab', interaction);
  const plan = { plan_id: 'p-ab', interaction_id: 'i-ab', user_a: 'alice', user_b: 'bob', channels: ['email'], agreed: true, drafts: { alice: 'Contact alice@example.com', bob: 'Contact bob@example.com' }, suggested_timing: 'Tomorrow', rationale: 'Shared interests', approvals: {}, send_status: {}, created_at: '2025-01-02T03:04:05Z' };
  await put('plans', 'p-ab', plan);
  await put('roi_history', 'r-b', { entry_id: 'r-b', user_id: 'bob', target_id: 'alice', interaction_id: 'i-ab', plan_id: 'p-ab', recorded_at: '2025-01-02T03:04:05Z' });
  const pythonEnv = { ...process.env, APP_ENV: 'production', STORAGE_BACKEND: 'spacetimedb', SPACETIME_GATEWAY_URL: gatewayUrl, SPACETIME_GATEWAY_TOKEN: gatewayToken, DATA_DIR: join(runDir, 'python-data'), PYTHONPATH: resolve(root, '..'), AGENT_MAILBOX: 'false', ASI1_API_KEY: '', PINECONE_API_KEY: '', VECTOR_DB_API_KEY: '', PRE_EVENT_AGENT_SEED: randomUUID(), MATCHMAKER_AGENT_SEED: randomUUID(), PARTICIPANT_AGENT_SEED: randomUUID() };
  // Exercise the actual web HTTP API, gateway and database. Only external JWKS
  // retrieval and ASI model completion are replaced by offline fixture providers.
  const webKeys = generateKeyPairSync('rsa', {
    modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await writeFile(join(runDir, 'web-jwt-public.pem'), webKeys.publicKey);
  await writeFile(join(runDir, 'web-jwt-private.pem'), webKeys.privateKey);
  const webIssuer = 'https://offline-test.clerk.invalid';
  const webAudience = 'mhacks-live-map';
  const tokenScript = `import json,time,jwt\nfrom pathlib import Path\nkey=Path('web-jwt-private.pem').read_text()\nprint(json.dumps({subject:jwt.encode({'sub':subject,'iss':'${webIssuer}','aud':'${webAudience}','exp':int(time.time())+600},key,algorithm='RS256') for subject in ('clerk-a','clerk-b','clerk-c')}))`;
  const webTokens = JSON.parse(execFileSync(python, ['-c', tokenScript], { cwd: runDir, env: pythonEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const apiPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webOrigin = 'https://local-web.example.test';
  const allowedWebOrigins = `${webOrigin},http://127.0.0.1:5173`;
  const apiFixture = join(runDir, 'web-intake-fixture.py');
  await writeFile(apiFixture, `import json,os,jwt,uvicorn
from pathlib import Path
from types import SimpleNamespace
from cryptography.hazmat.primitives.serialization import load_pem_public_key
public_key=load_pem_public_key(Path(__file__).with_name('web-jwt-public.pem').read_bytes())
jwt.PyJWKClient.get_signing_key_from_jwt=lambda self,token:SimpleNamespace(key=public_key)
import pre_event
async def fixture_llm(system,user,max_tokens=1024):
    context=json.loads(user)
    if 'simulate-model-failure' in context['introduction']:
        raise RuntimeError('Isolated provider failure')
    if context['existing_profile']['user_id']!='alice':
        return json.dumps({'name':'Extracted new name','headline':'Robotics researcher','interests':['Robotics'],'skills':['ROS'],'goals':['meet collaborators']})
    assert context['existing_profile']['name']=='Fresh Alice'
    if 'Rust' in context['introduction']:
        return json.dumps({'skills':['Rust'],'goals':['open source'],'offerings':['Rust mentoring']})
    assert 'unique resume evidence' in context['resume']
    return json.dumps({'name':'Resume name','headline':'Resume headline','interests':['Resume interest'],'skills':['TypeScript'],'goals':['meet mentors'],'offerings':['mentoring']})
pre_event.llm_complete=fixture_llm
uvicorn.run(pre_event.app,host='127.0.0.1',port=int(os.environ['TEST_API_PORT']),log_level='warning')
`);
  const apiProcess = start(python, [apiFixture], { ...pythonEnv, CLERK_ISSUER: webIssuer, CLERK_AUDIENCE: webAudience, CLERK_JWKS_URL: '', WEB_ALLOWED_ORIGINS: allowedWebOrigins, TEST_API_PORT: String(apiPort) });
  await until(async () => (await fetch(`${apiUrl}/health`)).ok, 'web intake API startup');
  const webHeaders = { authorization: `Bearer ${webTokens['clerk-a']}`, origin: webOrigin };
  const readWebProfile = async () => {
    const res = await fetch(`${apiUrl}/onboarding/profile?user_id=bob`, { headers: webHeaders });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  };
  assert.equal((await fetch(`${apiUrl}/onboarding/profile`)).status, 401);
  const invalidToken = webTokens['clerk-a'].split('.');
  invalidToken[2] = (invalidToken[2][0] === 'A' ? 'B' : 'A') + invalidToken[2].slice(1);
  assert.equal((await fetch(`${apiUrl}/onboarding/profile`, { headers: { authorization: `Bearer ${invalidToken.join('.')}` } })).status, 401);
  const preflight = await fetch(`${apiUrl}/onboarding/input`, { method: 'OPTIONS', headers: { origin: webOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('access-control-allow-origin'), webOrigin);
  const controls = { discoverable: true, free_windows: [[event.start, event.end]], followup_prefs: { allowed_channels: ['email'], handles: { email: 'test@example.invalid' }, notes: 'Email only' } };
  const assertControls = (profile: any) => {
    assert.equal(profile.discoverable, controls.discoverable);
    assert.deepEqual(profile.followup_prefs, controls.followup_prefs);
    assert.deepEqual(profile.free_windows.map((window: string[]) => window.map(value => Date.parse(value))), controls.free_windows.map(window => window.map(value => Date.parse(value))));
  };
  await put('profiles', 'alice', { ...updatedProfile, ...controls });
  const intake = new FormData();
  intake.set('user_id', 'bob'); // untrusted browser identity must never control the target
  intake.set('message', 'I mentor new programmers.');
  intake.set('file', new Blob(['TypeScript developer: unique resume evidence'], { type: 'text/plain' }), 'resume.txt');
  const firstIntake = await fetch(`${apiUrl}/onboarding/input`, { method: 'POST', headers: webHeaders, body: intake });
  assert.equal(firstIntake.status, 200, await firstIntake.clone().text());
  const savedIntake = await firstIntake.json();
  assert.equal(savedIntake.user_id, 'alice');
  assert.equal(savedIntake.name, 'Fresh Alice');
  assert.equal(savedIntake.headline, 'Engineer');
  assert.deepEqual(savedIntake.interests, ['Python', 'Maps']);
  assert.deepEqual(savedIntake.skills, ['Python', 'SQL', 'TypeScript']);
  assert.deepEqual(savedIntake.goals, ['Meet engineers', 'meet mentors']);
  assert.equal(savedIntake.introduction, 'I mentor new programmers.');
  assert.equal(savedIntake.resume_filename, 'resume.txt');
  assertControls(savedIntake);
  assert.deepEqual((await readWebProfile()).profile, savedIntake);
  assert.deepEqual(await request('/collections/profiles/alice'), savedIntake);
  assert.equal(JSON.stringify(savedIntake).includes('unique resume evidence'), false);
  assert.equal((await request('/collections/profiles/bob')).introduction, undefined);
  const supplement = new FormData();
  supplement.set('message', 'I also teach Rust.');
  const secondIntake = await fetch(`${apiUrl}/onboarding/input`, { method: 'POST', headers: webHeaders, body: supplement });
  assert.equal(secondIntake.status, 200, await secondIntake.clone().text());
  let supplemented = await secondIntake.json();
  assert.deepEqual(supplemented.skills, ['Python', 'SQL', 'TypeScript', 'Rust']);
  assert.deepEqual(supplemented.goals, ['Meet engineers', 'meet mentors', 'open source']);
  assert.deepEqual(supplemented.offerings, ['mentoring', 'Rust mentoring']);
  assert.equal(supplemented.introduction, 'I mentor new programmers.\n\nI also teach Rust.');
  assert.equal(supplemented.resume_filename, 'resume.txt');
  assertControls(supplemented);
  const failedInput = new FormData();
  failedInput.set('message', 'simulate-model-failure');
  assert.equal((await fetch(`${apiUrl}/onboarding/input`, { method: 'POST', headers: webHeaders, body: failedInput })).status, 502);
  assert.deepEqual((await readWebProfile()).profile, supplemented);
  const newHeaders = { authorization: `Bearer ${webTokens['clerk-c']}` };
  const emptyNewProfile = await fetch(`${apiUrl}/onboarding/profile`, { headers: newHeaders });
  assert.equal(emptyNewProfile.status, 200);
  assert.deepEqual(await emptyNewProfile.json(), { user_id: newUser.identity, profile: null });
  const newInput = new FormData();
  newInput.set('message', 'I research robotics and want collaborators.');
  const createdNewProfile = await fetch(`${apiUrl}/onboarding/input`, { method: 'POST', headers: newHeaders, body: newInput });
  assert.equal(createdNewProfile.status, 200, await createdNewProfile.clone().text());
  const newProfile = await createdNewProfile.json();
  assert.equal(newProfile.name, 'New User');
  assert.equal(newProfile.headline, 'Robotics researcher');
  assert.deepEqual(newProfile.interests, ['Robotics']);
  assert.deepEqual(newProfile.skills, ['ROS']);
  assert.deepEqual(newProfile.goals, ['meet collaborators']);
  assert.equal(newProfile.discoverable, false);
  await until(() => Boolean([...newUser.conn.db.myProfileDetails.iter()][0]?.agentProfileJson), 'new private ASI profile subscription');
  const newMapProfile = [...newUser.conn.db.myProfile.iter()][0];
  assert.equal(newMapProfile.displayName, 'New User');
  assert.equal(newMapProfile.headline, '');
  assert.equal(newMapProfile.interests, '');
  assert.equal(newMapProfile.showOnMap, false);
  const restoredNewProfile = await fetch(`${apiUrl}/onboarding/profile`, { headers: newHeaders });
  assert.deepEqual((await restoredNewProfile.json()).profile, newProfile);
  await stop(apiProcess);
  const restoredApi = start(python, [apiFixture], { ...pythonEnv, CLERK_ISSUER: webIssuer, CLERK_AUDIENCE: webAudience, CLERK_JWKS_URL: '', WEB_ALLOWED_ORIGINS: allowedWebOrigins, TEST_API_PORT: String(apiPort) });
  await until(async () => (await fetch(`${apiUrl}/health`)).ok, 'web API restart');
  assert.deepEqual((await readWebProfile()).profile, supplemented);
  if (process.env.INTAKE_BROWSER_VERIFY === '1') {
    const browserDir = resolve(root, '../../map/.test-runtime');
    const donePath = join(browserDir, 'onboarding-browser.done');
    await mkdir(browserDir, { recursive: true });
    await rm(donePath, { force: true });
    await writeFile(join(browserDir, 'onboarding-browser.json'), JSON.stringify({ apiUrl, token: webTokens['clerk-a'], accountName: 'Fresh Alice' }));
    console.log('Browser verification ready: map/.test-runtime/onboarding-browser.json (fixture token is never logged)');
    const deadline = Date.now() + 180_000;
    let browserDone = false;
    while (Date.now() < deadline) {
      try { await access(donePath); browserDone = true; break; } catch { /* wait for the optional local browser walkthrough */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(browserDone, true, 'browser verification must complete within three minutes');
    supplemented = (await readWebProfile()).profile;
    await rm(join(browserDir, 'onboarding-browser.json'), { force: true });
  }
  await stop(restoredApi);
  console.log('Real web HTTP intake, RS256 authentication, canonical profile persistence, supplements, provider failure and API restart restoration passed');
  const pythonPresence = `import asyncio, logging\nfrom types import SimpleNamespace\nimport during\nfrom models import ProfileUpdate, utcnow\nfrom integrations import store\nctx=SimpleNamespace(logger=logging.getLogger('local-test'))\nasyncio.run(during.on_profile_update(ctx,during.participant_host.address,ProfileUpdate(user_id='alice',discoverable=True,timestamp=utcnow())))\nassert any(r['user_id']=='alice' for r in store.list_presence())\nduring.live.clear(); during.last_seen.clear()\nasyncio.run(during.restore_presence(ctx)); assert 'alice' in during.live\nimport pre_event\nassert asyncio.run(pre_event.recommend('alice',5))[0].event.event_id=='event-1'\nprint('Python presence persistence, restart restore and event recommendation passed')`;
  console.log(execFileSync(python, ['-c', pythonPresence], { cwd: runDir, env: pythonEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  const migrationDir = join(runDir, 'migration');
  const migrationRecords: Record<string, object> = {
    profiles: { user_id: 'migrated', name: 'Imported User', updated_at: '2025-01-02T03:04:05Z' },
    events: { ...event, event_id: 'migrated-event' },
    interactions: { ...interaction, interaction_id: 'migrated-interaction' },
    transcripts: { interaction_id: 'migrated-interaction', text: 'Imported transcript' },
    plans: { ...plan, plan_id: 'migrated-plan', interaction_id: 'migrated-interaction' },
    roi_history: { entry_id: 'migrated-roi', user_id: 'alice', target_id: 'bob', interaction_id: 'migrated-interaction', recorded_at: '2025-01-02T03:04:05Z' },
  };
  for (const [collection, record] of Object.entries(migrationRecords)) {
    await mkdir(join(migrationDir, collection), { recursive: true });
    await writeFile(join(migrationDir, collection, 'record.json'), JSON.stringify(record));
  }
  const migrate = () => execFileSync(python, [resolve(root, '../migrate_json.py')], { cwd: runDir, env: { ...pythonEnv, DATA_DIR: migrationDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal((migrate().match(/imported=1/g) ?? []).length, 6);
  assert.equal((migrate().match(/skipped_existing=1/g) ?? []).length, 6);
  assert.equal((await request('/collections/profiles/migrated')).updated_at, '2025-01-02T03:04:05Z');
  console.log('Real gateway authentication, canonical profiles, consent subscriptions and six-collection migration passed');
  await stop(gatewayProcess);
  for (const conn of connections) conn.disconnect();
  connections.clear();
  sql('SELECT COUNT(*) AS row_count FROM roi_history');
  await stop(dbProcess);
  dbProcess = startDatabase();
  await until(async () => (await fetch(`${serverUrl}/v1/ping`)).ok, 'database restart');
  gatewayProcess = startGateway();
  await until(async () => (await response('/collections/profiles')).status === 200, 'gateway restart');
  for (const collection of Object.keys(migrationRecords)) assert.ok((await request(`/collections/${collection}`)).length > 0, `${collection} survives restart`);
  assert.deepEqual(await request('/collections/profiles/alice'), supplemented);
  assert.deepEqual(await request(`/collections/profiles/${newUser.identity}`), newProfile);
  assert.ok((await request('/presence')).some((row: any) => row.user_id === 'alice'));
  assert.equal((await request('/identity/resolve', 'POST', { auth_subject: 'clerk-a' })).user_id, 'alice');
  await request('/collections/interactions/i-ab', 'DELETE');
  for (const [collection, key] of [['plans', 'p-ab'], ['transcripts', 'i-ab'], ['roi_history', 'r-b']]) assert.equal(await request(`/collections/${collection}/${key}`), null);
  sql("DELETE FROM interaction WHERE interaction_id = 'migrated-interaction'");
  await request('/users/alice', 'DELETE');
  assert.equal(await request('/collections/plans/migrated-plan'), null);
  assert.equal(await request('/collections/transcripts/migrated-interaction'), null);
  assert.equal(await request('/collections/roi_history/migrated-roi'), null);
  assert.equal(await request('/collections/profiles/alice'), null);
  assert.equal(await request('/messaging/test-messaging-alice'), null);
  assert.equal((await request('/presence')).some((row: any) => row.user_id === 'alice'), false);
  assert.equal((await request('/collections/profiles/bob')).user_id, 'bob');
  console.log('Database/gateway restart persistence and complete deletion passed');
} finally {
  for (const conn of connections) conn.disconnect();
  for (const child of [...children]) await stop(child);
}

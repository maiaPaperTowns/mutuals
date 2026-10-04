import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DbConnection } from '../../../map/src/module_bindings/index.ts';

const gatewayToken = process.env.SPACETIME_GATEWAY_TOKEN ?? '';
const uri = process.env.SPACETIMEDB_URI ?? '';
const database = process.env.SPACETIMEDB_DATABASE ?? '';
const serviceToken = process.env.SPACETIMEDB_SERVICE_TOKEN ?? '';
const port = Number(process.env.SPACETIME_GATEWAY_PORT ?? 8110);
const host = process.env.SPACETIME_GATEWAY_HOST ?? '127.0.0.1';
const collections = new Set(['profiles', 'events', 'interactions', 'transcripts', 'plans', 'roi_history']);

if (!gatewayToken || !uri || !database || !serviceToken) {
  throw new Error('Configure SPACETIME_GATEWAY_TOKEN, SPACETIMEDB_URI, SPACETIMEDB_DATABASE, and SPACETIMEDB_SERVICE_TOKEN.');
}

const connected = new Promise<InstanceType<typeof DbConnection>>((resolve, reject) => {
  const connection = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .withToken(serviceToken)
    .onConnect((conn, identity) => {
      console.log(`Connected to SpacetimeDB as service identity ${identity.toHexString()}`);
      conn.subscriptionBuilder()
        .onApplied(() => resolve(conn))
        .onError((ctx) => reject(ctx.event))
        .subscribe([
          'SELECT * FROM agent_user_links', 'SELECT * FROM agent_link_codes', 'SELECT * FROM agent_profiles',
          'SELECT * FROM agent_presences', 'SELECT * FROM agent_events', 'SELECT * FROM agent_interactions',
          'SELECT * FROM agent_transcripts', 'SELECT * FROM agent_follow_up_plans', 'SELECT * FROM agent_roi_history',
        ]);
    })
    .onConnectError((_, error) => reject(error))
    .build();
  void connection;
});

function fail(res: ServerResponse, status: number, message: string): void {
  json(res, status, { detail: message });
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function authorized(req: IncomingMessage): boolean {
  const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(gatewayToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function body(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Request body is too large.');
    chunks.push(Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed as Record<string, any>;
}

function records(conn: InstanceType<typeof DbConnection>, collection: string): Array<{ key: string; value: Record<string, any> }> {
  const table = {
    profiles: [...conn.db.agentProfiles.iter()].map((row) => ({ key: row.userId, value: JSON.parse(row.payloadJson) })),
    events: [...conn.db.agentEvents.iter()].map((row) => ({ key: row.eventId, value: JSON.parse(row.payloadJson) })),
    interactions: [...conn.db.agentInteractions.iter()].map((row) => ({ key: row.interactionId, value: JSON.parse(row.payloadJson) })),
    transcripts: [...conn.db.agentTranscripts.iter()].map((row) => ({ key: row.interactionId, value: JSON.parse(row.payloadJson) })),
    plans: [...conn.db.agentFollowUpPlans.iter()].map((row) => ({ key: row.planId, value: JSON.parse(row.payloadJson) })),
    roi_history: [...conn.db.agentRoiHistory.iter()].map((row) => ({ key: row.entryId, value: JSON.parse(row.payloadJson) })),
  }[collection];
  return table ?? [];
}

function keyOf(collection: string, value: Record<string, any>): string {
  const field = { profiles: 'user_id', events: 'event_id', interactions: 'interaction_id', transcripts: 'interaction_id', plans: 'plan_id', roi_history: 'entry_id' }[collection];
  if (!field) throw new Error('Unknown agent data collection.');
  const key = value[field];
  if (typeof key !== 'string' || !key) throw new Error(`Record requires ${field}.`);
  return key;
}

async function put(conn: InstanceType<typeof DbConnection>, collection: string, key: string, value: Record<string, any>): Promise<void> {
  if (collection === 'profiles') {
    await conn.reducers.putAgentProfile({ userId: key, payloadJson: JSON.stringify(value) });
  } else if (collection === 'events') {
    await conn.reducers.putAgentEvent({ eventId: key, startAtMs: BigInt(Date.parse(value.start)), endAtMs: BigInt(Date.parse(value.end)), zoneId: value.zone ?? undefined, payloadJson: JSON.stringify(value) });
  } else if (collection === 'interactions') {
    await conn.reducers.putAgentInteraction({
      interactionId: key, userId: value.user_id, targetId: value.target_id, status: value.status,
      roiScoreAtMatch: value.roi_score_at_match, reason: value.reason, recordingConsentJson: JSON.stringify(value.recording_consent ?? {}),
      recordingActive: value.recording_active, audioRef: value.audio_ref ?? undefined, transcriptRef: value.transcript_ref ?? undefined,
      payloadJson: JSON.stringify(value),
    });
  } else if (collection === 'transcripts') {
    const interaction = [...conn.db.agentInteractions.iter()].find((row) => row.interactionId === key);
    if (!interaction) throw new Error('Transcript interaction does not exist.');
    await conn.reducers.putAgentTranscript({ interactionId: key, userId: interaction.userId, targetId: interaction.targetId, text: value.text, audioRef: value.audio_ref ?? undefined, payloadJson: JSON.stringify(value) });
  } else if (collection === 'plans') {
    await conn.reducers.putAgentFollowUpPlan({ planId: key, interactionId: value.interaction_id, userA: value.user_a, userB: value.user_b, payloadJson: JSON.stringify(value) });
  } else if (collection === 'roi_history') {
    await conn.reducers.putAgentRoiHistory({ entryId: key, userId: value.user_id, interactionId: value.interaction_id, recordedAtMs: BigInt(Date.parse(value.recorded_at)), payloadJson: JSON.stringify(value) });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok' });
  if (!authorized(req)) return fail(res, 401, 'Gateway authentication required.');
  const conn = await connected;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api') return fail(res, 404, 'Not found.');

  if (parts[1] === 'collections' && collections.has(parts[2])) {
    const collection = parts[2];
    const rows = records(conn, collection);
    if (req.method === 'GET' && parts.length === 3) return json(res, 200, rows.map((row) => row.value));
    if (parts.length === 4 && req.method === 'GET') {
      const found = rows.find((row) => row.key === parts[3]);
      return json(res, 200, found?.value ?? null);
    }
    if (parts.length === 4 && req.method === 'PUT') {
      const value = await body(req);
      if (keyOf(collection, value) !== parts[3]) return fail(res, 400, 'Path key does not match record key.');
      await put(conn, collection, parts[3], value);
      return json(res, 200, value);
    }
    if (parts.length === 4 && req.method === 'DELETE') {
      await conn.reducers.deleteAgentRecord({ collection, key: parts[3] });
      return json(res, 200, { deleted: true });
    }
  }
  if (parts[1] === 'identity' && parts[2] === 'resolve' && req.method === 'POST') {
    const input = await body(req);
    await conn.reducers.linkAgentUser({ authSubject: input.auth_subject });
    const link = [...conn.db.agentUserLinks.iter()].find((row) => row.authSubject === input.auth_subject);
    if (!link) throw new Error('Identity link was not available after the reducer completed.');
    return json(res, 200, { user_id: link.userId });
  }
  // Operator-only migration: the backend bearer secret is required, and the
  // operator must verify legacy ownership before calling this endpoint.
  if (parts[1] === 'identity' && parts[2] === 'link-legacy' && parts.length === 3 && req.method === 'POST') {
    const input = await body(req);
    if (typeof input.auth_subject !== 'string' || !input.auth_subject || typeof input.user_id !== 'string' || !input.user_id) {
      return fail(res, 400, 'Provide the verified auth_subject and imported user_id.');
    }
    await conn.reducers.linkAgentUser({ authSubject: input.auth_subject, legacyUserId: input.user_id });
    return json(res, 200, { user_id: input.user_id });
  }
  if (parts[1] === 'link-codes' && parts.length === 2 && req.method === 'POST') {
    const input = await body(req);
    const code = randomUUID().replaceAll('-', '');
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    await conn.reducers.createAgentLinkCode({ code, userId: input.user_id, expiresAtMs: BigInt(expiresAtMs) });
    return json(res, 200, { code, expires_at: new Date(expiresAtMs).toISOString() });
  }
  if (parts[1] === 'link-codes' && parts[2] === 'redeem' && req.method === 'POST') {
    const input = await body(req);
    const challenge = [...conn.db.agentLinkCodes.iter()].find((row) => row.code === input.code);
    if (!challenge || Number(challenge.expiresAtMs) <= Date.now()) return fail(res, 400, 'Link code is invalid or expired.');
    await conn.reducers.redeemAgentLinkCode({ code: input.code, messagingIdentity: input.messaging_identity });
    return json(res, 200, { user_id: challenge.userId });
  }
  if (parts[1] === 'messaging' && parts.length === 3 && req.method === 'GET') {
    const link = [...conn.db.agentUserLinks.iter()].find((row) => row.messagingIdentity === parts[2]);
    return json(res, 200, link ? { user_id: link.userId } : null);
  }
  if (parts[1] === 'presence' && req.method === 'GET' && parts.length === 2) {
    return json(res, 200, [...conn.db.agentPresences.iter()].map((row) => JSON.parse(row.payloadJson)));
  }
  if (parts[1] === 'presence' && parts.length === 3 && req.method === 'PUT') {
    const value = await body(req);
    await conn.reducers.putAgentPresence({ userId: parts[2], zoneId: value.location?.zone ?? '', availabilityStatus: value.availability?.status ?? 'free', discoverable: value.discoverable === true, payloadJson: JSON.stringify(value) });
    return json(res, 200, value);
  }
  if (parts[1] === 'presence' && parts.length === 3 && req.method === 'DELETE') {
    await conn.reducers.deleteAgentPresence({ userId: parts[2] });
    return json(res, 200, { deleted: true });
  }
  if (parts[1] === 'users' && parts.length === 3 && req.method === 'DELETE') {
    await conn.reducers.deleteMyAgentData({ userId: parts[2] });
    return json(res, 200, { deleted: true });
  }
  return fail(res, 404, 'Not found.');
}

createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => {
    console.error('ASI Spacetime gateway request failed:', error);
    if (!res.headersSent) fail(res, 500, 'Persistence operation failed.');
    else res.destroy();
  });
}).listen(port, host, () => console.log(`ASI Spacetime gateway listening on ${host}:${port}`));

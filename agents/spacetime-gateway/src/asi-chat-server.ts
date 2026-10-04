import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DbConnection } from '../../../map/src/module_bindings/index.ts';
import { dispatchChat } from './asi-chat.ts';

const secret = process.env.ASI_CHAT_BRIDGE_TOKEN ?? '';
const token = process.env.ASI_CHAT_SERVICE_TOKEN ?? '';
if (!secret || !token) throw new Error('Set server-only ASI_CHAT_BRIDGE_TOKEN and ASI_CHAT_SERVICE_TOKEN.');
const ready = new Promise<DbConnection>((resolve, reject) => DbConnection.builder()
  .withUri(process.env.SPACETIMEDB_URI ?? 'wss://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.SPACETIMEDB_DATABASE ?? 'mhacks-live-map').withToken(token)
  .onConnect((conn, identity) => { console.log(`ACP bridge identity: ${identity.toHexString()}`); resolve(conn); })
  .onConnectError((_, error) => reject(error)).build());
const conn = await ready.catch(() => {
  console.error('ACP bridge could not connect to SpacetimeDB.'); process.exit(1);
});

createServer((req, res) => {
  const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  void (async () => {
    const provided = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const left = Buffer.from(provided), right = Buffer.from(secret);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return json(401, { reply: 'Bridge authentication required.' });
    if (req.method === 'GET' && req.url === '/health') return json(conn.isActive ? 200 : 503, { connected: conn.isActive });
    if (req.method !== 'POST' || req.url !== '/chat') return json(404, { reply: 'Not found.' });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 20000) return json(413, { reply: 'Chat request is too large.' }); chunks.push(Buffer.from(chunk)); }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json(400, { reply: 'Invalid chat request.' }); }
    const api = { ...conn.procedures, ...conn.reducers };
    return json(200, await dispatchChat(api, input));
  })().catch(() => {
    // Never log private input, codes, raw SDK errors or model replies.
    console.error('ACP bridge operation failed.');
    if (!res.headersSent) json(503, { reply: 'The mutuals backend could not complete this request. Please retry or check your website account connection.' });
    else res.destroy();
  });
}).listen(8111, '127.0.0.1', () => console.log('ACP bridge listening on 127.0.0.1:8111'));

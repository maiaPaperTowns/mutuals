import { useEffect, useState } from 'react';

type Props = { signedIn: boolean; isActive: boolean; createCode: () => Promise<string>; getStatus: () => Promise<string>; revoke: () => Promise<unknown> };

export default function AsiAccountLink({ signedIn, isActive, createCode, getStatus, revoke }: Props) {
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const refresh = async () => {
    const status = JSON.parse(await getStatus());
    setConnected(status.connected === true);
    if (status.connected) setCode(null);
  };
  useEffect(() => {
    let cancelled = false;
    setCode(null); setConnected(false); setError('');
    if (signedIn && isActive) void getStatus().then(value => { if (!cancelled) setConnected(JSON.parse(value).connected === true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [signedIn, isActive, getStatus]);
  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the ASI:One connection.'); }
    finally { setBusy(false); }
  };
  const valid = code && Date.parse(code.expires_at) > now;
  if (!signedIn) return <section className="workspace-inbox" aria-label="ASI:One account connection"><h2>Use mutuals in ASI:One</h2><p>Sign in and save your profile to connect your Pre and Post assistants.</p></section>;
  return <section className="workspace-inbox" aria-label="ASI:One account connection">
    <h2>Use mutuals in ASI:One</h2>
    <p>Get event recommendations and save follow-up drafts in ASI:One. During uses this website and GPS.</p>
    <p role="status">{connected ? 'ASI:One connected' : 'ASI:One is not connected'}</p>
    <div className="workspace-actions">
      <button className="workspace-button" disabled={!isActive || busy} onClick={() => void act(async () => {
        setCode(null); const next = JSON.parse(await createCode()); setNow(Date.now()); setCode(next);
      })}>Generate link code</button>
      <button className="workspace-button" disabled={!isActive || busy} onClick={() => void act(refresh)}>Check connection</button>
      <button className="workspace-button" disabled={!isActive || busy || (!connected && !code)} onClick={() => void act(async () => {
        await revoke(); setCode(null); setConnected(false);
      })}>Disconnect ASI:One</button>
    </div>
    {valid && <div><p>In a chat with mutuals Networking, send:</p><code>link {code.code}</code><p>This one-time code expires in {Math.max(1, Math.ceil((Date.parse(code.expires_at) - now) / 1000))} seconds. This chat's authorization lasts up to 24 hours.</p>
      <button className="workspace-button" onClick={() => void act(() => navigator.clipboard.writeText(`link ${code.code}`))}>Copy link command</button></div>}
    {code && !valid && <p role="status">Link code expired. Generate a new code.</p>}
    <p>Each new ASI:One chat needs a new code. Linking a new chat replaces the previous connection.</p>
    {error && <p className="intake-error" role="alert">{error}</p>}
  </section>;
}

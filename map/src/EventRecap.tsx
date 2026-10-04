import { useEffect, useRef, useState } from 'react';
import { useProcedure } from 'spacetimedb/react';
import { procedures } from './module_bindings';

export default function EventRecap({ eventId, onBusy }: { eventId: string; onBusy: (busy: boolean) => void }) {
  const generate = useProcedure(procedures.generateEventRecap);
  const pending = useRef<Promise<string> | null>(null);
  const [reply, setReply] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    onBusy(true); setError('');
    pending.current ??= generate({ eventId });
    void pending.current.then(value => {
      if (!cancelled) setReply(JSON.parse(value).reply);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) onBusy(false); });
    return () => { cancelled = true; onBusy(false); };
  }, [eventId, generate, onBusy, attempt]);
  return <section className="event-recap" aria-label="Event recap">
    <span className="eyebrow">POST / YOUR EVENT RECAP</span><h3>Your connections, together</h3>
    <p className="workspace-muted">Post asks Pre about shared interests and During about your connection history, then brings their perspectives together.</p>
    {reply ? <p className="recap-text">{reply}</p> : !error && <p role="status">Pre and During are sharing their notes with Post…</p>}
    {error && <div role="alert"><p>{error}</p><button className="workspace-button" onClick={() => { pending.current = null; setAttempt(value => value + 1); }}>Retry recap</button></div>}
  </section>;
}

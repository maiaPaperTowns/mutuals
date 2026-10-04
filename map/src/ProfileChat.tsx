import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Brand from './Brand';
import type { IntakeProfile, ProfileApi } from './profileApi';

type Entry = { text: string; filename?: string };
const prompts = ['I am working on…', 'I can help with…', 'I want to meet people who…'];

export default function ProfileChat({ signedIn, accountName, api, onSignIn, accountControl, ready = true, networking }: {
  signedIn: boolean; accountName: string; api: ProfileApi; onSignIn: () => void; accountControl?: ReactNode; ready?: boolean; networking?: ReactNode;
}) {
  const [profile, setProfile] = useState<IntakeProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null); setEntries([]); setError('');
    if (!signedIn) { setLoading(false); return; }
    setLoading(true);
    if (!ready) return;
    void api.load().then(result => { if (!cancelled) setProfile(result.profile); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your profile.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, signedIn, ready]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!signedIn) { onSignIn(); return; }
    if (busy || loading || (!draft.trim() && !file)) return;
    setBusy(true); setError('');
    try {
      const saved = await api.submit(draft, file);
      setProfile(saved); setEntries(previous => [...previous, { text: draft.trim(), filename: file?.name }]);
      setDraft(''); setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile. Please try again.');
    } finally { setBusy(false); }
  };

  const selectFile = (selected?: File) => {
    setError('');
    if (!selected) return;
    if (!/\.(pdf|txt)$/i.test(selected.name)) { setError('Please attach a PDF or plain text resume.'); if (fileInput.current) fileInput.current.value = ''; return; }
    if (selected.size > 10 * 1024 * 1024) { setError('Your resume must be 10 MB or smaller.'); if (fileInput.current) fileInput.current.value = ''; return; }
    setFile(selected);
  };

  return <main className="profile-chat">
    <header className="chat-topbar">
      <div className="shared-brand"><Brand /><a className="nav-link" href="/">↗ Live map</a></div>
      <div className="chat-nav">{accountControl}</div>
    </header>
    <div className="profile-intro"><h1 id="intake-title">Good connections start with <em>you.</em></h1></div>
    <div className="chat-layout">
      <aside className={`profile-summary${summaryOpen ? ' summary-open' : ''}`} aria-label="Saved profile">
        <button className="summary-toggle" type="button" aria-expanded={summaryOpen} aria-controls="saved-profile-details" onClick={() => setSummaryOpen(value => !value)}>Your saved profile <span>{summaryOpen ? '−' : '+'}</span></button>
        <div id="saved-profile-details" className="summary-details"><h2 className="profile-title">Profile</h2><div className="summary-identity"><div className="summary-avatar">{(profile?.name || accountName).slice(0, 1).toUpperCase()}</div><div><h2>{profile?.name || (signedIn ? accountName : 'Your name')}</h2><p className="summary-headline">{profile?.headline || 'Add a short introduction about yourself.'}</p><span className="profile-save-state">{profile ? '✓ Saved to your account' : 'No changes yet'}</span></div></div>
          {(['skills', 'interests', 'goals', 'offerings'] as const).map(key => <section className="summary-section" key={key}><h3>{key === 'goals' ? 'Looking for' : key === 'offerings' ? 'Can offer' : key}</h3>{profile?.[key]?.length ? <ul>{profile[key].map(value => <li key={value}>{value}</li>)}</ul> : <button className="profile-add-context" type="button" onClick={() => { setDraft(previous => previous ? `${previous}\n${key === 'skills' ? 'My skills include: ' : key === 'interests' ? 'My interests include: ' : key === 'goals' ? 'I want to meet people who: ' : 'I can offer: '}` : key === 'skills' ? 'My skills include: ' : key === 'interests' ? 'My interests include: ' : key === 'goals' ? 'I want to meet people who: ' : 'I can offer: '); composer.current?.focus(); }}>{key === 'skills' ? 'Add skills +' : key === 'interests' ? 'Add interests +' : key === 'goals' ? 'Who would you like to meet?' : 'What can you share or help with?'}</button>}</section>)}
          {profile?.resume_filename && <p className="summary-resume">↳ {profile.resume_filename}</p>}
          <p className="summary-footnote">This is your saved profile, ready for matching. Saving here does not check you into an event or start a match.</p>
        </div>
      </aside>
      <section className="intake-panel" aria-labelledby="intake-title">
        <div className="profile-agent-heading"><span className="intake-avatar" aria-hidden="true">mh+</span><div><h2>AI Agent</h2><small>Your profile assistant</small></div></div>
        <div className="intake-thread" role="log" aria-label="Profile conversation" aria-live="polite">
          <article className="intake-note"><span className="intake-avatar" aria-hidden="true">mh+</span><div><b>Let's get to know you.</b><p>Attach your resume or tell us a little about yourself. What do you enjoy building? Who would you like to meet?</p><small>You can add more later. Your resume and introduction stay off the public map.</small></div></article>
          {loading && <p className="intake-status" role="status">Loading your saved profile…</p>}
          {entries.length === 0 && profile?.introduction && <article className="user-note"><small>SAVED INTRODUCTION</small><p>{profile.introduction}</p></article>}
          {entries.map((entry, index) => <div key={index}><article className="user-note"><small>{accountName}</small>{entry.text && <p>{entry.text}</p>}{entry.filename && <span className="attachment-tag">↳ {entry.filename}</span>}</article><p className="save-confirmation">Your profile is saved. You can add more whenever you like.</p></div>)}
        </div>
        {!signedIn ? <div className="intake-signin"><p>Your profile belongs to your account.</p><button type="button" className="intake-submit" onClick={onSignIn}>Sign in to start <span aria-hidden="true">↗</span></button></div> : <form className="intake-composer" onSubmit={submit}>
          <div className="starter-prompts">{prompts.map(prompt => <button key={prompt} type="button" disabled={busy || loading} onClick={() => { setDraft(previous => previous ? `${previous}\n${prompt}` : prompt); composer.current?.focus(); }}>{prompt}</button>)}</div>
          <label className="sr-only" htmlFor="intake-message">Your introduction</label>
          <textarea id="intake-message" ref={composer} maxLength={10000} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy || loading} placeholder="Tell us about yourself, what you can offer, or who you want to meet…" />
          {file && <div className="selected-resume"><span>↳ {file.name}</span><button type="button" disabled={busy} aria-label="Remove resume" onClick={() => { setFile(undefined); if (fileInput.current) fileInput.current.value = ''; }}>×</button></div>}
          <div className="composer-actions"><label className={`resume-upload${busy || loading ? ' disabled' : ''}`}><span aria-hidden="true">＋</span> Attach resume<input ref={fileInput} type="file" aria-label="Attach resume" accept=".pdf,.txt,application/pdf,text/plain" disabled={busy || loading} onChange={event => selectFile(event.target.files?.[0])} /></label><button className="intake-submit" type="submit" disabled={busy || loading || (!draft.trim() && !file)}>{busy ? 'Saving your profile…' : 'Save to my profile'}<span aria-hidden="true">↗</span></button></div>
          <p className="composer-hint">PDF or TXT · up to 10 MB · {draft.length.toLocaleString()} / 10,000 characters</p>
        </form>}
        {error && <p className="intake-error" role="alert">{error}</p>}
      </section>

    </div>
    {networking}
    <footer className="chat-footer"><span>MHACKS / MEET YOUR PEOPLE</span><span>A resume is a start. The rest is you.</span></footer>
  </main>;
}

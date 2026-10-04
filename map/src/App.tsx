import { createContext, useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { SignIn, SignUp, useClerk } from '@clerk/react';
import { MapContainer, Marker, TileLayer, Tooltip, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { reducers, tables } from './module_bindings';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import ProfileChat from './ProfileChat';
import LiveProfileChat from './LiveProfileChat';
import NetworkingWorkspace from './NetworkingWorkspace';
import { EventAreaLayer, readEventArea, type EventArea } from './EventAreaMap';
import { createProfileApi } from './profileApi';
import { badgeStatus, badgeSupported, useBadge, type BadgeStatus } from './badge';
import { LEVEL_AT, LEVEL_NAME, TIER_NAME, usePoints, type Connection, type Gain } from './points';
import { STYLE_KEY, StyleContext, loadStyle, type Style } from './style';

const noToken = async () => null;
const previewProfileApi = createProfileApi('', noToken, async () => {});

const DUDERSTADT: [number, number] = [42.2912, -83.7157];
type LocationPin = { participantId: string; latitude: number; longitude: number; accuracyMeters: number };
type UserProfile = { displayName: string; headline: string; interests: string; showOnMap: boolean };
type PublicMapProfile = Pick<UserProfile, 'displayName' | 'headline' | 'interests'>;
const AuthDialogContext = createContext<() => void>(() => {});
const SignedInContext = createContext(false);

const pinIcon = (mine: boolean) => L.divIcon({
  className: `live-pin${mine ? ' live-pin-mine' : ''}`,
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
const venueIcon = L.divIcon({
  className: 'venue-pin',
  html: '<span class="venue-dot"></span><b>DUDERSTADT CENTER</b><small>2281 Bonisteel Blvd</small>',
  iconSize: [176, 48],
  iconAnchor: [10, 20],
});

function LiveMapContent({ authEnabled, accountName }: { authEnabled: boolean; accountName: string }) {
  const [rows, loaded] = useTable(tables.liveLocation);
  const [publicProfiles] = useTable(tables.publicProfiles);
  const [eventRows] = useTable(tables.networkingInvitations);
  const [eventAreas] = useTable(tables.networkingEventAreas);
  const areas = eventAreas.map(row => ({ eventId: row.eventId, title: eventRows.find(event => event.eventId === row.eventId)?.title || 'Event', points: readEventArea(row.areaJson) }));
  const setPresence = useReducer(reducers.setMyPresence);
  const updateLocation = useReducer(reducers.updateMyLocation);
  const stopLocation = useReducer(reducers.stopSharingLocation);
  const leaveMap = useReducer(reducers.leaveMap);
  // Your own profile: its name goes on your dot (and on other people's badges) while you share.
  const [myProfileRows] = useTable(tables.myProfile);
  const myProfile = myProfileRows[0];
  const saveMyProfile = useReducer(reducers.saveMyProfile);
  const { isActive, identity } = useSpacetimeDB();
  const id = identity?.toHexString() ?? '';
  const signedIn = useContext(SignedInContext);
  const requestSignIn = useContext(AuthDialogContext);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [locationError, setLocationError] = useState('');
  const sharingRef = useRef(false);
  const lastSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const pins: LocationPin[] = rows.map(row => ({
    participantId: row.participantId,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
  }));
  const profileById = new Map<string, PublicMapProfile>(publicProfiles.map(profile => [profile.participantId, profile]));

  useEffect(() => {
    if (!sharing || !isActive || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(position => {
      if (!sharingRef.current) return;
      if (position.coords.accuracy > 10000) {
        setLocationError('Location accuracy is too low to show. Move outdoors or try again later.');
        return;
      }
      const now = Date.now();
      const last = lastSentRef.current;
      const movedEnough = !last || L.latLng(last.lat, last.lng).distanceTo([position.coords.latitude, position.coords.longitude]) >= 8;
      if (!movedEnough && now - (last?.time ?? 0) < 5000) return;
      lastSentRef.current = { lat: position.coords.latitude, lng: position.coords.longitude, time: now };
      setLocationError('');
      void updateLocation({
        participantId: id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }).catch(() => setLocationError('Location sync failed. Check your connection and try again.'));
    }, error => {
      setLocationError(error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied. Allow location in your browser settings, then try again.'
        : error.code === error.POSITION_UNAVAILABLE ? 'Your device cannot determine a location right now.' : 'Location timed out. Move outdoors or try again.');
    }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [sharing, isActive, id, updateLocation]);

  // Already sharing with a hidden profile (made on the profile/events pages)? Show the name once, so you aren't
  // "someone" on the map and on badges. Only once per visit, so unticking it in Profile afterwards still sticks.
  const namedOnce = useRef(false);
  useEffect(() => {
    if (!sharing || !myProfile || myProfile.showOnMap || namedOnce.current) return;
    namedOnce.current = true;
    void saveMyProfile({ displayName: myProfile.displayName, headline: myProfile.headline, interests: myProfile.interests, showOnMap: true }).catch(() => {});
  }, [sharing, myProfile, saveMyProfile]);

  const toggleSharing = async () => {
    setBusy(true);
    setMessage('');
    setLocationError('');
    try {
      if (sharing) {
        sharingRef.current = false;
        setSharing(false);
        await stopLocation({ participantId: id });
        await leaveMap({ participantId: id });
      } else {
        if (!signedIn) {
          requestSignIn();
          return;
        }
        if (!navigator.geolocation) throw new Error("This browser doesn't support location. Try a modern browser on your phone.");
        lastSentRef.current = null;
        // A quick, coarse fix (cached up to 5 min, Wi-Fi accuracy is fine) so sharing starts in about a second instead
        // of waiting on a high-accuracy GPS fix; watchPosition refines it right after. (The badge's YES feels instant.)
        const first = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(
          resolve,
          error => reject(new Error(error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Allow location in your browser settings, then try again.'
            : error.code === error.POSITION_UNAVAILABLE ? 'Your device cannot determine a location right now.' : 'Location timed out. Move outdoors or try again.')),
          { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 },
        ));
        await setPresence({ participantId: id, zoneId: 'main-hall' });
        // Sharing your location shows your profile name on your dot, so people (and their badges) see who you are
        // instead of "someone". Profiles made on the profile/events pages start hidden, so switch them on here.
        if (myProfile && !myProfile.showOnMap) {
          void saveMyProfile({ displayName: myProfile.displayName, headline: myProfile.headline, interests: myProfile.interests, showOnMap: true })
            .catch(() => {});
        } else if (!myProfile) {
          void saveMyProfile({ displayName: accountName.trim().slice(0, 60) || 'Participant', headline: '', interests: '', showOnMap: true })
            .catch(() => {});
        }
        // Publish that first fix right away so your dot (and the badge) update now, not after the next GPS reading.
        if (first.coords.accuracy <= 10000) {
          lastSentRef.current = { lat: first.coords.latitude, lng: first.coords.longitude, time: Date.now() };
          void updateLocation({
            participantId: id,
            latitude: first.coords.latitude,
            longitude: first.coords.longitude,
            accuracyMeters: first.coords.accuracy,
          }).catch(() => setLocationError('Location sync failed. Check your connection and try again.'));
        }
        sharingRef.current = true;
        setSharing(true);
      }
    } catch (error) {
      if (!sharing) sharingRef.current = false;
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const connected = isActive;
  return <MapExperience myName={myProfile?.displayName || accountName} pins={pins} profileById={profileById} myId={id} loaded={loaded} connected={connected} signedIn={signedIn} sharing={sharing} busy={busy} message={message || locationError} onToggle={toggleSharing} onRequestSignIn={requestSignIn} authEnabled={authEnabled} accountName={accountName} areas={areas} />;
}

function AccountControl({ authEnabled, signedIn, accountName, onRequestSignIn }: {
  authEnabled: boolean; signedIn: boolean; accountName: string; onRequestSignIn: () => void;
}) {
  if (!authEnabled) {
    return <button className="sign-in-button" type="button" onClick={onRequestSignIn}>Sign up <span>OR</span> Log in</button>;
  }
  return signedIn
    ? <SignedInAccount accountName={accountName} />
    : <button className="sign-in-button" type="button" onClick={onRequestSignIn}>Sign up <span>OR</span> Log in</button>;
}

function SignedInAccount({ accountName }: { accountName: string }) {
  const { signOut } = useClerk();
  const [profileRows, profileLoaded] = useTable(tables.myProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const profile = profileRows[0];
  const name = profile?.displayName || accountName;
  return <>
    <div className="account-chip"><span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span><span className="account-name"><b>{name}</b><small>ACCOUNT</small></span><button className="profile-button" type="button" onClick={() => setProfileOpen(true)}>{profileLoaded && !profile ? 'Set up profile' : 'Profile'}</button><button className="sign-out" type="button" onClick={() => void signOut()}>Sign out</button></div>
    {profileOpen && <ProfileDialog initialProfile={profile} onClose={() => setProfileOpen(false)} />}
  </>;
}

function ProfileDialog({ initialProfile, onClose }: { initialProfile?: UserProfile; onClose: () => void }) {
  const [rows] = useTable(tables.myProfile);
  const saveProfile = useReducer(reducers.saveMyProfile);
  const profile = rows[0] ?? initialProfile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [headline, setHeadline] = useState(profile?.headline ?? '');
  const [interests, setInterests] = useState(profile?.interests ?? '');
  const [showOnMap, setShowOnMap] = useState(profile?.showOnMap ?? false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setHeadline(profile?.headline ?? '');
    setInterests(profile?.interests ?? '');
    setShowOnMap(profile?.showOnMap ?? false);
  }, [profile]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await saveProfile({ displayName, headline, interests, showOnMap });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile. Try again.');
    }
  };

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="demo-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>×</button>
      <span className="eyebrow">MHACKS ACCOUNT · PROFILE</span>
      <h2 id="profile-dialog-title">Your personal profile</h2>
      <p className="dialog-copy">Your profile is saved to SpacetimeDB. Email and password are never shown on the map.</p>
      <form onSubmit={submit}>
        <label htmlFor="profile-name">Display name</label>
        <input id="profile-name" autoFocus required maxLength={60} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="How should people know you?" />
        <label htmlFor="profile-headline">Headline <span>optional</span></label>
        <input id="profile-headline" maxLength={120} value={headline} onChange={event => setHeadline(event.target.value)} placeholder="What are you working on?" />
        <label htmlFor="profile-interests">Interests <span>optional</span></label>
        <input id="profile-interests" maxLength={180} value={interests} onChange={event => setInterests(event.target.value)} placeholder="AI, robotics, design…" />
        <label className="profile-visibility"><input type="checkbox" checked={showOnMap} onChange={event => setShowOnMap(event.target.checked)} /> Show this profile when people hover over my live map dot</label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="dialog-submit" type="submit">Save profile</button>
      </form>
    </section>
  </div>;
}

function AuthDialog({ onClose, authEnabled }: { onClose: () => void; authEnabled: boolean }) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  if (!authEnabled) {
    return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="demo-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-setup-title">
        <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        <span className="eyebrow">MHACKS ACCOUNT</span><h2 id="auth-setup-title">Account sign-in is being configured</h2>
        <p className="dialog-copy">The map is viewable now. Sign-up, profile saving, and live location sharing will be available after the team adds the Clerk and SpacetimeDB settings described in the setup guide.</p>
      </section>
    </div>;
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="demo-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
      <button className="dialog-close" type="button" aria-label="Close" onClick={onClose}>×</button>
      <span className="eyebrow">MHACKS ACCOUNT</span><h2 id="auth-dialog-title">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
      <div className="auth-tabs"><button className={mode === 'signup' ? 'active' : ''} type="button" onClick={() => setMode('signup')}>Sign up</button><button className={mode === 'signin' ? 'active' : ''} type="button" onClick={() => setMode('signin')}>Log in</button></div>
      <div className="clerk-form">{mode === 'signup' ? <SignUp routing="hash" signInUrl="/sign-in" /> : <SignIn routing="hash" signUpUrl="/sign-up" />}</div>
    </section>
  </div>;
}

function MapExperience({ myName = '', pins, profileById, myId, loaded, connected, signedIn, sharing, busy, message, onToggle, onRequestSignIn, authEnabled, accountName, preview = false, areas = [] }: {
  myName?: string; pins: LocationPin[]; profileById: Map<string, PublicMapProfile>; myId: string; loaded: boolean; connected: boolean; signedIn: boolean; sharing: boolean; busy: boolean; message: string; onToggle: () => void; onRequestSignIn: () => void; authEnabled: boolean; accountName: string; preview?: boolean; areas?: EventArea[];
}) {
  // mutuals: who's near you earns points (+10 nearby, +50 found) and levels; the FREE-WILi badge mirrors it all
  // and its YES / NO buttons work the share switch.
  const nameOf = (id: string) => profileById.get(id)?.displayName;
  const status = badgeStatus(pins, myId, sharing, nameOf);
  const score = usePoints();
  const { award } = score;
  const nearbyKey = status.nearbyIds.join(',');
  useEffect(() => {
    award(nearbyKey ? nearbyKey.split(',') : [], status.closestId, id => nameOf(id) ?? 'someone');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-score only when who is near changes
  }, [nearbyKey, status.closestId, award]);
  const { style } = useContext(StyleContext);
  const formal = style === 'formal';
  // Connections saved while someone's profile was hidden say "someone": swap in their real name once it's public.
  const { repairNames } = score;
  const profileKey = [...profileById.entries()].map(([id, p]) => `${id}:${p.displayName}`).join('|');
  useEffect(() => { repairNames(id => profileById.get(id)?.displayName); }, [profileKey, repairNames]);  // eslint-disable-line react-hooks/exhaustive-deps
  const badge = useBadge(status, { points: score.points, met: score.met }, myName || nameOf(myId) || '', formal,
    score.connections.map(c => nameOf(c.id) || c.name), button => {
    if (busy) return;
    if (button === 'green' && !sharing) onToggle();
    if (button === 'red' && sharing) onToggle();
  }, score.adopt, score.addRadioConnection);
  return <main className={`map-app style-${style}`}>
    <MapContainer center={DUDERSTADT} zoom={17} maxZoom={23} zoomSnap={.1} zoomDelta={.5} zoomControl={false} scrollWheelZoom className="leaflet-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} maxZoom={23} />
      <ZoomControl position="bottomright" />
      <EventAreaLayer areas={areas} homeLayout />
      <Marker position={DUDERSTADT} icon={venueIcon} interactive={false} />
      {pins.map(pin => {
        const profile = profileById.get(pin.participantId);
        const name = profile?.displayName || (pin.participantId === myId ? 'Your location' : 'Anonymous participant');
        return <Marker key={pin.participantId} position={[pin.latitude, pin.longitude]} icon={pinIcon(pin.participantId === myId)} title={name}>
          <Tooltip direction="top" offset={[0, -6]}>
            <span className="profile-tooltip"><b>{name}</b>{(profile?.headline || profile?.interests) && <small>{profile.headline || `Interests: ${profile.interests}`}</small>}</span>
          </Tooltip>
        </Marker>;
      })}
    </MapContainer>

    <header className="map-topbar"><a className="brand" href="/" aria-label="mutuals">{formal ? <b className="brand-text">mutuals</b> : <img className="brand-word" src="/mutuals/mutuals_word.png" alt="mutuals" />}<small>{formal ? 'PROFESSIONAL NETWORKING · MHACKS 2026' : 'PEOPLE FIND PEOPLE · MHACKS 2026'}</small></a><div className="topbar-actions"><a className="nav-link" href="/events">Events & assistants</a><a className="nav-link" href="/chat">My profile</a><StyleToggle /><div className={`connection ${connected ? 'online' : ''}`}><i />{preview ? 'Local preview' : connected ? 'Live sync' : 'Connecting'}</div><AccountControl authEnabled={authEnabled} signedIn={signedIn} accountName={accountName} onRequestSignIn={onRequestSignIn} /></div></header>

    <section className="map-card" aria-label="Live location sharing controls">
      <span className="eyebrow">DUDERSTADT CENTER · ANN ARBOR</span>
      <h1>Find people nearby.</h1>
      <p className="subhead">Find people nearby. Hover over a dot to see the name and short profile they've chosen to share.</p>
      <PointsCard {...score} formal={formal} />
      <ConnectionsList connections={score.connections.map(c => ({ ...c, name: nameOf(c.id) || c.name }))} formal={formal} />
      <div className="count-line"><span className="count-number">{loaded ? pins.length : '—'}</span><span>people sharing location</span><i className="count-live" /></div>
      <button className={`share-button${sharing ? ' sharing' : ''}`} type="button" role={signedIn || preview ? 'switch' : undefined} aria-checked={signedIn || preview ? sharing : undefined} disabled={busy || (!connected && !preview)} onClick={onToggle}>
        <span className="switch-dot" />{busy ? 'Updating…' : sharing ? 'Stop sharing my location' : preview ? 'Preview my location' : signedIn ? 'Share my live location' : 'Sign in to share your location'}
      </button>
      <div className="consent"><span aria-hidden="true">◉</span><p>{preview ? <>In local preview, your <strong>GPS location</strong> appears only in this browser and isn't synced to the cloud.</> : signedIn ? <>When enabled, your <strong>exact GPS location</strong> and your <strong>profile name</strong> are visible to everyone viewing this map, so people (and their mutuals badges) know who's nearby.</> : <>Anyone can view this map. <strong>Sign in</strong> before sharing your own live location or saving a profile.</>}</p></div>
      {sharing && <p className="sharing-status">{message || (preview ? 'Local preview: your location is not sent to anyone.' : "Waiting for your phone's location… The first fix may take a few seconds.")}</p>}
      {!sharing && message && <p className="error-message" role="alert">{message}</p>}
      {!signedIn && !preview && <button className="profile-link" type="button" onClick={onRequestSignIn}>Sign up or log in to share your location</button>}
      <BadgeControl status={status} formal={formal} needsSignIn={!signedIn && !preview} problem={message} {...badge} />
      {score.gain && <div className="points-toast" key={score.gain.at}>+{score.gain.points} pts · {gainText(score.gain, formal)}</div>}
    </section>

    <div className="map-bottom"><span>Hover over a dot for a profile · Indoor GPS may drift</span><span>Map data &copy; OpenStreetMap</span></div>
  </main>;
}

const BADGE_TEXT: Record<BadgeStatus['state'], [cute: string, formal: string]> = {
  H: ['Not discoverable', 'Private mode'],
  A: ['Looking… nobody near yet', 'Searching nearby'],
  N: ["Someone's nearby!", 'Contact nearby'],
  C: ['You found them!', 'Connection made'],
  Q: ['Someone wants to meet!', 'Connection request'],
};

const BUTTON_LABEL = { gray: 'MENU', yellow: 'BACK', green: 'YES', blue: 'NEXT', red: 'NO' } as const;

function pressResult(button: keyof typeof BUTTON_LABEL, status: BadgeStatus, needsSignIn: boolean): string {
  if (button === 'green') {
    if (status.state !== 'H') return 'already sharing';
    return needsSignIn ? 'sign in first (sign-in box opened)' : 'turning on location sharing…';
  }
  if (button === 'red') return status.state === 'H' ? 'already hidden' : 'stopping location sharing';
  return 'no action on the website';
}

function gainText(gain: Gain, formal: boolean): string {
  if (gain.kind === 'badge') return formal ? 'synced from your badge' : 'from your badge';
  if (gain.kind === 'found') return formal ? `Connection made: ${gain.who}` : `you found ${gain.who}!`;
  return formal ? `Contact nearby: ${gain.who}` : `${gain.who} is nearby`;
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function ConnectionsList({ connections, formal }: { connections: Connection[]; formal: boolean }) {
  const [open, setOpen] = useState(false);
  if (!connections.length) return <p className="connections-empty">{formal ? 'Connections you make appear here.' : 'People you find show up here 🐾'}</p>;
  const shown = open ? connections : connections.slice(0, 3);
  return <div className="connections">
    <div className="connections-head"><b>{formal ? 'Connections' : 'Your mutuals'}</b><span>{connections.length}</span></div>
    <ul>
      {shown.map(c => <li key={c.id}>
        <span className="connection-avatar" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
        <span className="connection-name">{c.name}</span>
        <small>{c.via === 'radio' ? (formal ? 'in person (radio)' : '📡 badge') : c.via === 'event' ? (formal ? 'event connection' : '🤝 event') : (formal ? 'via map' : '📍 map')} · {ago(c.at)}</small>
      </li>)}
    </ul>
    {connections.length > 3 && <button type="button" className="connections-more" onClick={() => setOpen(!open)}>{open ? 'Show less' : `Show all ${connections.length}`}</button>}
  </div>;
}

function StyleToggle() {
  const { style, setStyle } = useContext(StyleContext);
  return <div className="style-toggle" role="radiogroup" aria-label="Event style">
    <button type="button" role="radio" aria-checked={style === 'cute'} className={style === 'cute' ? 'on' : ''} onClick={() => setStyle('cute')} title="Clubs, university mixers">✿ Cute</button>
    <button type="button" role="radio" aria-checked={style === 'formal'} className={style === 'formal' ? 'on' : ''} onClick={() => setStyle('formal')} title="Recruiting events">Formal</button>
  </div>;
}

function PointsCard({ points, level, progress, met, formal }: ReturnType<typeof usePoints> & { formal: boolean }) {
  const next = LEVEL_AT[level];
  const unit = formal ? 'Tier' : 'Lv';
  return <div className="points-card">
    {formal ? <span className="points-tier" aria-hidden="true">T{level}</span> : <img className="points-pup" src={`/mutuals/lv${level}.png`} alt={`Level ${level} pup`} />}
    <div className="points-body">
      <div className="points-row">{!formal && <span className="points-star" aria-hidden="true">★</span>}<b>{points}</b><span>pts</span><span className="points-level">{unit} {level}</span></div>
      <div className="points-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <small>{(formal ? TIER_NAME : LEVEL_NAME)[level - 1]} · {met} {formal ? 'connections' : 'met'}{next !== undefined ? ` · ${next - points} pts to ${unit} ${level + 1}` : ''}</small>
    </div>
  </div>;
}

function BadgeControl({ status, formal, needsSignIn, problem, connected, connect, disconnect, error, radio, lastButton }: { status: BadgeStatus; formal: boolean; needsSignIn: boolean; problem: string } & ReturnType<typeof useBadge>) {
  if (!badgeSupported()) return null; // Web Serial: Chrome / Edge on a computer
  return <div className={`badge-control${connected ? ' on' : ''}`}>
    <span className="badge-icon" aria-hidden="true">{formal ? '◧' : '🐶'}</span>
    <div className="badge-copy">
      <b>{connected ? 'mutuals badge connected' : formal ? 'mutuals badge' : 'mutuals FREE-WILi badge'}</b>
      {connected && lastButton && <small className="badge-press">{BUTTON_LABEL[lastButton.button]} pressed on the badge → {pressResult(lastButton.button, status, needsSignIn)}</small>}
      {connected && needsSignIn && <small className="badge-warn">Sign up or log in first (top right). Until then, YES on the badge opens the sign-in box instead of sharing.</small>}
      {connected && !needsSignIn && status.state === 'H' && problem && <small className="badge-warn">{problem}</small>}
      {connected && radio && <small className="badge-radio">📡 Radio: {radio.name || 'a mutuals badge'} is {radio.rssi >= -50 ? (formal ? 'in person' : 'right here') : 'nearby'} ({radio.rssi} dBm){radio.count > 1 ? ` · ${radio.count} badges` : ''}</small>}
      <small>{error || (connected ? `${BADGE_TEXT[status.state][formal ? 1 : 0]}${status.state === 'N' || status.state === 'C' ? ` · ${status.name} · ${status.meters} m` : ''} · YES share · NO hide · MENU stats` : (formal ? 'Plug in your badge: your score and nearby contacts on its screen' : 'Plug in your badge: your pup, points and who is near you, on its screen'))}</small>
    </div>
    <button type="button" onClick={() => void (connected ? disconnect() : connect())}>{connected ? 'Disconnect' : 'Connect'}</button>
  </div>;
}

function PreviewMap() {
  const [sharing, setSharing] = useState(false);
  const [pin, setPin] = useState<LocationPin | null>(null);
  const id = 'local-preview';
  const requestSignIn = useContext(AuthDialogContext);
  useEffect(() => {
    if (!sharing || !navigator.geolocation) return;
    const watcher = navigator.geolocation.watchPosition(position => setPin({ participantId: id, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }), () => {}, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [sharing, id]);
  const demo = useDemoWalkers(pin);
  return <MapExperience pins={pin ? [pin, ...demo.pins] : []} profileById={demo.profiles} myId={id} loaded connected={false} signedIn={false} sharing={sharing} busy={false} message="" preview onToggle={() => setSharing(value => !value)} onRequestSignIn={requestSignIn} authEnabled={false} accountName="Your account" />;
}

// Local preview with ?demo in the URL: two pretend people near your pin, one walking up to you over ~40 s, so the
// FREE-WILi badge can show "someone's nearby!" → "they're right here!" without a second phone. Preview only.
const DEMO_WALKERS = [
  { participantId: 'demo-walker-alex', displayName: 'Alex', from: 140, to: 8, bearing: 40 },
  { participantId: 'demo-walker-sam', displayName: 'Sam', from: 95, to: 95, bearing: 220 },
];

function useDemoWalkers(me: LocationPin | null) {
  const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
  const startRef = useRef<number | null>(null); // the walk starts when your own pin first appears
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  const profiles = new Map<string, PublicMapProfile>(DEMO_WALKERS.map(w => [w.participantId, { displayName: w.displayName, headline: 'Demo walker', interests: '' }]));
  if (!enabled || !me) { startRef.current = null; return { pins: [] as LocationPin[], profiles }; }
  startRef.current ??= now;
  const progress = Math.min(1, ((now - startRef.current) / 1000) / 40);
  const pins = DEMO_WALKERS.map(w => {
    const meters = w.from + (w.to - w.from) * progress;
    const rad = (w.bearing * Math.PI) / 180;
    return {
      participantId: w.participantId,
      latitude: me.latitude + (meters * Math.cos(rad)) / 111_320,
      longitude: me.longitude + (meters * Math.sin(rad)) / (111_320 * Math.cos((me.latitude * Math.PI) / 180)),
      accuracyMeters: 6,
    };
  });
  return { pins, profiles };
}

export default function App({ live, authEnabled, signedIn, accountName = 'Your account', getApiToken = noToken }: { live: boolean; authEnabled: boolean; signedIn: boolean; accountName?: string; getApiToken?: () => Promise<string | null> }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [style, setStyleState] = useState<Style>(loadStyle);
  const setStyle = (next: Style) => {
    setStyleState(next);
    try { localStorage.setItem(STYLE_KEY, next); } catch { /* private mode: lasts this visit */ }
  };
  const requestSignIn = () => setAuthOpen(true);
  useEffect(() => {
    if (signedIn) setAuthOpen(false);
  }, [signedIn]);
  return <StyleContext.Provider value={{ style, setStyle }}><AuthDialogContext.Provider value={requestSignIn}>
    <SignedInContext.Provider value={signedIn}>
      {['/events', '/assistant'].includes(window.location.pathname.replace(/\/$/, '')) && live
        ? <NetworkingWorkspace signedIn={signedIn} accountName={accountName} onSignIn={requestSignIn} accountControl={<AccountControl authEnabled={authEnabled} signedIn={signedIn} accountName={accountName} onRequestSignIn={requestSignIn} />} />
        : window.location.pathname.replace(/\/$/, '') === '/chat'
        ? live ? <LiveProfileChat signedIn={signedIn} accountName={accountName} getToken={getApiToken} onSignIn={requestSignIn} accountControl={<AccountControl authEnabled={authEnabled} signedIn={signedIn} accountName={accountName} onRequestSignIn={requestSignIn} />} />
          : <ProfileChat signedIn={false} accountName={accountName} api={previewProfileApi} onSignIn={requestSignIn} />
        : live ? <LiveMapContent authEnabled={authEnabled} accountName={accountName} /> : <PreviewMap />}
      {authOpen && <AuthDialog authEnabled={authEnabled} onClose={() => setAuthOpen(false)} />}
    </SignedInContext.Provider>
  </AuthDialogContext.Provider></StyleContext.Provider>;
}

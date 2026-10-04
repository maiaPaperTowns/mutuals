import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

// Issuer and audience from the MHacks Clerk SpacetimeDB JWT template.
const CLERK_ISSUER = 'https://novel-griffon-9073.clerk.accounts.dev';
const CLERK_AUDIENCE = 'mhacks-live-map';

const ZONES = [
  'main-hall',
  'sponsor-row',
  'workshop',
  'lounge',
  'food-court',
  'demo-stage',
] as const;

const presence = table(
  { name: 'presence', public: true },
  {
    participantId: t.string().primaryKey(),
    zoneId: t.string().index('btree'),
    isDemoPersona: t.bool(),
  },
);

const participantOwner = table(
  { name: 'participant_owner' },
  {
    participantId: t.string().primaryKey(),
    ownerIdentity: t.identity().unique(),
  },
);

const liveLocation = table(
  { name: 'live_location', public: true },
  {
    participantId: t.string().primaryKey(),
    latitude: t.f64(),
    longitude: t.f64(),
    accuracyMeters: t.f64(),
    updatedAt: t.timestamp(),
  },
);

const userProfile = table(
  { name: 'user_profile', public: false },
  {
    identity: t.identity().primaryKey(),
    displayName: t.string(),
    headline: t.string(),
    interests: t.string(),
    showOnMap: t.bool().index('btree'),
    updatedAt: t.timestamp(),
  },
);

const publicProfile = t.row('PublicProfile', {
  participantId: t.string().primaryKey(),
  displayName: t.string(),
  headline: t.string(),
  interests: t.string(),
});

const spacetimedb = schema({ presence, participantOwner, liveLocation, userProfile });
export default spacetimedb;

function assertZone(zoneId: string): void {
  if (!ZONES.includes(zoneId as (typeof ZONES)[number])) {
    throw new SenderError('Choose a valid map zone.');
  }
}

type ModuleContext = ReducerCtx<InferSchema<typeof spacetimedb>>;

function assertOwner(ctx: ModuleContext, participantId: string): void {
  const owner = ctx.db.participantOwner.participantId.find(participantId);
  if (!owner || owner.ownerIdentity.toHexString() !== ctx.sender.toHexString()) {
    throw new SenderError('This anonymous map pin belongs to another participant.');
  }
}

function requireClerkUser(ctx: ModuleContext): void {
  const jwt = ctx.senderAuth.jwt;
  if (!jwt || jwt.issuer !== CLERK_ISSUER || !jwt.audience.includes(CLERK_AUDIENCE)) {
    throw new SenderError('Sign in with your MHacks account before sharing or saving a profile.');
  }
}

export const myProfile = spacetimedb.view(
  { name: 'my_profile', public: true },
  t.option(userProfile.rowType),
  (ctx) => ctx.db.userProfile.identity.find(ctx.sender) ?? undefined,
);

export const publicProfiles = spacetimedb.anonymousView(
  { name: 'public_profiles', public: true },
  t.array(publicProfile),
  (ctx) => Array.from(ctx.db.userProfile.showOnMap.filter(true))
    .filter((profile) => ctx.db.liveLocation.participantId.find(profile.identity.toHexString()))
    .map((profile) => ({
      participantId: profile.identity.toHexString(),
      displayName: profile.displayName,
      headline: profile.headline,
      interests: profile.interests,
    })),
);

export const saveMyProfile = spacetimedb.reducer(
  {
    displayName: t.string(),
    headline: t.string(),
    interests: t.string(),
    showOnMap: t.bool(),
  },
  (ctx, { displayName, headline, interests, showOnMap }) => {
    requireClerkUser(ctx);
    const name = displayName.trim();
    const title = headline.trim();
    const topics = interests.trim();
    if (name.length < 1 || name.length > 60 || title.length > 120 || topics.length > 180) {
      throw new SenderError('Keep your name under 60 characters, headline under 120, and interests under 180.');
    }
    const row = {
      identity: ctx.sender,
      displayName: name,
      headline: title,
      interests: topics,
      showOnMap,
      updatedAt: ctx.timestamp,
    };
    const existing = ctx.db.userProfile.identity.find(ctx.sender);
    if (existing) ctx.db.userProfile.identity.update(row);
    else ctx.db.userProfile.insert(row);
  },
);

export const setMyPresence = spacetimedb.reducer(
  { participantId: t.string(), zoneId: t.string() },
  (ctx, { participantId, zoneId }) => {
    requireClerkUser(ctx);
    assertZone(zoneId);
    if (participantId !== ctx.sender.toHexString()) {
      throw new SenderError('Use your signed-in account identity for your map pin.');
    }
    if (participantId.length < 16 || participantId.length > 80) {
      throw new SenderError('Invalid anonymous participant ID.');
    }

    const owner = ctx.db.participantOwner.participantId.find(participantId);
    if (owner) {
      assertOwner(ctx, participantId);
    } else {
      const existingIdentity = ctx.db.participantOwner.ownerIdentity.find(ctx.sender);
      if (existingIdentity) {
        throw new SenderError('This browser already has an anonymous map ID. Reload and try again.');
      }
      ctx.db.participantOwner.insert({ participantId, ownerIdentity: ctx.sender });
    }

    const existing = ctx.db.presence.participantId.find(participantId);
    if (existing?.isDemoPersona) {
      throw new SenderError('That ID is reserved for a demo persona.');
    }
    if (existing) {
      ctx.db.presence.participantId.update({ ...existing, zoneId });
    } else {
      ctx.db.presence.insert({ participantId, zoneId, isDemoPersona: false });
    }
  },
);

export const leaveMap = spacetimedb.reducer(
  { participantId: t.string() },
  (ctx, { participantId }) => {
    requireClerkUser(ctx);
    assertOwner(ctx, participantId);
    const row = ctx.db.presence.participantId.find(participantId);
    if (row && !row.isDemoPersona) {
      ctx.db.presence.participantId.delete(participantId);
    }
  },
);

export const updateMyLocation = spacetimedb.reducer(
  {
    participantId: t.string(),
    latitude: t.f64(),
    longitude: t.f64(),
    accuracyMeters: t.f64(),
  },
  (ctx, { participantId, latitude, longitude, accuracyMeters }) => {
    requireClerkUser(ctx);
    if (participantId !== ctx.sender.toHexString()) {
      throw new SenderError('Use your signed-in account identity for your map pin.');
    }
    assertOwner(ctx, participantId);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 10000
    ) {
      throw new SenderError('Invalid location update.');
    }

    const row = {
      participantId,
      latitude,
      longitude,
      accuracyMeters,
      updatedAt: ctx.timestamp,
    };
    const existing = ctx.db.liveLocation.participantId.find(participantId);
    if (existing) ctx.db.liveLocation.participantId.update(row);
    else ctx.db.liveLocation.insert(row);
  },
);

export const stopSharingLocation = spacetimedb.reducer(
  { participantId: t.string() },
  (ctx, { participantId }) => {
    requireClerkUser(ctx);
    assertOwner(ctx, participantId);
    ctx.db.liveLocation.participantId.delete(participantId);
  },
);

export const clientDisconnected = spacetimedb.clientDisconnected((ctx) => {
  const owner = ctx.db.participantOwner.ownerIdentity.find(ctx.sender);
  if (owner) ctx.db.liveLocation.participantId.delete(owner.participantId);
});

const DEMO_SEEDS = [
  ['demo-01', 'main-hall'],
  ['demo-02', 'main-hall'],
  ['demo-03', 'main-hall'],
  ['demo-04', 'sponsor-row'],
  ['demo-05', 'sponsor-row'],
  ['demo-06', 'sponsor-row'],
  ['demo-07', 'workshop'],
  ['demo-08', 'workshop'],
  ['demo-09', 'workshop'],
  ['demo-10', 'lounge'],
  ['demo-11', 'lounge'],
  ['demo-12', 'food-court'],
  ['demo-13', 'food-court'],
  ['demo-14', 'demo-stage'],
  ['demo-15', 'demo-stage'],
] as const;

export const init = spacetimedb.init((ctx) => {
  for (const [participantId, zoneId] of DEMO_SEEDS) {
    if (!ctx.db.presence.participantId.find(participantId)) {
      ctx.db.presence.insert({ participantId, zoneId, isDemoPersona: true });
    }
  }
});

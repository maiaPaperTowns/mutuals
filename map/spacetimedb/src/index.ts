import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

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

const spacetimedb = schema({ presence, participantOwner, liveLocation });
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

export const setMyPresence = spacetimedb.reducer(
  { participantId: t.string(), zoneId: t.string() },
  (ctx, { participantId, zoneId }) => {
    assertZone(zoneId);
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

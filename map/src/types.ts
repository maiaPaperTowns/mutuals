export const ZONES = [
  { id: 'main-hall', label: 'Main Hall', short: 'HALL', x: 78, y: 86, w: 312, h: 194, tone: 'sage' },
  { id: 'sponsor-row', label: 'Sponsor Row', short: 'SPONSORS', x: 500, y: 62, w: 378, h: 184, tone: 'coral' },
  { id: 'workshop', label: 'Workshop Zone', short: 'WORKSHOP', x: 550, y: 328, w: 328, h: 178, tone: 'blue' },
  { id: 'lounge', label: 'Lounge', short: 'LOUNGE', x: 312, y: 360, w: 198, h: 146, tone: 'yellow' },
  { id: 'food-court', label: 'Food Court', short: 'FOOD', x: 78, y: 374, w: 188, h: 132, tone: 'lavender' },
  { id: 'demo-stage', label: 'Demo Stage', short: 'STAGE', x: 375, y: 124, w: 76, h: 128, tone: 'mint' },
] as const;

export type ZoneId = (typeof ZONES)[number]['id'];

export type Presence = {
  participantId: string;
  zoneId: string;
  isDemoPersona: boolean;
};

export const DEMO_PERSONAS: Presence[] = [
  ['demo-01', 'main-hall'], ['demo-02', 'main-hall'], ['demo-03', 'main-hall'],
  ['demo-04', 'sponsor-row'], ['demo-05', 'sponsor-row'], ['demo-06', 'sponsor-row'],
  ['demo-07', 'workshop'], ['demo-08', 'workshop'], ['demo-09', 'workshop'],
  ['demo-10', 'lounge'], ['demo-11', 'lounge'], ['demo-12', 'food-court'],
  ['demo-13', 'food-court'], ['demo-14', 'demo-stage'], ['demo-15', 'demo-stage'],
].map(([participantId, zoneId]) => ({ participantId, zoneId, isDemoPersona: true }));

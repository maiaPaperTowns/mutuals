import { expect, it } from 'vitest';
import { mapHeadline } from '../spacetimedb/src/mapProfile';

it('reuses the saved headline without exposing other profile fields', () => {
  expect(mapHeadline({ headline: '  Builds robots.  ', resume_text: 'Private resume', goals: ['Private goal'] })).toBe('Builds robots.');
});

it('keeps absent or invalid headlines empty', () => {
  for (const profile of [undefined, null, {}, { headline: null }, { headline: 4 }, { headline: '   ' }]) expect(mapHeadline(profile)).toBe('');
});

it('keeps long headlines compact', () => {
  const result = mapHeadline({ headline: 'a'.repeat(200) });
  expect(result).toHaveLength(140);
  expect(result.endsWith('…')).toBe(true);
});

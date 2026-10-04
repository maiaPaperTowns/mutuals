import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('SpacetimeDB ROI calculations match the existing Python formula', async () => {
  const { scoreNetworking } = await import('../../../map/spacetimedb/src/networking.ts');
  const cases = JSON.parse(readFileSync(new URL('./roi-parity.json', import.meta.url), 'utf8'));
  for (const item of cases) {
    const result = scoreNetworking(item.user, item.target, item.context);
    assert.equal(result.score, item.expected.score, item.name);
    assert.deepEqual(result.breakdown, item.expected.breakdown, item.name);
    assert.equal(result.reason, item.expected.reason, item.name);
  }
});

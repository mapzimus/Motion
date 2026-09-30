// Node unit check for the vessel (marine) region filter. Runs in `npm run check`.
// The "should pass" points are real vessels a live 5-minute AIS sample dropped
// even though they were in New England waters.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containsPoint, registerRegions } from '../js/regions.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const marineRaw = readFileSync(new URL('../data/regions-marine.geojson', import.meta.url));
registerRegions(read('regions.geojson'), JSON.parse(marineRaw));

const MAX_MARINE_BYTES = 300 * 1024;
assert.ok(marineRaw.length < MAX_MARINE_BYTES, `regions-marine.geojson is ${marineRaw.length} bytes`);

const inNewEnglandWaters = [
  [42.254, -70.927, 'Hingham Bay'],
  [42.293, -70.945, 'Hingham Bay north'],
  [42.291, -70.886, 'Hull Gut'],
  [42.265, -70.923, 'Hingham Bay south'],
  [42.283, -70.69, 'Massachusetts Bay off Scituate'],
  [42.524, -70.873, 'Salem Sound'],
  [42.42, -70.74, 'Nahant Bay offshore'],
  [42.521, -70.881, 'Salem Harbor'],
  [42.43, -70.426, 'Massachusetts Bay anchorage'],
];
const outsideNewEngland = [
  [45.5, -73.55, 'Montreal'],
  [40.7, -74.02, 'New York Harbor'],
];

let checks = 0;
for (const [lat, lng, label] of inNewEnglandWaters) {
  for (const region of ['ma', 'new-england']) {
    assert.ok(containsPoint(region, [lng, lat], { marine: true }), `${label} should pass the ${region} vessel filter`);
    checks += 1;
  }
}
for (const [lat, lng, label] of outsideNewEngland) {
  assert.ok(!containsPoint('new-england', [lng, lat], { marine: true }), `${label} must not pass the new-england vessel filter`);
  checks += 1;
}
// The MBTA core uses a tighter buffer that still reaches the inner harbor islands.
for (const [lat, lng, label] of inNewEnglandWaters.slice(0, 4)) {
  assert.ok(containsPoint('boston', [lng, lat], { marine: true }), `${label} should pass the boston vessel filter`);
  assert.ok(!containsPoint('boston', [lng, lat]), `${label} is outside the boston land boundary`);
  checks += 2;
}
// Land filtering for other fleets is unchanged: the anchorage is off the land/state polygon.
assert.ok(!containsPoint('ma', [-70.426, 42.43]), 'land filter should still exclude the offshore anchorage');
checks += 1;

console.log(`Marine region filter: ${checks} checks passed (${(marineRaw.length / 1024).toFixed(0)} KB)`);

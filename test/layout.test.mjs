import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as spatial from '../public/js/spatial.js';

// Captured before extracting the kitchen layout. Includes exact floating-point
// values so a cosmetic refactor cannot silently shift server interaction boxes.
const baseline = JSON.parse(readFileSync(new URL('./fixtures/kitchen-layout-baseline.json', import.meta.url)));
for (const [name, expected] of Object.entries(baseline)) {
  test(`layout characterization: ${name}`, () => assert.deepEqual(spatial[name], expected));
}

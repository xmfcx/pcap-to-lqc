import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultCalibrationModule } from '../scripts/default-calibration.mjs';
import { parseCalibration, standardFiringCsv } from '../site/lib/calibration.js';

test('bundled defaults preserve both reference files and match standard model timing', async () => {
  const source = await defaultCalibrationModule();
  const { DEFAULT_CALIBRATION: defaults } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const entry of Object.values(defaults)) {
    const original = await readFile(new URL(`../calibration/XT32M2X/${entry.name}`, import.meta.url));
    assert.deepEqual(Buffer.from(entry.text, 'utf8'), original);
  }
  const actual = parseCalibration(defaults.angle.text, defaults.firing.text);
  assert.equal(actual.length, 32);
  const standard = parseCalibration(defaults.angle.text, standardFiringCsv());
  assert.deepEqual(actual.map(c => c.fireUs), standard.map(c => c.fireUs));
});

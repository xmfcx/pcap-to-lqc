import { readFile } from 'node:fs/promises';
import { parseCalibration } from '../site/lib/calibration.js';

// The reference CSVs are the single source of truth for the bundled defaults.
// Embed their original UTF-8 contents so browser reports retain their file hashes.
export async function defaultCalibrationModule() {
  const root = new URL('../calibration/XT32M2X/', import.meta.url);
  const [angleText, firingText] = await Promise.all([
    readFile(new URL('sample-angle-correction.csv', root), 'utf8'),
    readFile(new URL('firetime-correction.csv', root), 'utf8'),
  ]);
  parseCalibration(angleText, firingText);
  const defaults = {
    angle: { name: 'sample-angle-correction.csv', text: angleText },
    firing: { name: 'firetime-correction.csv', text: firingText },
  };
  return '// Generated from calibration/XT32M2X/; edit the CSVs instead.\n' +
    `export const DEFAULT_CALIBRATION = ${JSON.stringify(defaults, null, 2)};\n`;
}

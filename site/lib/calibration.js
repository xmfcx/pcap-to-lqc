function rows(text, columns, label) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length !== 33) throw new Error(`${label}: expected a header and exactly 32 channel rows.`);
  const header = lines.shift().split(',').map(s => s.trim().toLowerCase());
  if (header.length !== columns.length || header.some((h, i) => h !== columns[i])) {
    throw new Error(`${label}: expected CSV header ${columns.join(',')}.`);
  }
  const result = new Array(32);
  for (const line of lines) {
    const cells = line.split(',').map(s => s.trim());
    if (cells.length !== columns.length || cells.some(s => s === '')) throw new Error(`${label}: invalid CSV row.`);
    const values = cells.map(Number);
    const channel = values[0];
    if (!values.every(Number.isFinite) || !Number.isInteger(channel) || channel < 1 || channel > 32 || result[channel - 1]) {
      throw new Error(`${label}: channels must be unique integers from 1 to 32 with finite numeric values.`);
    }
    result[channel - 1] = values.slice(1);
  }
  return result;
}

export function parseCalibration(angleText, firingText) {
  const angles = rows(angleText, ['channel', 'elevation', 'azimuth'], 'Angle calibration');
  const times = rows(firingText, ['channel', 'fire time(us)'], 'Firing calibration');
  return angles.map(([elevation, azimuth], i) => {
    const fireUs = times[i][0];
    if (Math.abs(elevation) > 90 || Math.abs(azimuth) > 180 || fireUs < 0 || fireUs >= 50) {
      throw new Error(`Calibration channel ${i + 1}: angle or firing offset is outside the XT32M2X range.`);
    }
    return { elevation, azimuth, fireUs, sinElevation: Math.sin(elevation * Math.PI / 180), cosElevation: Math.cos(elevation * Math.PI / 180) };
  });
}

export function standardFiringCsv() {
  return 'Channel,fire time(us)\n' + Array.from({ length: 32 }, (_, i) => `${i + 1},${(6 + 2.888 * (i % 16)).toFixed(3)}`).join('\n');
}

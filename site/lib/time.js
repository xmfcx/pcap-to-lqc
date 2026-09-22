export const GPS_EPOCH = Date.UTC(1980, 0, 6) / 1000;
export const WEEK_SECONDS = 604800;
// UTC effective dates of GPS-UTC steps. IERS Bulletin C 72 confirms no new
// leap second through 2026-12-31. Future dates require an explicit offset.
const LEAPS = [
  '1981-07-01', '1982-07-01', '1983-07-01', '1985-07-01', '1988-01-01',
  '1990-01-01', '1991-01-01', '1992-07-01', '1993-07-01', '1994-07-01',
  '1996-01-01', '1997-07-01', '1999-01-01', '2006-01-01', '2009-01-01',
  '2012-07-01', '2015-07-01', '2017-01-01',
].map(d => Date.parse(`${d}T00:00:00Z`) / 1000);
const VALID_UNTIL = Date.UTC(2027, 0, 1) / 1000;

export function gpsOffset(sensorSeconds, scale, customOffset = 0) {
  if (scale === 'gps') return 0;
  if (scale === 'tai') return -19;
  if (scale === 'custom') {
    if (!Number.isFinite(customOffset) || Math.abs(customOffset) > 86400) throw new Error('GPS minus sensor offset must be a finite number within ±86400 seconds.');
    return customOffset;
  }
  if (scale !== 'utc') throw new Error('Select the sensor clock time scale before converting.');
  if (sensorSeconds < GPS_EPOCH || sensorSeconds >= VALID_UNTIL) throw new Error('UTC date is outside the leap-second table (1980–2026). Verify the sensor date or use a verified custom GPS offset.');
  let offset = 0;
  for (const effective of LEAPS) if (sensorSeconds >= effective) offset++;
  return offset;
}

export function gpsTime(sensorWholeSeconds, fractionalSeconds, scale, customOffset = 0) {
  // Subtract the epoch before adding sub-second firing offsets to retain precision.
  const base = sensorWholeSeconds - GPS_EPOCH + gpsOffset(sensorWholeSeconds + fractionalSeconds, scale, customOffset);
  const week = Math.floor((base + fractionalSeconds) / WEEK_SECONDS);
  if (week < 0) throw new Error('Sensor timestamp is before the GPS epoch.');
  return { week, seconds: base - week * WEEK_SECONDS + fractionalSeconds };
}

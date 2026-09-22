const RETURNS = new Map([[0x33, 1], [0x37, 1], [0x38, 1], [0x39, 2], [0x3b, 2], [0x3c, 2], [0x3d, 3]]);
export const RETURN_NAMES = { 0x33: 'First', 0x37: 'Strongest', 0x38: 'Last', 0x39: 'Last + strongest', 0x3b: 'First + last', 0x3c: 'First + strongest', 0x3d: 'First + last + strongest' };

export function packetInfo(payload) {
  if (payload.length < 2 || payload[0] !== 0xee || payload[1] !== 0xff) return null;
  if (payload.length < 12 || payload[2] !== 6 || payload[3] !== 1 || payload[6] !== 32 || payload[7] !== 6 || payload[9] !== 5 || payload[10] !== 3) {
    throw new Error('Unsupported Hesai packet. This converter requires XT32M2X protocol 6.1, 32 channels, six blocks, and 5 mm ranges.');
  }
  const sequencePresent = !!(payload[11] & 1);
  if (payload.length !== (sequencePresent ? 820 : 816)) throw new Error('Unexpected XT32M2X packet length.');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const tail = 792, mode = payload[tail + 10], returns = RETURNS.get(mode);
  if (!returns) throw new Error(`Unsupported return mode 0x${mode.toString(16)}.`);
  const rpm = view.getUint16(tail + 11, true);
  if (rpm < 250 || rpm > 1250) throw new Error(`Unexpected motor speed ${rpm} RPM; expected nominal 300, 600, or 1200 RPM.`);
  const [yearByte, month, day, hour, minute, second] = payload.subarray(tail + 13, tail + 19);
  const year = 1900 + yearByte;
  const wholeSeconds = Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
  const date = new Date(wholeSeconds * 1000);
  if (year < 1980 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Invalid sensor calendar timestamp. Check the sensor clock; leap-second packets are not supported.');
  }
  const microseconds = view.getUint32(tail + 19, true);
  if (microseconds >= 1000000) throw new Error('Invalid sensor microsecond timestamp.');
  const azimuths = Array.from({ length: 6 }, (_, b) => view.getUint16(12 + b * 130, true));
  if (azimuths.some(a => a >= 36000)) throw new Error('Invalid block azimuth.');
  for (let b = 0; b < 6; b += returns) {
    for (let r = 1; r < returns; r++) if (azimuths[b + r] !== azimuths[b]) throw new Error('Multi-return blocks have inconsistent azimuths.');
  }
  return { view, mode, returns, rpm, wholeSeconds, microseconds, azimuths, sequence: sequencePresent ? view.getUint32(816, true) : null };
}

export function makeGeometry(calibration, rpm, rotation) {
  return calibration.map(c => {
    const delta = (c.azimuth + rotation * rpm * 6 * c.fireUs / 1e6) * Math.PI / 180;
    return { ...c, sinDelta: Math.sin(delta), cosDelta: Math.cos(delta) };
  });
}

// Manual §3.1.4 and Appendix B. The range is used as documented; optional
// SDK optical-center/spot corrections and trajectory transforms are not applied.
export function decodePoints(info, geometry, emit, stats, baseTime) {
  const { view, returns, azimuths } = info;
  const ranges = [0, 0, 0], intensities = [0, 0, 0];
  for (let block = 0; block < 6; block += returns) {
    const az = azimuths[block] * Math.PI / 18000;
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    const blockSeconds = -50 * ((6 - block) / returns - 1) / 1e6;
    for (let channel = 0; channel < 32; channel++) {
      let count = 0;
      for (let r = 0; r < returns; r++) {
        const offset = 14 + (block + r) * 130 + channel * 4;
        const range = view.getUint16(offset, true), intensity = view.getUint8(offset + 2);
        if (range === 0) { stats.zeroRanges++; continue; }
        let duplicate = -1;
        for (let n = 0; n < count; n++) if (ranges[n] === range) duplicate = n;
        if (duplicate >= 0) {
          intensities[duplicate] = Math.max(intensities[duplicate], intensity);
          stats.duplicateReturns++; continue;
        }
        let at = count;
        while (at > 0 && ranges[at - 1] > range) { ranges[at] = ranges[at - 1]; intensities[at] = intensities[at - 1]; at--; }
        ranges[at] = range; intensities[at] = intensity; count++;
      }
      const c = geometry[channel];
      const t = baseTime + blockSeconds + c.fireUs / 1e6;
      const dx = c.cosElevation * (sinAz * c.cosDelta + cosAz * c.sinDelta);
      const dy = c.cosElevation * (cosAz * c.cosDelta - sinAz * c.sinDelta);
      for (let r = 0; r < count; r++) {
        const meters = ranges[r] * 0.005;
        emit(t, meters * dx, meters * dy, meters * c.sinElevation, intensities[r], r + 1, count, channel);
      }
    }
  }
}

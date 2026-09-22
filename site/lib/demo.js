import { standardFiringCsv } from './calibration.js';

// A deterministic, explicitly synthetic fixture; never a sensor calibration.
export function makeDemo(packetCount = 600) {
  const frameSize = 862, recordSize = 16 + frameSize;
  const bytes = new Uint8Array(24 + packetCount * recordSize);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0xa1b2c3d4, true); v.setUint16(4, 2, true); v.setUint16(6, 4, true);
  v.setUint32(16, 65535, true); v.setUint32(20, 1, true);
  const epoch = Date.UTC(2020, 4, 20, 0, 2, 5) / 1000;
  for (let p = 0; p < packetCount; p++) {
    const record = 24 + p * recordSize, frame = record + 16, payload = frame + 42;
    const us = 100000 + p * 100;
    v.setUint32(record, epoch + Math.floor(us / 1e6), true); v.setUint32(record + 4, us % 1e6, true);
    v.setUint32(record + 8, frameSize, true); v.setUint32(record + 12, frameSize, true);
    v.setUint16(frame + 12, 0x0800); bytes[frame + 14] = 0x45;
    v.setUint16(frame + 16, 848); bytes[frame + 22] = 64; bytes[frame + 23] = 17;
    bytes.set([192, 168, 1, 201], frame + 26); bytes.set([192, 168, 1, 100], frame + 30);
    v.setUint16(frame + 34, 10000); v.setUint16(frame + 36, 2368); v.setUint16(frame + 38, 828);
    bytes.set([0xee, 0xff, 6, 1, 0, 0, 32, 6, 1, 5, 3, 1], payload);
    for (let b = 0; b < 6; b++) {
      const block = payload + 12 + b * 130;
      v.setUint16(block, (p * 36 + Math.floor(b / 3) * 18) % 36000, true);
      for (let c = 0; c < 32; c++) {
        // Strongest duplicates first; last is a distinct farther return.
        v.setUint16(block + 2 + c * 4, 1000 + c * 10 + (b % 3 === 1 ? 300 : 0), true);
        bytes[block + 4 + c * 4] = 80 + c;
      }
    }
    const tail = payload + 792;
    bytes[tail + 10] = 0x3d; v.setUint16(tail + 11, 600, true);
    const date = new Date((epoch + Math.floor(us / 1e6)) * 1000);
    bytes.set([120, 5, 20, 0, 2, date.getUTCSeconds()], tail + 13);
    v.setUint32(tail + 19, us % 1e6, true); bytes[tail + 23] = 0x42; v.setUint32(payload + 816, p + 1, true);
  }
  return {
    bytes,
    angleText: 'Channel,Elevation,Azimuth\n' + Array.from({ length: 32 }, (_, c) => `${c + 1},${(19.5 - c * 1.3).toFixed(3)},0`).join('\n'),
    firingText: standardFiringCsv(),
  };
}

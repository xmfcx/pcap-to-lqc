import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo } from '../site/lib/demo.js';
import { parseCalibration } from '../site/lib/calibration.js';
import { convertCapture, inspectCapture } from '../site/lib/converter.js';
import { gpsTime, gpsOffset } from '../site/lib/time.js';
import { pcapPackets } from '../site/lib/pcap.js';

const defaults = { version: '1.1', timeScale: 'utc', customOffset: 0, byteOrder: 'little', rotation: 1 };
const flatAngles = 'Channel,Elevation,Azimuth\n' + Array.from({ length: 32 }, (_, i) => `${i + 1},0,0`).join('\n');
function fixture(n = 1) { const d = makeDemo(n); d.angleText = flatAngles; return d; }
async function convert(d, options = {}, extra = {}) {
  const chunks = [];
  const report = await convertCapture({ file: new File([d.bytes], 'test.pcap'), angleText: d.angleText, firingText: d.firingText, options: { ...defaults, ...options }, write: async bytes => chunks.push(bytes.slice()), ...extra });
  return { report, output: Buffer.concat(chunks) };
}
const payloadOffset = 24 + 16 + 42;

test('known manual geometry, GPS time, packed fields, distinct return ordering and laser ID', async () => {
  const { output, report } = await convert(fixture());
  assert.equal(output.subarray(0, 12).toString(), '$LQC,V1.1,#$');
  assert.equal(report.points, 128); assert.equal(report.duplicateReturns, 64);
  assert.equal(output.length, 12 + 128 * 25); assert.equal(report.outputBytes, output.length);
  // Wednesday 00:02:05 UTC + 18s, .1 second packet, -50us block, +6us channel.
  assert.ok(Math.abs(output.readDoubleLE(12) - 259343.099956) < 1e-9);
  // 5m at 0.0216 degrees (600 RPM * 6 degrees/s/RPM * 6us).
  assert.ok(Math.abs(output.readFloatLE(20) - 0.00188495555) < 1e-8);
  assert.ok(Math.abs(output.readFloatLE(24) - 4.99999964) < 1e-6);
  assert.equal(output.readFloatLE(28), 0);
  assert.equal(output.readUInt16LE(32), 80); assert.equal(output[34], 0);
  assert.equal(output[35], 17); assert.equal(output[36], 1); // 1 of 2; laser 0; PCDA enabled.
  assert.equal(output[60], 18); // Second return is 2 of 2, despite being block 2.
  assert.equal(output[12 + 2 * 25 + 24], 3); // Next channel: laser 1 + PCDA.
  assert.equal(report.gpsWeek, 2106);
});

test('LQC 1.0 and explicit big-endian serialization', async () => {
  const { output, report } = await convert(fixture(), { version: '1.0', byteOrder: 'big' });
  assert.equal(output.subarray(0, 12).toString(), '$LQC,V1.0,#$');
  assert.equal(output.length, 12 + 128 * 24);
  assert.ok(Math.abs(output.readDoubleBE(12) - 259343.099956) < 1e-9);
  assert.equal(output.readUInt16BE(32), 80); assert.equal(report.points, 128);
});

test('strongest return between first and last is numbered by range, not block order', async () => {
  const d = fixture(), v = new DataView(d.bytes.buffer);
  v.setUint16(payloadOffset + 14 + 2 * 130, 1100, true);
  const { output, report } = await convert(d);
  assert.equal(report.points, 129);
  assert.deepEqual([output[35], output[60], output[85]], [25, 26, 27]);
  assert.ok(output.readFloatLE(24) < output.readFloatLE(49));
  assert.ok(output.readFloatLE(49) < output.readFloatLE(74));
});

test('single and dual return block timing follow Appendix B', async () => {
  for (const [mode, expectedTime, points] of [[0x33, 259343.099756, 192], [0x3b, 259343.099906, 160]]) {
    const d = fixture(); d.bytes[payloadOffset + 802] = mode;
    const v = new DataView(d.bytes.buffer);
    for (let b = 0; b < 6; b++) v.setUint16(payloadOffset + 12 + b * 130, 0, true);
    const result = await convert(d);
    assert.ok(Math.abs(result.output.readDoubleLE(12) - expectedTime) < 1e-9);
    assert.equal(result.report.points, points);
  }
});

test('zero ranges are skipped and repeated selected ranges merge', async () => {
  const d = fixture(), v = new DataView(d.bytes.buffer);
  for (let b = 0; b < 6; b++) v.setUint16(payloadOffset + 14 + b * 130, 0, true);
  const { report } = await convert(d);
  assert.equal(report.points, 124); assert.equal(report.zeroRanges, 6);
});

test('BOM/CRLF calibrations are accepted; missing, duplicate and nonnumeric channels rejected', () => {
  const d = fixture();
  assert.equal(parseCalibration('\uFEFF' + d.angleText.replaceAll('\n', '\r\n'), d.firingText).length, 32);
  for (const text of [d.angleText.replace('32,0,0', '31,0,0'), d.angleText.replace('1,0,0', '1,,0'), d.angleText.replace('32,0,0', '')]) assert.throws(() => parseCalibration(text, d.firingText));
});

test('UTC leap history, GPS/TAI and custom scales are explicit', () => {
  assert.equal(gpsOffset(Date.UTC(2016, 0, 1) / 1000, 'utc'), 17);
  assert.equal(gpsOffset(Date.UTC(2020, 0, 1) / 1000, 'utc'), 18);
  assert.equal(gpsOffset(Date.UTC(2020, 0, 1) / 1000, 'tai'), -19);
  assert.equal(gpsOffset(1, 'gps'), 0); assert.equal(gpsOffset(1, 'custom', 12.5), 12.5);
  assert.throws(() => gpsOffset(Date.UTC(2027, 0, 1) / 1000, 'utc'), /leap-second table/);
  assert.throws(() => gpsOffset(1, ''), /time scale/);
  assert.equal(gpsTime(Date.UTC(2020, 4, 17) / 1000, 0, 'gps').seconds, 0);
});

test('PCAP arbitrary chunk boundaries, big endian and nanosecond capture clocks', async () => {
  const d = fixture(), src = d.bytes, chunks = [];
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < src.length; i += 3) c.enqueue(src.slice(i, i + 3)); c.close(); } });
  for await (const p of pcapPackets(stream)) chunks.push(p);
  assert.equal(chunks.length, 1); assert.equal(chunks[0].frame.length, 862);
  const v = new DataView(src.buffer);
  for (const [offset, size] of [[0,4],[4,2],[6,2],[16,4],[20,4],[24,4],[28,4],[32,4],[36,4]]) {
    const value = size === 4 ? v.getUint32(offset, true) : v.getUint16(offset, true);
    if (size === 4) v.setUint32(offset, value, false); else v.setUint16(offset, value, false);
  }
  v.setUint32(0, 0xa1b23c4d); v.setUint32(28, 123456789);
  const info = await inspectCapture(new File([src], 'nano.pcap'));
  assert.ok(info.captureDate.endsWith('.123Z'));
  assert.equal((await convert(d)).report.points, 128);
});

test('reject PCAPNG, unknown models, truncated records and invalid dates', async () => {
  for (const mutate of [
    d => new DataView(d.bytes.buffer).setUint32(0, 0x0a0d0d0a),
    d => { d.bytes[payloadOffset + 7] = 8; },
    d => { d.bytes = d.bytes.slice(0, -1); },
    d => { d.bytes[payloadOffset + 807] = 31; d.bytes[payloadOffset + 806] = 2; },
  ]) { const d = fixture(); mutate(d); await assert.rejects(() => convert(d)); }
});

test('mixed sources, fragmented UDP and inconsistent return azimuths fail', async () => {
  const mixed = fixture(2); mixed.bytes[24 + 878 + 16 + 26] = 193;
  await assert.rejects(() => convert(mixed), /Multiple LiDAR/);
  const fragmented = fixture(); new DataView(fragmented.bytes.buffer).setUint16(24 + 16 + 20, 0x2000);
  await assert.rejects(() => convert(fragmented), /Fragmented/);
  const azimuth = fixture(); new DataView(azimuth.bytes.buffer).setUint16(payloadOffset + 142, 400, true);
  await assert.rejects(() => convert(azimuth), /inconsistent azimuths/);
});

test('packet gaps are counted; duplicate packets skipped; reverse sequence rejected', async () => {
  const d = fixture(3), v = new DataView(d.bytes.buffer);
  v.setUint32(payloadOffset + 878 + 816, 4, true); v.setUint32(payloadOffset + 2 * 878 + 816, 4, true);
  const { report } = await convert(d);
  assert.equal(report.missingPackets, 2); assert.equal(report.duplicatePackets, 1); assert.equal(report.points, 256);
  v.setUint32(payloadOffset + 2 * 878 + 816, 3, true);
  await assert.rejects(() => convert(d), /out of sequence/);
});

test('GPS week crossings are rejected instead of silently losing the date', async () => {
  const d = fixture(); d.bytes.set([120, 5, 17, 0, 0, 0], payloadOffset + 805);
  new DataView(d.bytes.buffer).setUint32(payloadOffset + 811, 0, true);
  await assert.rejects(() => convert(d, { timeScale: 'gps' }), /week boundary/);
});

test('streaming waits for the sink and cancellation stops before completion', async () => {
  const d = fixture(400); let writes = 0, pending = false, cancelled = false;
  await assert.rejects(() => convert(d, {}, {
    cancelled: () => cancelled,
    write: async bytes => {
      assert.equal(pending, false); assert.ok(bytes.length <= 1024 * 1024); pending = true;
      await new Promise(resolve => setTimeout(resolve, 1)); pending = false;
      if (++writes === 2) cancelled = true;
    },
  }), { name: 'AbortError' });
  assert.equal(writes, 2);
});

test('bounded write failure propagates; no success report is produced', async () => {
  await assert.rejects(() => convert(fixture(400), {}, { write: async bytes => { if (bytes.length > 12) throw new Error('Disk full'); } }), /Disk full/);
});


test('packets straddling UTC leap-second insertion are rejected', async () => {
  const d = fixture(); d.bytes.set([117, 1, 1, 0, 0, 0], payloadOffset + 805);
  new DataView(d.bytes.buffer).setUint32(payloadOffset + 811, 0, true);
  await assert.rejects(() => convert(d), /leap second/);
});

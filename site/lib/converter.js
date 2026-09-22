import { pcapPackets, udpPayload } from './pcap.js';
import { packetInfo, makeGeometry, decodePoints, RETURN_NAMES } from './xt32.js';
import { gpsTime, gpsOffset, WEEK_SECONDS } from './time.js';
import { parseCalibration } from './calibration.js';

export const ENGINE_VERSION = '0.1.0';
export const RECORD_BYTES = { '1.0': 24, '1.1': 25 };
export const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;

export async function inspectCapture(file) {
  let packets = 0;
  for await (const packet of pcapPackets(file.stream())) {
    packets++;
    const udp = udpPayload(packet.frame);
    const info = udp && packetInfo(udp.payload);
    if (info) return {
      source: udp.source, returnMode: RETURN_NAMES[info.mode], rpm: info.rpm,
      sensorDate: new Date(info.wholeSeconds * 1000).toISOString().replace('.000Z', ''),
      captureDate: new Date(packet.captureSeconds * 1000).toISOString(),
      microseconds: info.microseconds,
    };
    if (packets >= 100000 || packet.bytesRead > 64 * 1024 * 1024) break;
  }
  throw new Error('No XT32M2X packets found in the first 64 MiB / 100,000 packets.');
}

export async function convertCapture({ file, angleText, firingText, options, write, progress = () => {}, cancelled = () => false }) {
  const calibration = parseCalibration(angleText, firingText);
  const recordBytes = RECORD_BYTES[options.version];
  if (!recordBytes) throw new Error('Choose LQC version 1.0 or 1.1.');
  if (![1, -1].includes(options.rotation)) throw new Error('Choose the sensor rotation direction.');
  if (!['little', 'big'].includes(options.byteOrder)) throw new Error('Choose the output byte order.');
  const little = options.byteOrder === 'little';
  const header = new TextEncoder().encode(`$LQC,V${options.version},#$`);
  const report = {
    converter: `pcap-to-lqc ${ENGINE_VERSION}`, input: { name: file.name, bytes: file.size },
    options: { ...options }, source: null, gpsWeek: null,
    packets: 0, lidarPackets: 0, ignoredPackets: 0, duplicatePackets: 0, missingPackets: 0,
    points: 0, zeroRanges: 0, duplicateReturns: 0, bytesRead: 0, outputBytes: header.length,
    minGpsSeconds: null, maxGpsSeconds: null, firstSensorTime: null, lastSensorTime: null,
    returnModes: {}, warnings: [
      'POSPac import compatibility has not yet been verified with a reference LQC file.',
      'Coordinates use the XT32M2X manual spherical model; no optical-center, spot, mounting, or trajectory correction.',
      'Return numbers describe distinct recorded ranges sorted nearest to farthest, not unobserved physical echoes.',
      'Sensor time scale and synchronization are user-supplied; the converter cannot establish clock lock.',
    ],
  };
  let buffer = new ArrayBuffer(CHUNK_BYTES), out = new DataView(buffer), used = 0;
  let previousSequence = null, lastSensorTime = null, geometry = null, lastRpm = null;
  const started = performance.now(); let lastProgress = started;
  const snapshot = () => ({ ...report, elapsedSeconds: (performance.now() - started) / 1000 });
  const checkCancel = () => { if (cancelled()) throw new DOMException('Conversion cancelled.', 'AbortError'); };
  const flush = async () => {
    if (!used) return;
    checkCancel();
    const bytes = new Uint8Array(buffer, 0, used);
    await write(bytes);
    buffer = new ArrayBuffer(CHUNK_BYTES); out = new DataView(buffer); used = 0;
  };
  const emit = (time, x, y, z, intensity, number, total, channel) => {
    if (time < 0 || time >= WEEK_SECONDS) throw new Error('Capture crosses a GPS week boundary. Split the capture at the boundary before converting.');
    out.setFloat64(used, time, little);
    out.setFloat32(used + 8, x, little); out.setFloat32(used + 12, y, little); out.setFloat32(used + 16, z, little);
    out.setUint16(used + 20, intensity, little);
    out.setUint8(used + 22, 0); // Never classified; no synthetic/key/withheld flags.
    out.setUint8(used + 23, number | (total << 3)); // Scan/edge flags unset.
    if (recordBytes === 25) out.setUint8(used + 24, (channel << 1) | 1); // All points participate in PCDA.
    used += recordBytes; report.points++; report.outputBytes += recordBytes;
    report.minGpsSeconds = report.minGpsSeconds === null ? time : Math.min(report.minGpsSeconds, time);
    report.maxGpsSeconds = report.maxGpsSeconds === null ? time : Math.max(report.maxGpsSeconds, time);
  };
  await write(header);
  for await (const packet of pcapPackets(file.stream())) {
    checkCancel(); report.packets++; report.bytesRead = packet.bytesRead;
    const udp = udpPayload(packet.frame);
    const info = udp && packetInfo(udp.payload);
    if (!info) { report.ignoredPackets++; }
    else {
      if (report.source && report.source !== udp.source) throw new Error('Multiple LiDAR sources found. Export one sensor source per PCAP before converting.');
      report.source = udp.source;
      if (info.sequence !== null && previousSequence !== null) {
        const step = (info.sequence - previousSequence) >>> 0;
        if (step === 0) { report.duplicatePackets++; continue; }
        if (step >= 0x80000000) throw new Error('LiDAR packets are out of sequence or the sensor restarted. Split/reorder the capture before converting.');
        report.missingPackets += step - 1;
      }
      previousSequence = info.sequence;
      const sensorTime = info.wholeSeconds + info.microseconds / 1e6;
      if (lastSensorTime !== null && sensorTime < lastSensorTime) throw new Error('Sensor time moved backwards. Check synchronization or reorder the capture.');
      lastSensorTime = sensorTime;
      if (options.timeScale === 'utc' && info.microseconds < 250 &&
          gpsOffset(info.wholeSeconds, 'utc') !== gpsOffset(info.wholeSeconds - 0.001, 'utc')) {
        throw new Error('A packet straddles a UTC leap second. Split the capture outside the leap-second transition.');
      }
      const time = gpsTime(info.wholeSeconds, info.microseconds / 1e6, options.timeScale, options.customOffset);
      if (report.gpsWeek !== null && report.gpsWeek !== time.week) throw new Error('Capture crosses a GPS week boundary. Split the capture at the boundary before converting.');
      report.gpsWeek = time.week;
      report.lidarPackets++;
      report.returnModes[RETURN_NAMES[info.mode]] = (report.returnModes[RETURN_NAMES[info.mode]] || 0) + 1;
      report.firstSensorTime ??= new Date(sensorTime * 1000).toISOString();
      // Preserve the precise numeric time range separately from this millisecond display.
      report.lastSensorTime = new Date(sensorTime * 1000).toISOString();
      if (lastRpm !== info.rpm) { geometry = makeGeometry(calibration, info.rpm, options.rotation); lastRpm = info.rpm; }
      // Reserve enough room for a whole packet, including all 192 possible returns.
      if (buffer.byteLength - used < 192 * recordBytes) await flush();
      decodePoints(info, geometry, emit, report, time.seconds);
    }
    const now = performance.now();
    if (now - lastProgress > 150) { progress(snapshot()); lastProgress = now; }
  }
  checkCancel();
  if (!report.points) throw new Error('No valid XT32M2X points found. No output was completed.');
  await flush();
  if (report.missingPackets) report.warnings.push(`${report.missingPackets} packet sequence numbers were missing; output has gaps.`);
  if (report.duplicatePackets) report.warnings.push(`${report.duplicatePackets} repeated packet sequence numbers were skipped.`);
  report.bytesRead = file.size;
  const result = snapshot(); progress(result); return result;
}

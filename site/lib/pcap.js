export class ByteReader {
  constructor(stream) { this.reader = stream.getReader(); this.chunk = new Uint8Array(); this.position = 0; this.offset = 0; }
  async read(length, allowEof = false) {
    if (this.chunk.length - this.position >= length) {
      const value = this.chunk.subarray(this.position, this.position + length);
      this.position += length; this.offset += length;
      return value;
    }
    const value = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const available = this.chunk.length - this.position;
      if (available) {
        const take = Math.min(available, length - filled);
        value.set(this.chunk.subarray(this.position, this.position + take), filled);
        this.position += take; this.offset += take; filled += take;
      } else {
        const next = await this.reader.read();
        if (next.done) {
          if (allowEof && filled === 0) return null;
          throw new Error(`Truncated PCAP near byte ${this.offset.toLocaleString()}.`);
        }
        this.chunk = next.value; this.position = 0;
      }
    }
    return value;
  }
  async close() { await this.reader.cancel(); this.reader.releaseLock(); }
}

export async function* pcapPackets(stream) {
  const reader = new ByteReader(stream);
  try {
    const header = await reader.read(24);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const magic = view.getUint32(0, false);
    if (magic === 0x0a0d0d0a) throw new Error('PCAPNG is not supported. Export an Ethernet capture as classic PCAP first.');
    const little = [0xd4c3b2a1, 0x4d3cb2a1].includes(magic);
    const nano = [0x4d3cb2a1, 0xa1b23c4d].includes(magic);
    if (![0xd4c3b2a1, 0x4d3cb2a1, 0xa1b2c3d4, 0xa1b23c4d].includes(magic)) throw new Error('This is not a classic PCAP file. Select an uncompressed .pcap file.');
    if (view.getUint16(4, little) !== 2 || view.getUint16(6, little) !== 4) throw new Error('Only PCAP version 2.4 is supported.');
    if ((view.getUint32(20, little) & 0xffff) !== 1) throw new Error('Only Ethernet PCAP captures are supported.');
    const snaplen = view.getUint32(16, little);
    if (!snaplen || snaplen > 16 * 1024 * 1024) throw new Error('Invalid or unsupported PCAP snapshot length.');
    while (true) {
      const bytes = await reader.read(16, true);
      if (!bytes) break;
      const record = new DataView(bytes.buffer, bytes.byteOffset, 16);
      const captured = record.getUint32(8, little), original = record.getUint32(12, little);
      if (!captured || captured > snaplen || captured > original) throw new Error(`Invalid PCAP record length near byte ${reader.offset}.`);
      if (captured !== original) throw new Error('Capture contains truncated packets. Re-capture using a full packet snapshot length.');
      const frame = await reader.read(captured);
      yield { frame, bytesRead: reader.offset, captureSeconds: record.getUint32(0, little) + record.getUint32(4, little) / (nano ? 1e9 : 1e6) };
    }
  } finally { await reader.close(); }
}

export function udpPayload(frame) {
  if (frame.length < 14) throw new Error('Truncated Ethernet frame.');
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let type = view.getUint16(12), offset = 14;
  while ([0x8100, 0x88a8, 0x9100].includes(type)) {
    if (offset + 4 > frame.length) throw new Error('Truncated VLAN header.');
    type = view.getUint16(offset + 2); offset += 4;
  }
  if (type !== 0x0800) return null;
  if (offset + 20 > frame.length) throw new Error('Truncated IPv4 header.');
  const ihl = (frame[offset] & 15) * 4;
  const total = view.getUint16(offset + 2);
  if ((frame[offset] >> 4) !== 4 || ihl < 20 || total < ihl || offset + total > frame.length) throw new Error('Malformed IPv4 packet.');
  if (frame[offset + 9] !== 17) return null;
  if (view.getUint16(offset + 6) & 0x3fff) throw new Error('Fragmented UDP is not supported. Use an unfragmented Ethernet capture.');
  const start = offset + ihl;
  if (start + 8 > offset + total) throw new Error('Truncated UDP header.');
  const length = view.getUint16(start + 4);
  if (length < 8 || start + length > offset + total) throw new Error('Malformed UDP length.');
  return {
    payload: frame.subarray(start + 8, start + length),
    source: `${Array.from(frame.subarray(offset + 12, offset + 16)).join('.')}:${view.getUint16(start)}`,
    destinationPort: view.getUint16(start + 2),
  };
}

import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat, unlink, writeFile, link } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { basename, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { convertCapture } from '../site/lib/converter.js';

const args = process.argv.slice(2);
if (args.length < 4 || args.includes('--help')) {
  console.log('Usage: npm run convert -- INPUT.pcap ANGLES.csv FIRING.csv OUTPUT.lqc [--time-scale utc|gps|tai|custom] [--offset SECONDS] [--version 1.0|1.1] [--byte-order little|big] [--rotation 1|-1] [--validate-only]');
  process.exit(args.includes('--help') ? 0 : 1);
}
const [input, anglePath, firingPath, output, ...flags] = args;
const options = { version: '1.1', timeScale: '', customOffset: 0, byteOrder: 'little', rotation: 1 };
let validateOnly = false;
for (let i = 0; i < flags.length; i++) {
  const flag = flags[i];
  if (flag === '--validate-only') { validateOnly = true; continue; }
  const keys = { '--time-scale': 'timeScale', '--offset': 'customOffset', '--version': 'version', '--byte-order': 'byteOrder', '--rotation': 'rotation' };
  if (!keys[flag] || flags[i + 1] === undefined) throw new Error(`Unknown or incomplete option ${flag}`);
  options[keys[flag]] = ['--offset', '--rotation'].includes(flag) ? Number(flags[++i]) : flags[++i];
}
if (!options.timeScale) throw new Error('Provide --time-scale based on the recorded sensor clock.');
if ([input, anglePath, firingPath].some(p => resolve(p) === resolve(output))) throw new Error('Output must differ from all input files.');
const temp = `${output}.${randomUUID()}.partial`;
let stream, streamError, interrupted = false, lastPrinted = 0;
process.on('SIGINT', () => { interrupted = true; });
try {
  const [info, angleText, firingText] = await Promise.all([stat(input), readFile(anglePath, 'utf8'), readFile(firingPath, 'utf8')]);
  if (!validateOnly) {
    for (const p of [output, output + '.conversion.json']) {
      try { await stat(p); throw new Error(`Refusing to overwrite ${p}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    stream = createWriteStream(temp, { flags: 'wx' });
    stream.on('error', e => { streamError = e; });
    await once(stream, 'open');
  }
  const digest = createHash('sha256');
  const report = await convertCapture({
    file: { name: basename(input), size: info.size, stream: () => Readable.toWeb(createReadStream(input, { highWaterMark: 1024 * 1024 })) },
    angleText, firingText, options,
    cancelled: () => interrupted,
    write: async bytes => {
      digest.update(bytes);
      if (streamError) throw streamError;
      if (stream && !stream.write(bytes)) await once(stream, 'drain');
    },
    progress: r => { if (r.elapsedSeconds - lastPrinted >= 5) { process.stderr.write(`${(r.bytesRead / info.size * 100).toFixed(1)}% · ${r.points.toLocaleString()} points · ${r.elapsedSeconds.toFixed(1)}s\n`); lastPrinted = r.elapsedSeconds; } },
  });
  report.calibration = {
    angle: { name: basename(anglePath), sha256: createHash('sha256').update(angleText).digest('hex') },
    firing: { name: basename(firingPath), sha256: createHash('sha256').update(firingText).digest('hex') },
  };
  report.outputSha256 = digest.digest('hex'); report.validationOnly = validateOnly;
  if (stream) {
    stream.end(); await finished(stream);
    // Hard-link creation fails if a destination appeared during conversion.
    await link(temp, output); await unlink(temp);
    await writeFile(output + '.conversion.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (stream) { stream.destroy(); await finished(stream).catch(() => {}); await unlink(temp).catch(() => {}); }
  process.stderr.write(`Conversion stopped: ${error.message}\n`); process.exitCode = 1;
}

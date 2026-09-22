import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { defaultCalibrationModule } from './default-calibration.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../site/', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(site, dist, { recursive: true });
await writeFile(`${dist}/lib/default-calibration.js`, await defaultCalibrationModule());
const hash = createHash('sha256');
for (const path of (await readdir(dist, { recursive: true })).sort()) {
  if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html') || path.endsWith('.svg')) hash.update(await readFile(`${dist}/${path}`));
}
const cacheName = 'pcap-to-lqc-' + hash.digest('hex').slice(0, 16);
const worker = await readFile(`${dist}/sw.js`, 'utf8');
await writeFile(`${dist}/sw.js`, worker.replace('pcap-to-lqc-dev', cacheName));
await writeFile(`${dist}/.nojekyll`, '');
const entries = await readdir(dist);
if (entries.includes('data') || entries.includes('docs')) throw new Error('Private source files must never enter the Pages artifact.');
process.stdout.write('Built dist/ with bundled XT32M2X defaults. No user captures or custom calibration files are published.\n');

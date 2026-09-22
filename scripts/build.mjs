import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../site/', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(site, dist, { recursive: true });
const hash = createHash('sha256');
for (const path of (await readdir(site, { recursive: true })).sort()) {
  if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html') || path.endsWith('.svg')) hash.update(await readFile(`${site}/${path}`));
}
const cacheName = 'pcap-to-lqc-' + hash.digest('hex').slice(0, 16);
const worker = await readFile(`${dist}/sw.js`, 'utf8');
await writeFile(`${dist}/sw.js`, worker.replace('pcap-to-lqc-dev', cacheName));
await writeFile(`${dist}/.nojekyll`, '');
const entries = await readdir(dist);
if (entries.includes('data') || entries.includes('docs')) throw new Error('Private source files must never enter the Pages artifact.');
process.stdout.write('Built dist/ from site/ only. No captures or calibration files are published.\n');

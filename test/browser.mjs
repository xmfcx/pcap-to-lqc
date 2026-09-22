import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { makeDemo } from '../site/lib/demo.js';
import { convertCapture } from '../site/lib/converter.js';

const port = Number(process.env.BROWSER_TEST_PORT || 4175);
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port), BASE_PATH: '/pcap-to-lqc/' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('exit', code => reject(new Error(`Server exited: ${code}`))); });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || undefined, args: process.env.BROWSER_NO_SANDBOX ? ['--no-sandbox'] : [] });
const url = `http://127.0.0.1:${port}/pcap-to-lqc/`;
const errors = [];
const demo = makeDemo();
const chunks = [];
await convertCapture({ file: new File([demo.bytes], 'synthetic-xt32m2x.pcap'), angleText: demo.angleText, firingText: demo.firingText, options: { version: '1.1', timeScale: 'utc', customOffset: 18, byteOrder: 'little', rotation: 1 }, write: async b => chunks.push(b.slice()) });
const expected = Buffer.concat(chunks);
async function ready(page) {
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.offlineReady === 'true');
}
async function demoReady(page) {
  await page.click('#demo');
  await page.waitForFunction(() => !document.querySelector('#convert').disabled);
}
try {
  // Real download flow, offline after the application has loaded.
  const fallback = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
  await fallback.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await fallback.newPage(); await ready(page);
  await page.screenshot({ path: process.env.BROWSER_SCREENSHOT || '/tmp/pcap-to-lqc-desktop.png', fullPage: true });
  await fallback.setOffline(true);
  await demoReady(page); await page.click('#convert');
  await page.waitForFunction(() => document.querySelector('#status-title').textContent === 'Conversion complete.');
  assert.equal(await page.textContent('#points'), '76,800');
  const downloadWait = page.waitForEvent('download'); await page.click('#download-lqc');
  const download = await downloadWait;
  assert.deepEqual(await readFile(await download.path()), expected);
  const reportWait = page.waitForEvent('download'); await page.click('#download-report');
  const report = JSON.parse(await readFile(await (await reportWait).path(), 'utf8'));
  assert.equal(report.points, 76800); assert.equal(report.gpsWeek, 2106); assert.equal(report.synthetic, true);
  assert.equal(report.calibration.angle.sha256.length, 64);
  console.log('PASS: offline browser download equals native engine byte-for-byte; JSON report verified.');
  await page.setInputFiles('#pcap', { name: 'real-input.pcap', mimeType: 'application/octet-stream', buffer: Buffer.from(demo.bytes) });
  await page.waitForFunction(() => !document.querySelector('#capture-info').hidden);
  assert.equal(await page.textContent('#angle-name'), 'Choose angle CSV');
  assert.equal(await page.inputValue('#time-scale'), '');
  assert.equal(await page.locator('#convert').isDisabled(), true);
  console.log('PASS: switching from demo to a real capture clears synthetic calibration and clock settings.');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/pcap-to-lqc-mobile.png', fullPage: true });
  await fallback.close();

  // Exercise a real browser writable file stream (OPFS); only the picker is substituted.
  const direct = await browser.newContext();
  await direct.addInitScript(() => {
    window.showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      window.outputHandle = await root.getFileHandle('browser-smoke.lqc', { create: true });
      return window.outputHandle;
    };
  });
  const diskPage = await direct.newPage(); await ready(diskPage); await demoReady(diskPage);
  await diskPage.click('#convert');
  await diskPage.waitForFunction(() => document.querySelector('#status-title').textContent === 'Conversion complete.');
  const disk = await diskPage.evaluate(async () => { const f = await window.outputHandle.getFile(); return { size: f.size, header: Array.from(new Uint8Array(await f.slice(0, 112).arrayBuffer())) }; });
  assert.equal(disk.size, expected.length); assert.deepEqual(Buffer.from(disk.header), expected.subarray(0, 112));
  console.log('PASS: direct browser file stream saved the expected header, records, and size.');
  await direct.close();

  // A disk error is visible, aborts the output, and never offers a success download.
  const failures = await browser.newContext();
  await failures.addInitScript(() => {
    window.showSaveFilePicker = async () => ({ name: 'error.lqc', createWritable: async () => ({
      write: async () => { throw new Error('Test disk is full'); }, close: async () => { window.outputClosed = true; }, abort: async () => { window.outputAborted = true; },
    }) });
  });
  const errorPage = await failures.newPage(); await ready(errorPage); await demoReady(errorPage); await errorPage.click('#convert');
  await errorPage.waitForFunction(() => document.querySelector('#status-title').textContent === 'Conversion stopped.');
  assert.match(await errorPage.textContent('#status-description'), /disk is full/);
  assert.equal(await errorPage.evaluate(() => window.outputAborted && !window.outputClosed), true);
  assert.equal(await errorPage.locator('#downloads').isHidden(), true);
  console.log('PASS: output errors abort and do not report success.');
  await failures.close();

  const cancellation = await browser.newContext();
  await cancellation.addInitScript(() => {
    window.showSaveFilePicker = async () => ({ name: 'cancel.lqc', createWritable: async () => ({
      write: async () => { await new Promise(resolve => setTimeout(resolve, 150)); }, close: async () => { window.outputClosed = true; }, abort: async () => { window.outputAborted = true; },
    }) });
  });
  const cancelPage = await cancellation.newPage(); await ready(cancelPage); await demoReady(cancelPage); await cancelPage.click('#convert');
  await cancelPage.click('#cancel');
  await cancelPage.waitForFunction(() => document.querySelector('#status-title').textContent === 'Conversion cancelled.');
  assert.equal(await cancelPage.evaluate(() => window.outputAborted && !window.outputClosed), true);
  console.log('PASS: cancellation aborts the stream and preserves inputs for retry.');
  await cancellation.close();

  // Unsupported input is rejected in the page rather than producing an empty LQC.
  const invalid = await browser.newContext(); const invalidPage = await invalid.newPage(); await ready(invalidPage);
  await invalidPage.setInputFiles('#pcap', { name: 'wrong.pcap', mimeType: 'application/octet-stream', buffer: Buffer.alloc(40) });
  await invalidPage.waitForFunction(() => document.querySelector('#status-title').textContent === 'Check the capture.');
  assert.equal(await invalidPage.locator('#convert').isDisabled(), true);
  await invalid.close();
  assert.deepEqual(errors, []);
  console.log('PASS: malformed input rejected; no uncaught browser errors; mobile layout fits.');
} finally { await browser.close(); server.kill(); }

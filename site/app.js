import { parseCalibration, standardFiringCsv } from './lib/calibration.js';
import { makeDemo } from './lib/demo.js';
import { MAX_DOWNLOAD_BYTES } from './lib/converter.js';

const $ = id => document.getElementById(id);
const directSave = typeof window.showSaveFilePicker === 'function' && window.isSecureContext;
const FALLBACK_INPUT_BYTES = 16 * 1024 * 1024;
let capture = null, angleText = '', firingText = '', angleName = '', firingName = '';
let inspected = false, calibrationValid = false, inspecting = null, run = null, revision = 0;
let resultUrls = [];
let angleSource = null, firingSource = null;
const calibrationTokens = { angle: 0, firing: 0 };

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let i = 0; while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function status(title, description, error = false) {
  $('status-title').textContent = title;
  $('status-description').textContent = description;
  $('status-description').classList.toggle('error', error);
}
function resetResults() {
  resultUrls.forEach(URL.revokeObjectURL); resultUrls = [];
  $('downloads').hidden = true; $('download-lqc').hidden = true;
  $('progress').value = 0; $('percentage').textContent = '0%';
  $('points').textContent = '0'; $('output-size').textContent = '—'; $('elapsed').textContent = '—';
  $('progress-text').textContent = 'Waiting for files';
}
function refresh() {
  if (run) return;
  let reason = !capture ? 'Choose files to continue' : !inspected ? 'Inspecting capture…' : !calibrationValid ? 'Add calibration to continue' : !$('time-scale').value ? 'Select the sensor clock' : 'Convert & save LQC';
  const tooLarge = !directSave && capture?.size > FALLBACK_INPUT_BYTES;
  if (tooLarge) reason = 'Use Chrome or Edge for this file';
  const ready = capture && inspected && calibrationValid && $('time-scale').value && !tooLarge;
  $('convert').disabled = !ready; $('convert').textContent = reason;
  if (ready) status('Ready to convert.', `${formatBytes(capture.size)} capture. Your output stays on this device.`);
  if (tooLarge) status('A larger capture.', 'Open this page in desktop Chrome or Edge to stream large outputs to disk. Download mode accepts captures up to 16 MiB.', true);
}
function validateCalibration() {
  calibrationValid = false; $('calibration-error').hidden = true;
  if (angleText && firingText) {
    try { parseCalibration(angleText, firingText); calibrationValid = true; }
    catch (e) { $('calibration-error').textContent = e.message; $('calibration-error').hidden = false; }
  }
  refresh();
}
async function selectCapture(file, demo = false) {
  if (run || !file) return;
  if (!demo && !$('demo-notice').hidden) {
    calibrationTokens.angle++; calibrationTokens.firing++;
    angleText = ''; firingText = ''; angleName = ''; firingName = ''; angleSource = null; firingSource = null; calibrationValid = false;
    $('angles').value = ''; $('firing').value = ''; $('angle-name').textContent = 'Choose angle CSV'; $('firing-name').textContent = 'Choose firing CSV';
    $('time-scale').value = ''; $('custom-offset-label').hidden = true;
  }
  const current = ++revision;
  inspecting?.terminate(); inspecting = null;
  capture = file; inspected = false; resetResults();
  $('capture-name').textContent = file.name;
  $('capture-detail').textContent = `${formatBytes(file.size)} · stored on your device`;
  $('capture-info').hidden = true; $('demo-notice').hidden = !demo;
  status('Inspecting capture…', 'Reading the first sensor packet locally.'); refresh();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  inspecting = worker;
  const fail = message => {
    if (current !== revision) return;
    worker.terminate(); inspecting = null;
    $('convert').disabled = true; $('convert').textContent = 'Choose a supported PCAP';
    status('Check the capture.', message, true);
  };
  worker.onerror = () => fail('Could not start the conversion worker. Serve this site over HTTPS or localhost and reload.');
  worker.onmessage = ({ data }) => {
    if (current !== revision) return;
    if (data.type === 'error') { fail(data.message); return; }
    if (data.type === 'inspected') {
      inspected = true; worker.terminate(); inspecting = null;
      const info = data.result;
      $('capture-info').replaceChildren();
      for (const text of [
        `${info.source} · ${info.rpm} RPM · ${info.returnMode}`,
        `Sensor calendar: ${info.sensorDate.replace('T', ' ')}.${String(info.microseconds).padStart(6, '0')} (time scale selected below)`,
        `Capture clock: ${info.captureDate} · not used for point timing`,
      ]) { const line = document.createElement('span'); line.textContent = text; $('capture-info').append(line); }
      $('capture-info').hidden = false;
      status('Capture recognized.', 'XT32M2X detected. Add its calibration and choose the recorded clock time scale.'); refresh();
    }
  };
  worker.postMessage({ type: 'inspect', file });
}
$('pcap').addEventListener('change', e => selectCapture(e.target.files[0]));
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => { e.preventDefault(); if (!run) $('dropzone').classList.add('dragging'); });
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', e => { if (e.dataTransfer.files.length !== 1) { status('Choose one capture.', 'Convert one PCAP at a time.', true); return; } selectCapture(e.dataTransfer.files[0]); });

for (const [id, which] of [['angles', 'angle'], ['firing', 'firing']]) {
  $(id).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file || run) return;
    const token = ++calibrationTokens[which];
    if (which === 'angle') { angleText = ''; angleName = ''; angleSource = null; } else { firingText = ''; firingName = ''; firingSource = null; }
    validateCalibration(); resetResults();
    try {
      if (file.size > 1024 * 1024) throw new Error('Calibration files must be smaller than 1 MiB. Choose a 32-channel CSV.');
      const text = await file.text(); if (token !== calibrationTokens[which] || run) return;
      if (which === 'angle') { angleText = text; angleName = file.name; angleSource = file; } else { firingText = text; firingName = file.name; firingSource = file; }
      $(`${which}-name`).textContent = file.name; validateCalibration();
    } catch (e) { $('calibration-error').textContent = e.message; $('calibration-error').hidden = false; }
  });
}
$('standard-firing').addEventListener('click', () => {
  calibrationTokens.firing++;
  firingSource = null; firingText = standardFiringCsv(); firingName = 'XT32M2X manual Appendix B.4';
  $('firing-name').textContent = 'Standard XT32M2X offsets selected'; $('firing').value = ''; resetResults(); validateCalibration();
});
$('demo').addEventListener('click', () => {
  calibrationTokens.angle++; calibrationTokens.firing++;
  angleSource = null; firingSource = null;
  const demo = makeDemo(); angleText = demo.angleText; firingText = demo.firingText;
  angleName = 'synthetic-angle.csv'; firingName = 'manual-firing.csv';
  $('angle-name').textContent = 'Synthetic angle calibration'; $('firing-name').textContent = 'Standard XT32M2X offsets';
  $('angles').value = ''; $('firing').value = ''; $('pcap').value = ''; $('time-scale').value = 'utc';
  $('custom-offset-label').hidden = true; validateCalibration();
  selectCapture(new File([demo.bytes], 'synthetic-xt32m2x.pcap'), true);
});
for (const id of ['version', 'time-scale', 'custom-offset', 'byte-order', 'rotation']) $(id).addEventListener('change', () => {
  $('custom-offset-label').hidden = $('time-scale').value !== 'custom'; resetResults(); refresh();
});
function updateProgress(report) {
  const fraction = capture.size ? report.bytesRead / capture.size : 0;
  $('progress').value = Math.min(99.9, fraction * 100); $('percentage').textContent = `${Math.min(99, Math.floor(fraction * 100))}%`;
  $('progress-text').textContent = `${formatBytes(report.bytesRead)} read`;
  $('points').textContent = report.points.toLocaleString(); $('output-size').textContent = formatBytes(report.outputBytes);
  $('elapsed').textContent = `${report.elapsedSeconds.toFixed(1)} s`;
}
function downloadLink(id, blob, filename) {
  const url = URL.createObjectURL(blob); resultUrls.push(url);
  $(id).href = url; $(id).download = filename; $(id).hidden = false;
}
async function hash(text, source) {
  const bytes = source ? await source.arrayBuffer() : new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}
async function abortRun(context, message, cancelled = false) {
  if (context.ending) return;
  context.ending = true; context.worker?.terminate();
  try { await context.writing; } catch { /* The originating write error is displayed below. */ }
  try { await context.writer?.abort(); } catch { /* A failed or already closed stream may reject abort. */ }
  context.chunks.length = 0;
  if (run !== context) return;
  run = null; $('inputs').disabled = false; $('cancel').hidden = true;
  refresh();
  status(cancelled ? 'Conversion cancelled.' : 'Conversion stopped.', message, !cancelled);
  $('progress-text').textContent = cancelled ? 'Cancelled · no completed output' : 'Stopped · no completed output';
}
$('converter-form').addEventListener('submit', async e => {
  e.preventDefault(); if (run || $('convert').disabled) return;
  const options = { version: $('version').value, timeScale: $('time-scale').value, customOffset: Number($('custom-offset').value), byteOrder: $('byte-order').value, rotation: Number($('rotation').value) };
  if (options.timeScale === 'custom' && (!$('custom-offset').value.trim() || !Number.isFinite(options.customOffset) || Math.abs(options.customOffset) > 86400)) { status('Check the clock offset.', 'Enter GPS minus sensor time in seconds, between −86400 and 86400.', true); return; }
  const context = { writer: null, worker: null, chunks: [], bytes: 0, ending: false, writing: null, finishing: false };
  run = context; resetResults(); $('inputs').disabled = true; $('convert').disabled = true; $('convert').textContent = 'Preparing…';
  const filename = capture.name.replace(/\.pcap$/i, '') + '.lqc';
  try {
    // The picker must run in the user gesture, before unrelated asynchronous work.
    if (directSave) {
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Applanix LQC', accept: { 'application/octet-stream': ['.lqc'] } }] });
      if ([capture.name, angleName, firingName].some(name => name && handle.name.toLowerCase() === name.toLowerCase())) throw new Error('Choose an output filename different from all input filenames.');
      context.writer = await handle.createWritable();
    }
    const calibration = { angle: { name: angleName, sha256: await hash(angleText, angleSource) }, firing: { name: firingName, sha256: await hash(firingText, firingSource) } };
    if (run !== context || context.ending) return;
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); context.worker = worker;
    $('cancel').hidden = false; $('cancel').disabled = false; $('convert').textContent = 'Converting locally…';
    status('Converting locally.', 'Keep this tab open. Points are written in small batches.');
    worker.onerror = () => abortRun(context, 'The conversion worker stopped unexpectedly. Reload the page and try again.');
    worker.onmessage = async ({ data }) => {
      if (run !== context || context.ending) return;
      try {
        if (data.type === 'chunk') {
          const bytes = new Uint8Array(data.buffer, data.offset, data.length);
          if (context.writer) { context.writing = context.writer.write(bytes); await context.writing; }
          else {
            context.bytes += bytes.byteLength;
            if (context.bytes > MAX_DOWNLOAD_BYTES) throw new Error('Output exceeds the 128 MiB download limit. Use desktop Chrome or Edge for streaming to disk.');
            context.chunks.push(bytes);
          }
          if (!context.ending) worker.postMessage({ type: 'ack' });
        } else if (data.type === 'progress') updateProgress(data.report);
        else if (data.type === 'error') await abortRun(context, data.message, data.cancelled);
        else if (data.type === 'done') {
          context.finishing = true; $('cancel').disabled = true;
          status('Finishing the file…', 'Waiting for the browser to commit the output to disk.');
          await context.writer?.close();
          if (!context.writer) downloadLink('download-lqc', new Blob(context.chunks, { type: 'application/octet-stream' }), filename);
          context.chunks.length = 0;
          const report = { ...data.report, calibration, synthetic: !$('demo-notice').hidden };
          downloadLink('download-report', new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }), filename + '.conversion.json');
          worker.terminate(); run = null; $('inputs').disabled = false; $('cancel').hidden = true; refresh(); updateProgress(report);
          $('progress').value = 100; $('percentage').textContent = '100%'; $('progress-text').textContent = 'Conversion complete'; $('downloads').hidden = false;
          status('Conversion complete.', `${report.points.toLocaleString()} points ${context.writer ? 'saved to your LQC file' : 'ready to save'}. GPS week ${report.gpsWeek}.${report.missingPackets ? ` ${report.missingPackets} packet sequence gaps; see the report.` : ''}`);
          $('convert').textContent = 'Convert again';
        }
      } catch (error) { await abortRun(context, error.message); }
    };
    worker.postMessage({ type: 'convert', file: capture, angleText, firingText, options });
  } catch (error) { await abortRun(context, error.name === 'AbortError' ? 'Save cancelled. Your inputs are ready when you are.' : error.message, error.name === 'AbortError'); }
});
$('cancel').addEventListener('click', () => { if (run && !run.finishing) abortRun(run, 'No completed LQC was saved. A newly selected output file may remain empty.', true); });
window.addEventListener('beforeunload', e => { if (run) { e.preventDefault(); e.returnValue = ''; } });
if (!directSave) {
  $('browser-notice').hidden = false;
  $('browser-notice').textContent = 'Small-file download mode: captures up to 16 MiB and output up to 128 MiB. For large captures, use desktop Chrome or Edge over HTTPS.';
  $('save-note').textContent = 'After conversion, use Save LQC file. Download mode keeps the result in memory (128 MiB maximum).';
}
if (!window.isSecureContext) {
  $('browser-notice').hidden = false;
  $('browser-notice').textContent = 'Open this app over HTTPS or localhost. Local file saving and calibration fingerprints require a secure context.';
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      document.body.dataset.offlineReady = 'true';
      $('local-explanation').textContent = 'The app is cached for offline use. You can disconnect the network and still convert. Selected files are never uploaded or added to the app cache.';
    })
    .catch(() => { $('local-explanation').textContent = 'Files are processed locally and never uploaded. Offline caching is unavailable in this browser session; keep the connection until the worker loads.'; });
}

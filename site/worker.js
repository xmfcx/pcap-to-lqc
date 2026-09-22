import { convertCapture, inspectCapture } from './lib/converter.js';
let stopped = false, pending = null, active = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'ack') { pending?.resolve(); pending = null; return; }
  if (data.type === 'cancel') { stopped = true; pending?.reject(new DOMException('Conversion cancelled.', 'AbortError')); pending = null; return; }
  if (active) return;
  active = true; stopped = false;
  try {
    if (data.type === 'inspect') {
      self.postMessage({ type: 'inspected', result: await inspectCapture(data.file) });
    } else if (data.type === 'convert') {
      const report = await convertCapture({ ...data,
        cancelled: () => stopped,
        write: bytes => new Promise((resolve, reject) => {
          pending = { resolve, reject };
          self.postMessage({ type: 'chunk', buffer: bytes.buffer, offset: bytes.byteOffset, length: bytes.byteLength }, [bytes.buffer]);
        }),
        progress: report => self.postMessage({ type: 'progress', report }),
      });
      self.postMessage({ type: 'done', report });
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message, cancelled: error.name === 'AbortError' }); }
  finally { active = false; }
};

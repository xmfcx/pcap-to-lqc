import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const base = process.env.BASE_PATH || '/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(base)) throw new Error('Not found');
    path = '/' + path.slice(base.length);
    const target = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!target.startsWith(resolve(root) + sep) || !(await stat(target)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(target));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Local converter: http://127.0.0.1:${port}${base}\n`));

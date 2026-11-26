// Local preview only. No dependencies, network services, or production server.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
  try {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requestPath.split('/').some(part => part.startsWith('.'))) throw new Error('Not found');
    let target = path.resolve(root, '.' + requestPath);
    if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Not found');
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Inventory Audit preview: http://127.0.0.1:4173'));

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] || process.cwd();
const port = Number(process.argv[3] || 5179);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/test/fixtures/peek-mask-repro.html';
    const filePath = normalize(join(root, rel));
    if (!filePath.startsWith(normalize(root))) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': types[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`not found: ${error.message}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`static server on http://127.0.0.1:${port}/ (root=${root})`);
});

// The built page under the headers Cloudflare Pages would send (the `/*` block of dist/_headers,
// its Content-Security-Policy among them), so a walk meets what the host meets.
//   node walk/serve.mjs [dir] [port] [path]
// `path` serves the page under a sub-path the way GitHub Pages does (e.g. /my-tool/).
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4321);
const prefix = (process.argv[4] ?? '/').replace(/\/?$/, '/');

export function headersOf(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const start = lines.findIndex((l) => l.trim() === '/*');
  if (start < 0) throw new Error('_headers has no /* block');
  const out = {};
  for (const l of lines.slice(start + 1)) {
    if (!l.trim()) break;
    if (l.trim().startsWith('#')) continue;
    const i = l.indexOf(':');
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

const headers = headersOf(readFileSync(join(root, '_headers'), 'utf-8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
  let file = join(root, rel || 'index.html');
  if (!(file + sep).startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}${prefix}`));

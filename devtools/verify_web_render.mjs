/* End-to-end web render check: inject a real file into the web File-picker path and
 * assert the document actually renders in-app (content view shown, canvas/table/text
 * produced) via the blob → fetchBytes → renderer pipeline — no native bridge.
 *
 * Usage: node devtools/verify_web_render.mjs <path-to-doc> [more docs...]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'dist-web');
const docs = process.argv.slice(2);
if (!docs.length) { console.error('usage: verify_web_render.mjs <doc> [...]'); process.exit(2); }

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.bcmap': 'application/octet-stream',
  '.ttf': 'font/ttf', '.pfb': 'application/octet-stream',
};
let currentDoc = null; // absolute path of the doc under test, served at /__doc
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/__doc') {
    if (!currentDoc) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    fs.createReadStream(currentDoc).pipe(res);
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
let anyFail = false;

for (const doc of docs) {
  currentDoc = path.resolve(doc);
  const name = path.basename(doc);
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // Fetch the doc bytes in-page (via /__doc) to build a blob: URL — same shape the web
  // file-picker produces — without shuttling megabytes through the Node heap.
  await page.evaluate(async ({ name }) => {
    const res = await fetch('/__doc', { cache: 'no-store' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    // Reuse the recent-item click contract app.js listens for.
    const recent = document.getElementById('recent');
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.dataset.path = encodeURIComponent(url);
    item.dataset.name = encodeURIComponent(name);
    recent.appendChild(item);
    item.click();
  }, { name });

  // Wait for the content view to become visible (renderers call show('content')).
  let ok = false, detail = '';
  try {
    await page.waitForFunction(() => {
      const c = document.getElementById('content');
      const fwd = document.getElementById('forward');
      const forwarded = fwd && !fwd.classList.contains('hidden');
      if (forwarded) return true;
      const visibleContent = c && !c.classList.contains('hidden');
      if (!visibleContent) return false;
      // Content view is up — now wait for a real render artifact: a canvas/table/img,
      // or substantial extracted text (avoids matching a transient loading string).
      return c.querySelector('canvas, table, img') !== null
        || (c.textContent || '').trim().length > 200;
    }, { timeout: 45000 });
    detail = await page.evaluate(() => {
      const c = document.getElementById('content');
      const fwd = document.getElementById('forward');
      if (fwd && !fwd.classList.contains('hidden')) return 'FORWARDED (unsupported format)';
      const canvases = c.querySelectorAll('canvas').length;
      const tables = c.querySelectorAll('table').length;
      const imgs = c.querySelectorAll('img').length;
      const textLen = (c.textContent || '').trim().length;
      return `content: canvas=${canvases} table=${tables} img=${imgs} textLen=${textLen}`;
    });
    ok = detail.startsWith('FORWARDED') ? true
      : (/canvas=[1-9]|table=[1-9]|img=[1-9]/.test(detail) || /textLen=(?:[2-9]\d\d|\d{4,})/.test(detail));
  } catch (e) {
    detail = 'timeout: ' + e.message;
  }
  const status = ok ? 'OK ' : 'FAIL';
  if (!ok) anyFail = true;
  console.log(`[${status}] ${name} → ${detail}${errs.length ? ' | errors: ' + errs.join('; ') : ''}`);
  await page.close();
}

await browser.close();
server.close();
process.exit(anyFail ? 1 : 0);

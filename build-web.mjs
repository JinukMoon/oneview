/* OneView web build — produces a static PWA in dist-web/ for GitHub Pages.
 *
 * Strategy: the browser reuses the SAME app bundle as the Android app. Capacitor's
 * core reports isNativePlatform() === false in a plain browser, and web-shim.js
 * detects that and installs a web FileBridge (file picker + blob bytes + Web Share).
 * So there is no app.js fork — this build just ensures vendor assets exist and copies
 * www/ into dist-web/.
 *
 * Usage:
 *   node build.mjs        # (re)build vendor bundle + copy pdf.js cmaps/fonts/wasm
 *   node build-web.mjs    # copy www/ -> dist-web/ (runs build.mjs first if vendor missing)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(__dirname, 'www');
const out = path.join(__dirname, 'dist-web');
const vendorBundle = path.join(www, 'vendor', 'app-bundle.js');

// Ensure the vendor bundle exists (pdf.js/hwp/etc.). If not, run the main build.
if (!fs.existsSync(vendorBundle)) {
  console.log('vendor/app-bundle.js missing → running build.mjs first…');
  execFileSync(process.execPath, [path.join(__dirname, 'build.mjs')], { stdio: 'inherit' });
}

// Fresh output dir.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Copy the entire www/ tree (html, css, app.js, web-shim.js, sw.js, manifest,
// icon, vendor/*). Everything here is static and browser-safe.
fs.cpSync(www, out, { recursive: true });

// Drop local QA / dev-only files that live under www/ but must not ship to Pages.
for (const junk of ['rendertest.html', '_hwp', '_testfiles']) {
  fs.rmSync(path.join(out, junk), { recursive: true, force: true });
}

// GitHub Pages serves from a project subpath (user.github.io/<repo>/). Relative
// URLs in index.html/app.js/sw.js already use "./" so they work under any subpath.
// Add a .nojekyll so Pages doesn't strip files/dirs beginning with underscores and
// serves the vendor assets verbatim.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// Report size so the cache-explosion budget stays visible.
function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
const mb = (dirSize(out) / (1024 * 1024)).toFixed(1);
console.log(`Web build complete → dist-web/ (${mb} MB static assets).`);
console.log('Deploy dist-web/ to GitHub Pages (or run the bundled GitHub Action).');

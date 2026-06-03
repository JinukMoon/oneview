import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emptyShim = path.join(__dirname, 'src', 'empty.js');

// Main app bundle (pdf.js + hwp.js exposed on window)
await esbuild.build({
  entryPoints: [path.join(__dirname, 'src', 'bundle.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: path.join(__dirname, 'www', 'vendor', 'app-bundle.js'),
  alias: { fs: emptyShim, stream: emptyShim, 'readable-stream': emptyShim },
  loader: { '.wasm': 'file' },
  assetNames: '[name]',
  legalComments: 'none',
  logLevel: 'info',
});

// pdf.js worker as a classic (iife) script usable via GlobalWorkerOptions.workerSrc
await esbuild.build({
  entryPoints: [path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: path.join(__dirname, 'www', 'vendor', 'pdf.worker.js'),
  legalComments: 'none',
  logLevel: 'info',
});

// Copy pdf.js CJK character maps + standard fonts (needed for Korean PDFs)
const pdfDist = path.join(__dirname, 'node_modules', 'pdfjs-dist');
fs.cpSync(path.join(pdfDist, 'cmaps'), path.join(__dirname, 'www', 'vendor', 'cmaps'), { recursive: true });
fs.cpSync(path.join(pdfDist, 'standard_fonts'), path.join(__dirname, 'www', 'vendor', 'standard_fonts'), { recursive: true });
console.log('Copied cmaps + standard_fonts.');

// Ensure the @rhwp/core WASM is present at a stable path for runtime init()
fs.copyFileSync(
  path.join(__dirname, 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm'),
  path.join(__dirname, 'www', 'vendor', 'rhwp_bg.wasm'),
);
console.log('Copied rhwp_bg.wasm.');

console.log('Bundle build complete.');

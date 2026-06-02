// OneView crash-test harness.
// Usage: node test_files.mjs "<dir>" [perType]
// Recursively samples files and runs the same parse step OneView uses,
// reporting which files would crash the in-app renderer.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const hwp = require('hwp.js');
const XLSX = require('xlsx');
const { unzipSync } = await import('fflate');
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const DIR = process.argv[2];
const PER_TYPE = parseInt(process.argv[3] || '8', 10);
if (!DIR) { console.error('need a directory arg'); process.exit(1); }

function walk(d, acc = []) {
  let ents;
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

async function testHwp(p) {
  const buf = fs.readFileSync(p);
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  const d = hwp.parse(bin, { type: 'binary' });
  return `sections=${d.sections.length}`;
}
async function testPdf(p) {
  const data = new Uint8Array(fs.readFileSync(p));
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  for (let n = 1; n <= pdf.numPages; n++) { const pg = await pdf.getPage(n); pg.getViewport({ scale: 1 }); }
  return `${pdf.numPages}p`;
}
async function testXlsx(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer' });
  return `sheets=${wb.SheetNames.length}`;
}
async function testHwpx(p) {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(p)));
  const secs = Object.keys(zip).filter((n) => /section\d+\.xml$/i.test(n));
  if (!secs.length) throw new Error('no section xml');
  return `sections=${secs.length}`;
}

async function testPptx(p) {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(p)));
  if (!zip['ppt/presentation.xml']) throw new Error('not a valid pptx (no presentation.xml)');
  const slides = Object.keys(zip).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  return `slides=${slides} [구조검증]`;
}
async function testDocx(p) {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(p)));
  if (!zip['word/document.xml']) throw new Error('not a valid docx (no document.xml)');
  return `ok [구조검증]`;
}

const handlers = {
  '.hwp': testHwp, '.pdf': testPdf, '.xlsx': testXlsx, '.xls': testXlsx,
  '.hwpx': testHwpx, '.pptx': testPptx, '.docx': testDocx,
};

const all = walk(DIR);
const byExt = {};
for (const f of all) { const e = path.extname(f).toLowerCase(); if (handlers[e]) (byExt[e] ||= []).push(f); }

console.log(`found: ${Object.entries(byExt).map(([k, v]) => k + '=' + v.length).join(', ') || '(none)'}`);
let pass = 0, fail = 0;
for (const [ext, files] of Object.entries(byExt)) {
  const picks = sample(files, PER_TYPE);
  console.log(`\n=== ${ext}  (${picks.length}/${files.length}) ===`);
  for (const f of picks) {
    const name = path.basename(f);
    const mb = (fs.statSync(f).size / 1048576).toFixed(1);
    try {
      const info = await handlers[ext](f);
      pass++;
      console.log(`  ✅ ${name}  [${mb}MB]  ${info}`);
    } catch (e) {
      fail++;
      console.log(`  ❌ ${name}  [${mb}MB]  -> ${String(e.message || e).split('\n')[0]}`);
    }
  }
}
console.log(`\n=== TOTAL: ${pass} ok, ${fail} fail ===`);

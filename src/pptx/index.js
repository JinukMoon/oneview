// OneView PPTX renderer — public entry. Exposed on window.JVPptx via bundle.js.
// Pipeline: bytes → unzip (fflate) → parse (ooxml, DOM) → model → canvas render.

import { unzipSync } from 'fflate';
import { parsePptx } from './ooxml.js';
import { renderSlideCanvas, drawElements, summarizeModel, renderEl, registerRenderer } from './render.js';
import { extractSlideElements, extractLayerShapes } from './extract.js';
import { resolveSlideBackground, paintBackground } from './background.js';
import { embedToDataUrl } from './media.js';

// Parse pptx bytes into the backend-independent model (DOM elements retained on
// model.slides[].xml for later element extraction). Uses the platform DOMParser.
export function parse(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = unzipSync(bytes);
  const parseXml = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    // DOMParser signals malformed XML via a <parsererror> element (it does not throw);
    // treat that as a missing part instead of degrading to silent empty extraction.
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  };
  return parsePptx(zip, parseXml);
}

// Decode a data: URL into an HTMLImageElement (resolved when loaded).
function loadImage(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Downscale a decoded image whose longest edge exceeds MAX_IMG_EDGE onto an
// offscreen canvas, bounding decoded-bitmap memory on low-end phones. Returns the
// original image when it is already small enough. The result (Image or canvas) is
// a valid drawImage source.
const MAX_IMG_EDGE = 2048;
function downscaleImage(img) {
  const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!longest || longest <= MAX_IMG_EDGE) return img;
  const scale = MAX_IMG_EDGE / longest;
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  return cv; // drawPic reads .width/.height and draws via ctx.drawImage
}

// Render every slide: background (with inheritance) then the element list.
// Async because image backgrounds/fills must decode before drawing.
export async function renderInto(host, model, opts = {}) {
  const cssWidth = opts.width || 960;
  const oversample = opts.oversample || 3;
  // Generation guard: a re-render (e.g. zoom quality pass) that starts while an
  // earlier async render is still awaiting must supersede it. Without this, two
  // interleaved passes append canvases out of order → scrambled/duplicated slides
  // on repeated zoom. Each pass tags host.__renderGen; a stale pass aborts before
  // mutating the DOM, and only the latest pass swaps its finished canvases in.
  const gen = (host.__renderGen || 0) + 1;
  host.__renderGen = gen;
  const slideCount = model.slides.length;
  let slideNum = 0;
  const canvases = [];
  for (const slide of model.slides) {
    slideNum++;
    const { canvas, ctx, box } = renderSlideCanvas(slide, cssWidth, oversample);
    // Background (slide → layout → master inheritance).
    try {
      const bg = resolveSlideBackground(slide, model.zip);
      const bgImg = bg && bg.type === 'image' ? await loadImage(bg.dataUrl) : null;
      if (host.__renderGen !== gen) return 0; // superseded by a newer render
      paintBackground(ctx, bg, box, bgImg);
    } catch (e) { /* keep white base on background failure */ }
    // Draw order reproduces PowerPoint stacking: master decorations → layout
    // decorations → slide elements (background already painted above).
    const rels = slide.rels || {};
    const xml = slide.xml || {};
    const masterEls = extractLayerShapes(xml.master, slide, xml.layout, xml.master);
    for (const el of masterEls) attachEnv(el, slide, model, rels.master, 'ppt/slideMasters', slideNum, slideCount);
    const layoutEls = extractLayerShapes(xml.layout, slide, xml.layout, xml.master);
    for (const el of layoutEls) attachEnv(el, slide, model, rels.layout, 'ppt/slideLayouts', slideNum, slideCount);
    const els = extractSlideElements(slide);
    for (const el of els) attachEnv(el, slide, model, rels.slide, 'ppt/slides', slideNum, slideCount);
    // Pre-decode pic images (async) for every layer before the sync draw pass.
    await decodePicImages([...masterEls, ...layoutEls, ...els]);
    if (host.__renderGen !== gen) return 0; // superseded by a newer render
    drawElements(ctx, masterEls);
    drawElements(ctx, layoutEls);
    drawElements(ctx, els);
    canvas.className = 'pptx-slide-canvas';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto 12px';
    canvases.push(canvas);
  }
  if (host.__renderGen !== gen) return 0; // superseded before commit
  // Commit atomically: replace all children in one shot, preserving slide order.
  host.innerHTML = '';
  for (const c of canvases) host.appendChild(c);
  return model.slides.length;
}

// Attach media-resolution context (zip + slide rels + part dir) to an element
// and its group children so shape/image fills can resolve embedded media.
function attachEnv(el, slide, model, relsMap, partDir, slideNum, slideCount) {
  el.zip = model.zip;
  el.relsMap = relsMap || {};
  el.partDir = partDir || 'ppt/slides';
  el.slideNum = slideNum;
  el.slideCount = slideCount;
  if (el.children) for (const c of el.children) attachEnv(c, slide, model, relsMap, partDir, slideNum, slideCount);
}

// Resolve + decode every pic element's embedded image (recursively through groups)
// and attach the decoded HTMLImageElement as el.imageEl for the sync draw pass.
// Decodes run in parallel; failures leave el.imageEl undefined (pic renderer skips).
async function decodePicImages(elements) {
  const jobs = [];
  const walk = (el) => {
    if ((el.kind === 'pic' || el.kind === 'graphicFrame') && el.imageRef && el.imageRef.embed && !el.imageEl) {
      const url = embedToDataUrl(el.zip, el.relsMap, el.imageRef.embed, el.partDir);
      if (url) jobs.push(loadImage(url).then((img) => { if (img) el.imageEl = downscaleImage(img); }));
    }
    if (el.children) el.children.forEach(walk);
  };
  elements.forEach(walk);
  if (jobs.length) await Promise.all(jobs);
}

export { summarizeModel, renderEl, renderSlideCanvas, registerRenderer };

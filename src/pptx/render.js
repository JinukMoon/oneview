// OneView PPTX renderer — canvas render backend (skeleton for Phase 0).
//
// Single render signature (contract, enforced across all element renderers):
//   renderEl(ctx, el, parentXformEMU)
//     - ctx: CanvasRenderingContext2D already scaled so that 1 unit == 1 CSS px
//       of the slide (caller applies oversample separately on the backing store).
//     - el: a MODEL element (backend-independent, no px/ctx knowledge):
//       "backend-independent" = free of px/ctx/canvas knowledge; the element model
//       can be produced by either the canvas or bake backend. NOTE: the top-level
//       parse model (index.parse) is a MAIN-THREAD render model — its slides[].xml
//       retains live DOM parts for later element extraction, so it is not intended
//       to be structured-cloned to a worker. Element extraction (Phase 1+) emits the
//       DOM-free el objects below that renderEl actually consumes.
//         { kind: 'sp'|'pic'|'graphicFrame'|'grpSp' (+isGraphicFallback for chart/OLE),
//           xfrm: { off:{x,y}, ext:{cx,cy}, chOff?, chExt?, rot, flipH, flipV } (EMU),
//           fill?, line?, text?, imageRef?, table?, children? }
//     - parentXformEMU: { scaleX, scaleY, transX, transY } — SCALE + TRANSLATE ONLY.
//       rot/flip are NEVER carried here; each element applies its own rot/flip via the
//       ctx stack (save→translate(center)→rotate→scale(flip)→translate(-center)→…→restore),
//       so rotation/flip is applied exactly once (no double application through the parent).
//
// Element drawing is provided by kind renderers registered below and in later
// phases (shape/text/background now; group/image/table/chart later).

import { emuToPx, applyXform, angleToRad, IDENTITY_XFORM } from './units.js';
import { drawShape } from './shape.js';
import { drawGroup } from './group.js';
import { drawPic } from './image.js';
import { drawTable } from './table.js';
import { drawChartPlaceholder } from './chartFallback.js';

// Element-kind renderers are registered here by later phases.
const RENDERERS = Object.create(null);
export function registerRenderer(kind, fn) { RENDERERS[kind] = fn; }

// Apply an element's own rotation/flip around its center on the ctx stack, run the
// draw callback in that transformed space, then restore. Single application path.
export function withElementTransform(ctx, pxBox, rot, flipH, flipV, draw) {
  const cx = pxBox.x + pxBox.cx / 2;
  const cy = pxBox.y + pxBox.cy / 2;
  ctx.save();
  if (rot || flipH || flipV) {
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(angleToRad(rot));
    if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.translate(-cx, -cy);
  }
  try { draw(pxBox); } finally { ctx.restore(); }
}

// Dispatch a model element. Group recurses (Phase 2); leaves draw themselves.
export function renderEl(ctx, el, parentXformEMU = IDENTITY_XFORM) {
  if (!el) return;
  const fn = RENDERERS[el.kind];
  if (fn) { fn(ctx, el, parentXformEMU, { renderEl, withElementTransform, toPxBox }); return; }
  // Phase 0 fallback: no registered renderer yet — do nothing (skeleton).
}

// Convert an element's EMU box (through the parent scale/translate) to a px box.
// EMU→px happens here, exactly once at emit time.
export function toPxBox(el, parentXformEMU) {
  const abs = applyXform(parentXformEMU, el.xfrm.off, el.xfrm.ext);
  return { x: emuToPx(abs.x), y: emuToPx(abs.y), cx: emuToPx(abs.cx), cy: emuToPx(abs.cy) };
}

// Create a fresh per-slide <canvas> at the given CSS width, backing store at
// `oversample`× for zoom headroom, ctx pre-scaled to the slide's natural-px
// coordinate system. A white base is painted; the real background paints over it.
export function renderSlideCanvas(slide, cssWidth, oversample = 3) {
  const naturalW = emuToPx(slide.size.cx);
  const naturalH = emuToPx(slide.size.cy);
  const wPx = cssWidth;
  const hPx = Math.round(cssWidth * (naturalH / naturalW));
  // Cap the backing store so neither dimension exceeds MAX_BACKING_PX (bounds
  // per-canvas memory and stays under low-end mobile GPU max-texture limits even
  // when a high zoom oversample or a tall/portrait slide is requested).
  const MAX_BACKING_PX = 4096;
  const os = Math.max(1, Math.min(oversample, MAX_BACKING_PX / wPx, MAX_BACKING_PX / Math.max(1, hPx)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wPx * os);
  canvas.height = Math.round(hPx * os);
  canvas.style.width = wPx + 'px';
  canvas.style.height = hPx + 'px';
  const ctx = canvas.getContext('2d');
  const s = (wPx * os) / naturalW;
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';                 // base under the resolved background
  ctx.fillRect(0, 0, naturalW, naturalH);
  const box = { x: 0, y: 0, w: naturalW, h: naturalH };
  return { canvas, ctx, wPx, hPx, naturalW, naturalH, box };
}

// Draw an ordered element list onto a prepared slide ctx (elements carry their
// own EMU xfrm + env; renderEl dispatches to the registered kind renderer).
export function drawElements(ctx, elements, parentXformEMU = IDENTITY_XFORM) {
  for (const el of elements) renderEl(ctx, el, parentXformEMU);
}

// Register the shape renderer: compute px box from EMU, apply rot/flip on the
// ctx stack (single path), then draw geometry/fill/outline/text.
registerRenderer('sp', (ctx, el, parentXformEMU) => {
  if (!el.xfrm || !el.xfrm.ext.cx || !el.xfrm.ext.cy) return; // undrawable
  const b = toPxBox(el, parentXformEMU);
  const pxBox = { x: b.x, y: b.y, w: b.cx, h: b.cy, cx: b.cx, cy: b.cy };
  withElementTransform(ctx, pxBox, el.xfrm.rot, el.xfrm.flipH, el.xfrm.flipV, () => drawShape(ctx, el, pxBox));
});

// Register the group renderer: recurse into children with the composed child
// transform; the group's own rot/flip is applied once on the ctx stack.
registerRenderer('grpSp', (ctx, el, parentXformEMU, helpers) => {
  drawGroup(ctx, el, parentXformEMU, helpers);
});

// Register the picture renderer: same px-box + rot/flip pipeline as shapes.
registerRenderer('pic', (ctx, el, parentXformEMU) => {
  if (!el.xfrm || !el.xfrm.ext.cx || !el.xfrm.ext.cy) return;
  const b = toPxBox(el, parentXformEMU);
  const pxBox = { x: b.x, y: b.y, w: b.cx, h: b.cy, cx: b.cx, cy: b.cy };
  withElementTransform(ctx, pxBox, el.xfrm.rot, el.xfrm.flipH, el.xfrm.flipV, () => drawPic(ctx, el, pxBox));
});

// Register the graphicFrame renderer: tables draw as cells; chart/SmartArt/OLE
// draw their embedded raster preview when present, else a neutral placeholder.
// graphicFrame has no rot/flip in practice; position via toPxBox.
registerRenderer('graphicFrame', (ctx, el, parentXformEMU) => {
  if (!el.xfrm || !el.xfrm.ext.cx || !el.xfrm.ext.cy) return;
  const b = toPxBox(el, parentXformEMU);
  const pxBox = { x: b.x, y: b.y, w: b.cx, h: b.cy, cx: b.cx, cy: b.cy };
  if (el.tbl) { drawTable(ctx, el, pxBox); return; }
  if (el.imageEl) { drawPic(ctx, el, pxBox); return; }       // chart/OLE raster preview
  if (el.isGraphicFallback) drawChartPlaceholder(ctx, pxBox); // no preview → placeholder
});

// A serializable summary of a parsed model, used for the Phase 0 headless gate
// (window.__pptxModel). Contains no DOM nodes.
export function summarizeModel(model) {
  return {
    slideCount: model.slides.length,
    size: model.size,
    sizePx: { w: emuToPx(model.size.cx), h: emuToPx(model.size.cy) },
    slides: model.slides.map((s) => ({
      index: s.index,
      file: s.file,
      hasLayout: !!(s.xml && s.xml.layout),
      hasMaster: !!(s.xml && s.xml.master),
      hasTheme: !!(s.xml && s.xml.theme),
      themeColorCount: s.themeColors ? Object.keys(s.themeColors).length : 0,
      topLevelShapeCount: s.topLevelShapeCount || 0,
    })),
  };
}

// OneView PPTX renderer — background & fill painting.
// Resolves a slide's background (slide→layout→master inheritance, incl. theme
// bgRef/fmtScheme lookups) into a backend-neutral descriptor, and paints
// background/shape fills onto a 2D canvas context. Image (blipFill) fills are
// resolved to data URLs here; the actual async drawImage is the caller's job
// (backgrounds accept a pre-decoded imageEl; shape blipFills return a deferred
// descriptor). All XML traversal is namespace-agnostic DOM walking.

import { childByLocal, childrenByLocal } from './units.js';
import { resolveFirstColor } from './color.js';
import { embedToDataUrl } from './media.js';

// Fill container local names we understand, in the order we probe for them.
const FILL_TAGS = ['solidFill', 'gradFill', 'blipFill', 'noFill', 'pattFill', 'grpFill'];

// Convert a resolved 'rgb(r, g, b)' / 'rgba(r, g, b, a)' string back to a 6-hex
// string (no '#'), for reuse as a phClr base. Returns null on non-rgb input.
function rgbStringToHex(rgb) {
  if (!rgb) return null;
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  const h = (n) => (Number(n) & 255).toString(16).padStart(2, '0');
  return h(m[1]) + h(m[2]) + h(m[3]);
}

// First recognized fill child of a container (bgPr, spPr, style fill entry, …).
function firstFillEl(parent) {
  if (!parent) return null;
  for (let n = parent.firstElementChild; n; n = n.nextElementSibling) {
    const local = n.localName || (n.nodeName ? String(n.nodeName).split(':').pop() : '');
    if (FILL_TAGS.includes(local)) return n;
  }
  return null;
}

// <p:cSld><p:bg> element of a slide/layout/master root, or null.
function bgElOf(root) {
  const cSld = childByLocal(root, 'cSld');
  return cSld ? childByLocal(cSld, 'bg') : null;
}

// theme <a:fmtScheme> element (theme→themeElements→fmtScheme).
function fmtSchemeOf(themeEl) {
  if (!themeEl) return null;
  const themeElements = childByLocal(themeEl, 'themeElements');
  return themeElements ? childByLocal(themeElements, 'fmtScheme') : null;
}

// Resolve a bgRef idx to its theme fill element. idx 1..999 indexes fillStyleLst
// (1-based); idx >= 1000 indexes bgFillStyleLst as (idx-1000, 1-based). idx 0 = none.
function themeFillForBgRef(themeEl, idx) {
  const n = Number(idx) || 0;
  if (n <= 0) return null;
  const fmt = fmtSchemeOf(themeEl);
  if (!fmt) return null;
  const list = n >= 1000 ? childByLocal(fmt, 'bgFillStyleLst') : childByLocal(fmt, 'fillStyleLst');
  if (!list) return null;
  const pos = n >= 1000 ? n - 1000 : n; // 1-based position in the list
  const fills = [];
  for (let c = list.firstElementChild; c; c = c.nextElementSibling) {
    const local = c.localName || (c.nodeName ? String(c.nodeName).split(':').pop() : '');
    if (FILL_TAGS.includes(local)) fills.push(c);
  }
  return fills[pos - 1] || null;
}

// Parse a <a:gradFill> element into a gradient descriptor.
// pos attrs are 1000ths of a percent (0..100000); angle is 60000ths of a degree.
function describeGradient(gradEl, themeColors, phClr) {
  const stops = [];
  const gsLst = childByLocal(gradEl, 'gsLst');
  if (gsLst) {
    for (const gs of childrenByLocal(gsLst, 'gs')) {
      const pos = (parseInt(gs.getAttribute('pos'), 10) || 0) / 100000;
      const color = resolveFirstColor(gs, themeColors, phClr);
      if (color) stops.push({ pos, color });
    }
  }
  stops.sort((a, b) => a.pos - b.pos);
  const pathEl = childByLocal(gradEl, 'path');
  const linEl = childByLocal(gradEl, 'lin');
  let kind = 'linear';
  let angle = 0;
  if (pathEl) {
    kind = 'radial';
  } else if (linEl) {
    angle = (parseInt(linEl.getAttribute('ang'), 10) || 0) / 60000;
  }
  return { type: 'gradient', kind, angle, stops };
}

// Turn a fill element into a background/fill descriptor.
// ctx = { themeColors, phClr, zip, relsMap, partDir }. Returns null for unknowns.
function describeFill(fillEl, ctx) {
  if (!fillEl) return null;
  const local = fillEl.localName || (fillEl.nodeName ? String(fillEl.nodeName).split(':').pop() : '');
  const themeColors = (ctx && ctx.themeColors) || {};
  const phClr = ctx && ctx.phClr;
  switch (local) {
    case 'solidFill': {
      const color = resolveFirstColor(fillEl, themeColors, phClr);
      return color ? { type: 'solid', color } : { type: 'none' };
    }
    case 'gradFill':
      return describeGradient(fillEl, themeColors, phClr);
    case 'blipFill': {
      const blip = childByLocal(fillEl, 'blip');
      const embedId =
        blip &&
        (blip.getAttribute('r:embed') ||
          blip.getAttribute('embed') ||
          blip.getAttributeNS(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
            'embed'
          ));
      const dataUrl = embedId
        ? embedToDataUrl(ctx && ctx.zip, ctx && ctx.relsMap, embedId, ctx && ctx.partDir)
        : null;
      return { type: 'image', dataUrl };
    }
    case 'noFill':
      return { type: 'none' };
    default:
      // pattFill / grpFill and anything else: treat as no explicit fill here.
      return null;
  }
}

// Resolve a single source (slide/layout/master) bg into a descriptor, or null
// when the source has no <p:bg>. src = { root, themeEl, relsMap, partDir }.
function backgroundOfSource(src) {
  const bg = bgElOf(src.root);
  if (!bg) return null;
  const themeColors = src.themeColors || {};
  const bgPr = childByLocal(bg, 'bgPr');
  if (bgPr) {
    const fillEl = firstFillEl(bgPr);
    const desc = describeFill(fillEl, {
      themeColors,
      phClr: null,
      zip: src.zip,
      relsMap: src.relsMap,
      partDir: src.partDir,
    });
    return desc || { type: 'none' };
  }
  const bgRef = childByLocal(bg, 'bgRef');
  if (bgRef) {
    const idx = bgRef.getAttribute('idx');
    // The color inside bgRef is the placeholder color (phClr) for the theme fill.
    // describeFill expects phClr as a HEX string, so convert the resolved rgb().
    const phClr = rgbStringToHex(resolveFirstColor(bgRef, themeColors, null));
    const themeFill = themeFillForBgRef(src.themeEl, idx);
    const desc = describeFill(themeFill, {
      themeColors,
      phClr,
      zip: src.zip,
      relsMap: src.relsMap,
      partDir: src.partDir,
    });
    return desc || { type: 'none' };
  }
  return { type: 'none' };
}

// Export 1 — resolve a slide's background descriptor with slide→layout→master
// inheritance. `zip` is the whole unzipped package map (model.zip) needed to
// resolve embedded image fills.
// Returns one of:
//   { type:'solid', color }
//   { type:'gradient', kind:'linear'|'radial', angle:deg, stops:[{pos,color}] }
//   { type:'image', dataUrl }
//   { type:'none' }
export function resolveSlideBackground(slide, zip) {
  if (!slide || !slide.xml) return { type: 'none' };
  const themeColors = slide.themeColors || {};
  const themeEl = slide.xml.theme || null;
  const rels = slide.rels || {};
  const sources = [
    { root: slide.xml.slide, relsMap: rels.slide, partDir: 'ppt/slides' },
    { root: slide.xml.layout, relsMap: rels.layout, partDir: 'ppt/slideLayouts' },
    { root: slide.xml.master, relsMap: rels.master, partDir: 'ppt/slideMasters' },
  ];
  for (const s of sources) {
    if (!s.root) continue;
    const desc = backgroundOfSource({ ...s, themeColors, themeEl, zip });
    if (desc && desc.type !== 'none') return desc;
    // A present-but-empty bg (explicit noFill) still counts: stop inheriting.
    if (desc && bgElOf(s.root)) return desc;
  }
  return { type: 'none' };
}

// Compute a linear-gradient line spanning `box` for a DrawingML angle (degrees,
// 0 = left→right, clockwise as y grows down). Returns {x0,y0,x1,y1}.
function linearGradientLine(box, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Half-length so the line reaches the box's extent along the gradient direction.
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
  return {
    x0: cx - dx * half,
    y0: cy - dy * half,
    x1: cx + dx * half,
    y1: cy + dy * half,
  };
}

// Paint a gradient descriptor into `box`. Shared by backgrounds and shape fills.
function paintGradient(ctx, grad, box) {
  const stops = grad.stops && grad.stops.length ? grad.stops : [{ pos: 0, color: '#fff' }];
  let g;
  if (grad.kind === 'radial') {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = Math.max(box.w, box.h) / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r || 1);
  } else {
    const { x0, y0, x1, y1 } = linearGradientLine(box, grad.angle || 0);
    g = ctx.createLinearGradient(x0, y0, x1, y1);
  }
  for (const s of stops) {
    g.addColorStop(Math.min(1, Math.max(0, s.pos)), s.color);
  }
  ctx.fillStyle = g;
  ctx.fillRect(box.x, box.y, box.w, box.h);
}

// Export 2 — paint a resolved background descriptor into `box` (natural px).
// `imageEl` is a pre-decoded HTMLImageElement for image backgrounds; when absent
// an image background falls back to white. `none` draws nothing (caller's white).
export function paintBackground(ctx, desc, box, imageEl) {
  if (!desc) return;
  switch (desc.type) {
    case 'solid':
      ctx.fillStyle = desc.color;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      return;
    case 'gradient':
      paintGradient(ctx, desc, box);
      return;
    case 'image':
      if (imageEl) {
        ctx.drawImage(imageEl, box.x, box.y, box.w, box.h); // 100% stretch
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(box.x, box.y, box.w, box.h);
      }
      return;
    case 'none':
    default:
      return;
  }
}

// Export 3 — generic shape fill painter (used by shape.js). Paints synchronous
// fills (solid/gradient) directly and returns true. For blipFill it returns
// { deferImage: dataUrl } so the caller can decode+drawImage asynchronously.
// noFill (or an unpaintable fill) returns false. styleCtx = { themeColors, phClr,
// zip, relsMap, partDir }.
export function paintFill(ctx, fillEl, box, styleCtx = {}) {
  const desc = describeFill(fillEl, styleCtx);
  if (!desc) return false;
  switch (desc.type) {
    case 'solid':
      ctx.fillStyle = desc.color;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      return true;
    case 'gradient':
      paintGradient(ctx, desc, box);
      return true;
    case 'image':
      return { deferImage: desc.dataUrl };
    case 'none':
    default:
      return false;
  }
}

export const _internal = { describeFill, describeGradient, themeFillForBgRef, firstFillEl, bgElOf };

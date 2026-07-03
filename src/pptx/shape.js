// OneView PPTX renderer — shape (sp / cxnSp) drawing.
// Draws preset geometry (rect/roundRect/ellipse/line; others fall back to the
// bounding rect), fill and outline, then delegates text to text.js. Positioning,
// oversample and rot/flip are handled by the caller (render.js via toPxBox +
// withElementTransform); this module draws inside the given natural-px box.

import { childByLocal, emuToPx } from './units.js';
import { paintFill } from './background.js';
import { drawText } from './text.js';
import { resolveFirstColor } from './color.js';

// Build a Path2D for a preset geometry inside box {x,y,w,h}.
function geomPath(prst, box) {
  const { x, y, w, h } = box;
  const p = new Path2D();
  switch (prst) {
    case 'ellipse':
    case 'chord':
    case 'pie':
      p.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      break;
    case 'roundRect': {
      const r = Math.min(w, h) * 0.1;
      p.moveTo(x + r, y);
      p.arcTo(x + w, y, x + w, y + h, r);
      p.arcTo(x + w, y + h, x, y + h, r);
      p.arcTo(x, y + h, x, y, r);
      p.arcTo(x, y, x + w, y, r);
      p.closePath();
      break;
    }
    case 'line':
    case 'straightConnector1':
      p.moveTo(x, y);
      p.lineTo(x + w, y + h);
      break;
    default: // rect and every unsupported preset → bounding rect
      p.rect(x, y, w, h);
      break;
  }
  return p;
}

function prstOf(spPr) {
  const g = spPr ? childByLocal(spPr, 'prstGeom') : null;
  return g ? (g.getAttribute('prst') || 'rect') : 'rect';
}

// Draw the outline (a:ln) of a shape along its geometry path.
function strokeLine(ctx, spPr, path, themeColors) {
  const ln = spPr ? childByLocal(spPr, 'ln') : null;
  if (!ln) return;
  if (childByLocal(ln, 'noFill')) return;
  const wEmu = parseInt(ln.getAttribute('w'), 10);
  const color = resolveFirstColor(childByLocal(ln, 'solidFill'), themeColors) || null;
  if (!color) return; // no explicit line color → skip (avoid inventing borders)
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Number.isFinite(wEmu) && wEmu > 0 ? Math.max(1, emuToPx(wEmu)) : 1;
  ctx.stroke(path);
  ctx.restore();
}

// el: { kind:'sp'|..., dom, xfrm, txBody, styleChain, masterTxStyle, ph, themeColors, zip, relsMap, partDir }
// pxBox: {x,y,w,h} natural px (already position/oversample/rot/flip-transformed by caller).
export function drawShape(ctx, el, pxBox) {
  const spPr = childByLocal(el.dom, 'spPr');
  const prst = prstOf(spPr);
  const path = geomPath(prst, pxBox);
  const isLine = prst === 'line' || prst === 'straightConnector1';

  // Fill (skip for line-like geometry).
  if (!isLine && spPr) {
    const fillEl = childByLocal(spPr, 'solidFill')
      || childByLocal(spPr, 'gradFill')
      || childByLocal(spPr, 'blipFill')
      || childByLocal(spPr, 'noFill');
    if (fillEl && fillEl.localName !== 'noFill') {
      ctx.save();
      ctx.clip(path);
      paintFill(ctx, fillEl, pxBox, {
        themeColors: el.themeColors,
        phClr: null,
        zip: el.zip,
        relsMap: el.relsMap,
        partDir: el.partDir,
      });
      ctx.restore();
    }
  }

  // Outline.
  strokeLine(ctx, spPr, path, el.themeColors);

  // Text.
  if (el.txBody) {
    drawText(ctx, el.txBody, pxBox, {
      styleChain: el.styleChain || [],
      masterTxStyle: el.masterTxStyle || null,
      phType: el.ph ? el.ph.type : '',
      themeColors: el.themeColors || {},
      defaultFontPt: 18,
    });
  }
}

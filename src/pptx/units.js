// OneView PPTX renderer — units & coordinate/affine utilities.
// All OOXML positions/sizes are EMU. The ONLY conversion is emuToPx = EMU / 9525.
// Coordinates stay in EMU through the whole model/transform pipeline; px conversion
// happens exactly once at canvas emit time. No "large value means EMU" heuristics.

export const EMU_PER_PX = 9525;               // 914400 EMU/inch ÷ 96 px/inch
export const emuToPx = (v) => (Number(v) || 0) / EMU_PER_PX;

// Angles in DrawingML are 60000ths of a degree.
export const ANGLE_UNIT = 60000;
export const angleToRad = (rot) => ((Number(rot) || 0) / ANGLE_UNIT) * Math.PI / 180;
export const angleToDeg = (rot) => (Number(rot) || 0) / ANGLE_UNIT;

// Line widths / many DrawingML measures are EMU too; expose a helper for clarity.
export const emuLineToPx = (v) => emuToPx(v);

const intAttr = (el, name, dflt = 0) => {
  if (!el) return dflt;
  const v = el.getAttribute(name);
  if (v == null || v === '') return dflt;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};
const boolAttr = (el, name) => {
  if (!el) return false;
  const v = el.getAttribute(name);
  return v === '1' || v === 'true';
};

// Query a direct DrawingML child by local name, namespace-agnostic.
export function childByLocal(el, localName) {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === localName) return c;
  }
  return null;
}
export function childrenByLocal(el, localName) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === localName) out.push(c);
  }
  return out;
}

// Parse an <a:xfrm> element into an EMU-space transform record.
// Returns null when there is no xfrm (caller decides inheritance/placeholder).
export function parseXfrm(xfrmEl) {
  if (!xfrmEl) return null;
  const off = childByLocal(xfrmEl, 'off');
  const ext = childByLocal(xfrmEl, 'ext');
  const chOff = childByLocal(xfrmEl, 'chOff');
  const chExt = childByLocal(xfrmEl, 'chExt');
  return {
    off: { x: intAttr(off, 'x'), y: intAttr(off, 'y') },
    ext: { cx: intAttr(ext, 'cx'), cy: intAttr(ext, 'cy') },
    // chOff/chExt only exist on group xfrm; null elsewhere.
    chOff: chOff ? { x: intAttr(chOff, 'x'), y: intAttr(chOff, 'y') } : null,
    chExt: chExt ? { cx: intAttr(chExt, 'cx'), cy: intAttr(chExt, 'cy') } : null,
    rot: intAttr(xfrmEl, 'rot', 0),          // 60000ths of a degree
    flipH: boolAttr(xfrmEl, 'flipH'),
    flipV: boolAttr(xfrmEl, 'flipV'),
  };
}

// Identity parent transform: scale + translate ONLY. rot/flip are never carried
// here — they are applied per element via the canvas ctx stack (single path,
// no double application). transX/transY are EMU.
export const IDENTITY_XFORM = Object.freeze({ scaleX: 1, scaleY: 1, transX: 0, transY: 0 });

// Compose a parent (scale+translate, EMU) with a group's own xfrm to produce the
// transform passed to that group's children. Group rotation/flip are NOT folded
// in here; the group applies them on the ctx stack before recursing.
//
// Group child mapping (EMU space):
//   sx = ext.cx / chExt.cx,  sy = ext.cy / chExt.cy
//   childAbs.x = (child.x - chOff.x) * sx + off.x
//   childAbs.y = (child.y - chOff.y) * sy + off.y
// Expressed as a scale+translate on child-local EMU coords:
//   x' = child.x * sx + (off.x - chOff.x * sx)
// then further composed with the incoming parent scale+translate.
export function composeGroupXform(parent, groupXfrm) {
  const p = parent || IDENTITY_XFORM;
  const { off, ext, chOff, chExt } = groupXfrm;
  const co = chOff || { x: 0, y: 0 };
  const ce = chExt || { cx: ext.cx, cy: ext.cy };
  const sx = ce.cx ? ext.cx / ce.cx : 1;   // chExt 0 → 1 (defensive)
  const sy = ce.cy ? ext.cy / ce.cy : 1;
  // local child EMU → group-parent EMU
  const localScaleX = sx;
  const localScaleY = sy;
  const localTransX = off.x - co.x * sx;
  const localTransY = off.y - co.y * sy;
  // fold with incoming parent scale+translate
  return {
    scaleX: p.scaleX * localScaleX,
    scaleY: p.scaleY * localScaleY,
    transX: p.transX + p.scaleX * localTransX,
    transY: p.transY + p.scaleY * localTransY,
  };
}

// Map an element's own EMU box (off/ext) through a parent scale+translate to an
// absolute EMU box. rot/flip stay on the element for ctx-stack application.
export function applyXform(parent, off, ext) {
  const p = parent || IDENTITY_XFORM;
  return {
    x: p.transX + p.scaleX * (off.x || 0),
    y: p.transY + p.scaleY * (off.y || 0),
    cx: p.scaleX * (ext.cx || 0),
    cy: p.scaleY * (ext.cy || 0),
  };
}

export const util = { intAttr, boolAttr };

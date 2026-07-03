// OneView PPTX renderer — group (grpSp) recursive rendering.
//
// A group maps its child coordinate space (chOff/chExt) onto its own box (off/ext):
//   sx = ext.cx / chExt.cx,  sy = ext.cy / chExt.cy
//   childAbs.x = (child.x - chOff.x) * sx + off.x   (and y analogously)
//   childAbs.w = child.cx * sx,  childAbs.h = child.cy * sy
// composeGroupXform folds this into the incoming parent scale+translate (EMU space),
// so children keep their own EMU xfrm and are only converted to px once, at leaf emit.
// The group's OWN rotation/flip is applied on the canvas ctx stack (single path,
// around the group's px center) before recursing — never carried in parentXformEMU,
// which prevents double application. Nested groups recurse the same way.

import { composeGroupXform, applyXform, emuToPx } from './units.js';

// helpers passed in by render.js: { renderEl, withElementTransform }
export function drawGroup(ctx, el, parentXformEMU, helpers) {
  // Defensive: valid OOXML groups always carry grpSpPr/xfrm and children; a group
  // missing either has nothing positionable to draw, so skip it.
  if (!el.xfrm || !el.children || !el.children.length) return;
  const { renderEl, withElementTransform } = helpers;

  // Group box in px (through the incoming parent transform, WITHOUT the group's
  // own rot/flip) — used only as the pivot for the ctx-stack rotation/flip.
  const abs = applyXform(parentXformEMU, el.xfrm.off, el.xfrm.ext);
  const pxBox = { x: emuToPx(abs.x), y: emuToPx(abs.y), cx: emuToPx(abs.cx), cy: emuToPx(abs.cy) };

  // Child transform = parent ∘ (group child-space mapping). Scale + translate only.
  const childXform = composeGroupXform(parentXformEMU, el.xfrm);

  withElementTransform(ctx, pxBox, el.xfrm.rot, el.xfrm.flipH, el.xfrm.flipV, () => {
    for (const child of el.children) renderEl(ctx, child, childXform);
  });
}

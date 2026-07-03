// OneView PPTX renderer — element extraction.
// Walks a slide's spTree and produces the render element list, resolving each
// element's EMU xfrm (with placeholder inheritance from layout→master) and the
// text style inheritance chain. Elements retain their source DOM (main-thread
// render model) for the draw modules to read fills/geometry/text from.

import { childByLocal, childrenByLocal, parseXfrm } from './units.js';

const SHAPE_KINDS = { sp: 'sp', pic: 'pic', graphicFrame: 'graphicFrame', grpSp: 'grpSp', cxnSp: 'sp' };
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// First <a:blip r:embed> id anywhere inside a subtree (used for chart/OLE/diagram
// raster preview fallback). Namespace-agnostic; returns the rId or null.
function firstBlipEmbed(root) {
  const all = root.getElementsByTagName ? root.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.localName === 'blip') {
      const id = e.getAttribute('r:embed') || e.getAttributeNS(REL_NS, 'embed') || e.getAttribute('embed');
      if (id) return id;
    }
  }
  return null;
}

// Placeholder descriptor { type, idx } from an sp's nvSpPr/nvPr/ph.
export function phOf(spEl) {
  const nv = childByLocal(spEl, 'nvSpPr') || childByLocal(spEl, 'nvPicPr') || childByLocal(spEl, 'nvGraphicFramePr');
  const nvPr = nv ? childByLocal(nv, 'nvPr') : null;
  const ph = nvPr ? childByLocal(nvPr, 'ph') : null;
  if (!ph) return null;
  return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') || '' };
}

// spPr (or graphicFrame) xfrm element for a shape.
function xfrmElOf(el) {
  if (el.localName === 'graphicFrame') return childByLocal(el, 'xfrm');
  const spPr = childByLocal(el, 'spPr') || childByLocal(el, 'grpSpPr');
  return spPr ? childByLocal(spPr, 'xfrm') : null;
}

// Find a matching placeholder sp inside a layout/master spTree by type/idx.
function findPh(rootEl, ph) {
  if (!rootEl || !ph) return null;
  const cSld = childByLocal(rootEl, 'cSld');
  const spTree = cSld ? childByLocal(cSld, 'spTree') : null;
  if (!spTree) return null;
  let typeMatch = null;
  for (const sp of childrenByLocal(spTree, 'sp')) {
    const p = phOf(sp);
    if (!p) continue;
    if (p.idx === ph.idx && p.type === ph.type) return sp;      // exact
    if (p.idx === ph.idx && ph.idx) return sp;                  // idx match
    if (!typeMatch && p.type === ph.type) typeMatch = sp;       // type fallback
  }
  return typeMatch;
}

// Resolve a shape's EMU xfrm, inheriting from the layout then master placeholder
// when the shape itself carries no xfrm.
function resolveXfrm(el, ph, layoutEl, masterEl) {
  let xf = parseXfrm(xfrmElOf(el));
  if (xf && xf.ext.cx && xf.ext.cy) return xf;
  if (ph) {
    const lp = findPh(layoutEl, ph);
    const lxf = lp ? parseXfrm(xfrmElOf(lp)) : null;
    if (lxf && lxf.ext.cx && lxf.ext.cy) return lxf;
    const mp = findPh(masterEl, ph);
    const mxf = mp ? parseXfrm(xfrmElOf(mp)) : null;
    if (mxf && mxf.ext.cx && mxf.ext.cy) return mxf;
  }
  return xf; // may be null; caller skips undrawable elements
}

// master <p:txStyles> style element for a placeholder type.
function masterTxStyleFor(masterEl, phType) {
  const txStyles = masterEl ? childByLocal(masterEl, 'txStyles') : null;
  if (!txStyles) return null;
  if (phType === 'title' || phType === 'ctrTitle') return childByLocal(txStyles, 'titleStyle');
  if (phType === 'body' || phType === 'subTitle' || phType === 'obj') return childByLocal(txStyles, 'bodyStyle');
  return childByLocal(txStyles, 'otherStyle');
}

// Ordered text-style inheritance chain (most specific first): the shape's own
// txBody/lstStyle, then the matching layout ph lstStyle, then master ph lstStyle.
// masterTxStyle (titleStyle/bodyStyle/otherStyle) and themeColors are passed
// separately so text.js can apply the 5-level chain.
function textStyleChain(spEl, ph, layoutEl, masterEl) {
  const chain = [];
  const lstOf = (sp) => {
    const tb = sp ? childByLocal(sp, 'txBody') : null;
    return tb ? childByLocal(tb, 'lstStyle') : null;
  };
  const own = lstOf(spEl);
  if (own) chain.push(own);
  if (ph) {
    const lp = findPh(layoutEl, ph); const ls = lstOf(lp); if (ls) chain.push(ls);
    const mp = findPh(masterEl, ph); const ms = lstOf(mp); if (ms) chain.push(ms);
  }
  return chain;
}

// Extract the top-level render elements of a slide.
export function extractSlideElements(slide) {
  const slideEl = slide.xml && slide.xml.slide;
  const layoutEl = slide.xml && slide.xml.layout;
  const masterEl = slide.xml && slide.xml.master;
  if (!slideEl) return [];
  const cSld = childByLocal(slideEl, 'cSld');
  const spTree = cSld ? childByLocal(cSld, 'spTree') : null;
  if (!spTree) return [];
  const out = [];
  for (let n = spTree.firstElementChild; n; n = n.nextElementSibling) {
    const kind = SHAPE_KINDS[n.localName];
    if (!kind) continue;
    const ph = (kind === 'sp') ? phOf(n) : null;
    out.push(buildEl(n, kind, ph, slide, layoutEl, masterEl));
  }
  return out;
}

// Extract non-placeholder decorative shapes from a master/layout root (header
// bars, accent lines, logos). Placeholders are inheritance templates, not drawn
// content, so they are skipped here (their content comes from the slide). These
// render UNDER the slide's own elements to reproduce PowerPoint's master→layout
// →slide stacking.
export function extractLayerShapes(rootEl, slide, layoutEl, masterEl) {
  if (!rootEl) return [];
  const cSld = childByLocal(rootEl, 'cSld');
  const spTree = cSld ? childByLocal(cSld, 'spTree') : null;
  if (!spTree) return [];
  const out = [];
  for (let n = spTree.firstElementChild; n; n = n.nextElementSibling) {
    const kind = SHAPE_KINDS[n.localName];
    if (!kind) continue;
    if (kind === 'sp' && phOf(n)) continue;  // skip placeholder templates
    out.push(buildEl(n, kind, null, slide, layoutEl, masterEl));
  }
  return out;
}

function buildEl(domEl, kind, ph, slide, layoutEl, masterEl) {
  const xfrm = resolveXfrm(domEl, ph, layoutEl, masterEl);
  const el = { kind, dom: domEl, xfrm, ph };
  if (kind === 'sp') {
    const txBody = childByLocal(domEl, 'txBody');
    el.txBody = txBody || null;
    el.styleChain = txBody ? textStyleChain(domEl, ph, layoutEl, masterEl) : [];
    el.masterTxStyle = ph ? masterTxStyleFor(masterEl, ph.type) : null;
  }
  if (kind === 'pic') {
    // <p:pic><p:blipFill><a:blip r:embed="rId..">; optional <a:srcRect> crop.
    const blipFill = childByLocal(domEl, 'blipFill');
    const blip = blipFill ? childByLocal(blipFill, 'blip') : null;
    const embed = blip ? (blip.getAttribute('r:embed') || blip.getAttributeNS(REL_NS, 'embed') || blip.getAttribute('embed')) : null;
    const srcRectEl = blipFill ? childByLocal(blipFill, 'srcRect') : null;
    el.imageRef = embed ? { embed } : null;
    el.srcRect = srcRectEl ? {
      l: (parseInt(srcRectEl.getAttribute('l'), 10) || 0) / 100000,
      t: (parseInt(srcRectEl.getAttribute('t'), 10) || 0) / 100000,
      r: (parseInt(srcRectEl.getAttribute('r'), 10) || 0) / 100000,
      b: (parseInt(srcRectEl.getAttribute('b'), 10) || 0) / 100000,
    } : null;
  }
  if (kind === 'graphicFrame') {
    // <p:graphicFrame><a:graphic><a:graphicData><a:tbl>...  (also charts/diagrams,
    // handled in a later phase). Attach the tbl element for the table renderer.
    const graphic = childByLocal(domEl, 'graphic');
    const gd = graphic ? childByLocal(graphic, 'graphicData') : null;
    el.tbl = gd ? childByLocal(gd, 'tbl') : null;
    el.graphicUri = gd ? (gd.getAttribute('uri') || '') : '';
    // Non-table graphicFrame (chart / SmartArt diagram / OLE object): best-effort
    // raster fallback. Charts hold no embedded raster (vector) → firstBlipEmbed
    // returns null → placeholder. SmartArt (diagram) may contain per-node image
    // fills whose first blip is NOT a whole-diagram preview, so route it straight
    // to the placeholder rather than a misleading partial image. OLE objects carry
    // a genuine whole-object preview blip → use it. Reuse el.imageRef so the decode
    // pass loads it like a pic.
    if (!el.tbl) {
      const isDiagram = /diagram/i.test(el.graphicUri);
      const embed = isDiagram ? null : firstBlipEmbed(domEl);
      el.imageRef = embed ? { embed } : null;
      el.isGraphicFallback = true;
    }
  }
  if (kind === 'grpSp') {
    // Recurse fully into group children (buildEl is recursive, so nested groups
    // are extracted deep); Phase 2's grpSp renderer walks these with composed xforms.
    el.children = [];
    for (let c = domEl.firstElementChild; c; c = c.nextElementSibling) {
      const ck = SHAPE_KINDS[c.localName];
      if (!ck) continue;
      const cph = (ck === 'sp') ? phOf(c) : null;
      el.children.push(buildEl(c, ck, cph, slide, layoutEl, masterEl));
    }
  }
  el.themeColors = slide.themeColors || {};
  return el;
}

// OneView PPTX renderer — OOXML parser.
// Turns an unzipped pptx map (fflate) into a backend-independent model.
// Backend-neutral: never touches DOMParser directly — the caller injects
// parseXml(xmlText) -> Document. XML is traversed via localName-based DOM walking
// (namespace-agnostic), never regex tag matching.

import { childByLocal, childrenByLocal, parseXfrm } from './units.js';
import { themeColorsFromClrScheme } from './color.js';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DEFAULT_SIZE = { cx: 12192000, cy: 6858000 };
const TOP_LEVEL_SHAPES = new Set(['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp']);

// Local name of a DOM node, stripping any namespace prefix.
function localOf(el) {
  return el && (el.localName || (el.nodeName ? String(el.nodeName).split(':').pop() : ''));
}

// Normalize a rels Target relative to a base directory.
// resolveRel('ppt/slides', '../slideLayouts/slideLayout1.xml') -> 'ppt/slideLayouts/slideLayout1.xml'
// resolveRel('ppt', 'slides/slide1.xml') -> 'ppt/slides/slide1.xml'
function resolveRel(baseDir, target) {
  if (!target) return null;
  if (/^[a-z]+:\/\//i.test(target)) return target; // external URL — leave as-is
  const t = target.replace(/^\.\//, '');
  const baseParts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const parts = t.split('/');
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') baseParts.pop();
    else baseParts.push(seg);
  }
  return baseParts.join('/');
}

const basename = (p) => (p ? p.split('/').pop() : null);
const dirOf = (p) => (p ? p.split('/').slice(0, -1).join('/') : '');
const relsPathFor = (partPath) => `${dirOf(partPath)}/_rels/${basename(partPath)}.rels`;
// Pick a rels target by Type suffix, falling back to a Target substring match.
const findRelTarget = (list, typeSuffix, targetContains) =>
  (list.find((r) => r.type.endsWith(typeSuffix)) || {}).target ||
  (list.find((r) => r.target && r.target.includes(targetContains)) || {}).target ||
  null;

export function parsePptx(zip, parseXml) {
  const decoder = new TextDecoder();
  const get = (path) => {
    const bytes = zip && zip[path];
    return bytes ? decoder.decode(bytes) : null;
  };
  const parsePart = (path) => {
    const text = get(path);
    if (!text) return null;
    try {
      const doc = parseXml(text);
      return (doc && doc.documentElement) || null;
    } catch {
      return null;
    }
  };
  // Parse a *.rels part ONCE into both an { [Id]: Target } map and a typed
  // { id, type, target } list (small parts; single parse avoids reparsing).
  const readRels = (path) => {
    const root = parsePart(path);
    const map = {};
    const list = [];
    if (!root) return { map, list };
    for (const rel of childrenByLocal(root, 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      list.push({ id, type: rel.getAttribute('Type') || '', target });
      if (id) map[id] = target;
    }
    return { map, list };
  };

  const presRoot = parsePart('ppt/presentation.xml');
  if (!presRoot) return { size: { ...DEFAULT_SIZE }, slides: [] };

  // Presentation size.
  const size = { ...DEFAULT_SIZE };
  const sldSz = childByLocal(presRoot, 'sldSz');
  if (sldSz) {
    const cx = parseInt(sldSz.getAttribute('cx'), 10);
    const cy = parseInt(sldSz.getAttribute('cy'), 10);
    if (Number.isFinite(cx)) size.cx = cx;
    if (Number.isFinite(cy)) size.cy = cy;
  }

  // Presentation rels: rId -> absolute part path.
  const presRels = readRels('ppt/_rels/presentation.xml.rels').map;
  const presRelTarget = (id) => {
    const raw = presRels[id];
    return raw ? resolveRel('ppt', raw) : null;
  };

  // Slide id list order.
  const slides = [];
  const sldIdLst = childByLocal(presRoot, 'sldIdLst');
  const sldIds = sldIdLst ? childrenByLocal(sldIdLst, 'sldId') : [];

  let index = 0;
  for (const sldId of sldIds) {
    const rid =
      sldId.getAttribute('r:id') || sldId.getAttributeNS(REL_NS, 'id') || sldId.getAttribute('id');
    const slidePath = rid ? presRelTarget(rid) : null;
    if (!slidePath) continue;
    index += 1;

    // Slide part + rels.
    const slideDir = dirOf(slidePath);
    const slideRelsPath = relsPathFor(slidePath);
    const { map: slideRels, list: slideRelsL } = readRels(slideRelsPath);

    // Resolve layout → master → theme using resolveRel's canonical output directly
    // (no hardcoded base dirs), so non-standard package layouts still resolve.
    const layoutRaw = findRelTarget(slideRelsL, '/slideLayout', 'slideLayout');
    const layoutPath = layoutRaw ? resolveRel(slideDir, layoutRaw) : null;

    let layoutRels = {};
    let masterPath = null;
    if (layoutPath) {
      const { map, list } = readRels(relsPathFor(layoutPath));
      layoutRels = map;
      const masterRaw = findRelTarget(list, '/slideMaster', 'slideMaster');
      if (masterRaw) masterPath = resolveRel(dirOf(layoutPath), masterRaw);
    }

    let masterRels = {};
    let themePath = null;
    if (masterPath) {
      const { map, list } = readRels(relsPathFor(masterPath));
      masterRels = map;
      const themeRaw = findRelTarget(list, '/theme', 'theme');
      if (themeRaw) themePath = resolveRel(dirOf(masterPath), themeRaw);
    }

    const slideEl = parsePart(slidePath);
    const layoutEl = layoutPath ? parsePart(layoutPath) : null;
    const masterEl = masterPath ? parsePart(masterPath) : null;
    const themeEl = themePath ? parsePart(themePath) : null;

    // Theme colors from master->theme clrScheme.
    let themeColors = {};
    if (themeEl) {
      const themeElements = childByLocal(themeEl, 'themeElements');
      const clrScheme = themeElements ? childByLocal(themeElements, 'clrScheme') : null;
      if (clrScheme) themeColors = themeColorsFromClrScheme(clrScheme) || {};
    }

    // Top-level shape count in spTree.
    let topLevelShapeCount = 0;
    if (slideEl) {
      const cSld = childByLocal(slideEl, 'cSld');
      const spTree = cSld ? childByLocal(cSld, 'spTree') : null;
      if (spTree) {
        for (let n = spTree.firstElementChild; n; n = n.nextElementSibling) {
          if (TOP_LEVEL_SHAPES.has(localOf(n))) topLevelShapeCount += 1;
        }
      }
    }

    slides.push({
      index,
      file: slidePath,
      size: { ...size },
      themeColors,
      xml: { slide: slideEl, layout: layoutEl, master: masterEl, theme: themeEl },
      rels: { slide: slideRels, layout: layoutRels, master: masterRels },
      topLevelShapeCount,
    });
  }

  // `zip` is retained so background/image modules can resolve embedded media
  // (r:embed → slide/layout/master rels → media part bytes).
  return { size, slides, zip };
}

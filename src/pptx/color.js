// OneView PPTX renderer — color pipeline.
// Resolves DrawingML color elements (srgbClr / schemeClr / sysClr / prstClr) to
// rgba() strings, substituting theme scheme colors and applying child modifiers
// (lumMod/lumOff/tint/shade/alpha/satMod/hueMod). schemeClr aliases bg1/tx1/bg2/tx2
// map onto lt1/dk1/lt2/dk2; phClr is substituted from the caller's context.

import { childByLocal } from './units.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (el, dflt) => {
  const v = el && el.getAttribute('val');
  if (v == null || v === '') return dflt;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n / 100000 : dflt; // 1000ths of a percent → 0..1
};

const PRESET = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', cyan: '00FFFF', magenta: 'FF00FF', gray: '808080', grey: '808080',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080',
};

// Build a scheme→hex map from a theme's <a:clrScheme> element.
export function themeColorsFromClrScheme(clrSchemeEl) {
  const map = {};
  if (!clrSchemeEl) return map;
  const names = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3',
    'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  for (const name of names) {
    const slot = childByLocal(clrSchemeEl, name);
    if (!slot) continue;
    const srgb = childByLocal(slot, 'srgbClr');
    const sys = childByLocal(slot, 'sysClr');
    let hex = '';
    if (srgb) hex = (srgb.getAttribute('val') || '').toLowerCase();
    else if (sys) hex = (sys.getAttribute('lastClr') || sys.getAttribute('val') || '').toLowerCase();
    if (hex) map[name] = hex;
  }
  // DrawingML aliases used in bgRef/fills.
  map.bg1 = map.lt1; map.tx1 = map.dk1; map.bg2 = map.lt2; map.tx2 = map.dk2;
  return map;
}

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// Apply DrawingML modifier children (in document order where it matters) to a base rgb.
function applyMods(rgb, colorEl) {
  let { r, g, b } = rgb;
  let a = 1;
  if (!colorEl) return { r, g, b, a };
  // Iterate modifier children in document order.
  for (let c = colorEl.firstElementChild; c; c = c.nextElementSibling) {
    const name = c.localName;
    switch (name) {
      case 'alpha': a *= pct(c, 1); break;
      case 'tint': { const t = pct(c, 1); r = r * t + 255 * (1 - t); g = g * t + 255 * (1 - t); b = b * t + 255 * (1 - t); break; }
      case 'shade': { const s = pct(c, 1); r *= s; g *= s; b *= s; break; }
      case 'lumMod': { const hsl = rgbToHsl({ r, g, b }); hsl.l = clamp(hsl.l * pct(c, 1), 0, 1); ({ r, g, b } = hslToRgb(hsl)); break; }
      case 'lumOff': { const hsl = rgbToHsl({ r, g, b }); hsl.l = clamp(hsl.l + pct(c, 0), 0, 1); ({ r, g, b } = hslToRgb(hsl)); break; }
      case 'satMod': { const hsl = rgbToHsl({ r, g, b }); hsl.s = clamp(hsl.s * pct(c, 1), 0, 1); ({ r, g, b } = hslToRgb(hsl)); break; }
      case 'satOff': { const hsl = rgbToHsl({ r, g, b }); hsl.s = clamp(hsl.s + pct(c, 0), 0, 1); ({ r, g, b } = hslToRgb(hsl)); break; }
      case 'hueMod': { const hsl = rgbToHsl({ r, g, b }); hsl.h = (hsl.h * pct(c, 1)) % 1; ({ r, g, b } = hslToRgb(hsl)); break; }
      default: break;
    }
  }
  return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a: clamp(a, 0, 1) };
}

function baseHexOf(colorEl, themeColors, phClr) {
  const name = colorEl.localName;
  if (name === 'srgbClr') return (colorEl.getAttribute('val') || '000000');
  if (name === 'sysClr') return (colorEl.getAttribute('lastClr') || colorEl.getAttribute('val') || '000000');
  if (name === 'prstClr') return PRESET[colorEl.getAttribute('val')] || '000000';
  if (name === 'schemeClr') {
    const v = colorEl.getAttribute('val');
    if (v === 'phClr') return (phClr || themeColors.tx1 || '000000');
    return (themeColors[v] || '000000'); // aliases (bg1/tx1/bg2/tx2) prepopulated in the map
  }
  return null;
}

// Resolve a color CONTAINER child element (one of srgbClr/schemeClr/sysClr/prstClr)
// to an rgba() string. `phClr` supplies the placeholder color for schemeClr="phClr".
export function resolveColorEl(colorEl, themeColors = {}, phClr = null) {
  if (!colorEl) return null;
  const hex = baseHexOf(colorEl, themeColors, phClr);
  if (hex == null) return null;
  const rgb = hexToRgb(hex.startsWith('#') ? hex.slice(1) : hex) || { r: 0, g: 0, b: 0 };
  const { r, g, b, a } = applyMods(rgb, colorEl);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

// Find the first color container inside a fill/parent element and resolve it.
export function resolveFirstColor(parentEl, themeColors = {}, phClr = null) {
  if (!parentEl) return null;
  for (const tag of ['srgbClr', 'schemeClr', 'sysClr', 'prstClr']) {
    const el = childByLocal(parentEl, tag);
    if (el) return resolveColorEl(el, themeColors, phClr);
  }
  return null;
}

export const _internal = { hexToRgb, rgbToHsl, hslToRgb, applyMods };

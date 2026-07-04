// OneView PPTX renderer — text layout & draw for shape text bodies (<p:txBody>).
//
// drawText(ctx, txBodyEl, box, styleCtx) paints a shape's text into `box`
// (natural px, same coord system as ctx) with measureText-based auto word/char
// wrapping, per-run 5-stage OOXML formatting inheritance, vertical anchoring,
// alignment, underline, and box clipping. Pure aside from ctx side effects.
//
// 5-stage run-format inheritance (most specific wins):
//   1. run <a:rPr>
//   2. paragraph <a:pPr>/<a:defRPr>
//   3. styleChain[i] <a:lvl{N+1}pPr>/<a:defRPr>  (shape own → layout ph → master ph)
//   4. masterTxStyle <a:lvl{N+1}pPr>/<a:defRPr>  (titleStyle|bodyStyle|otherStyle)
//   5. hard defaults
// where N = paragraph lvl (0..8). Alignment / left margin resolve over the same
// paragraph-level chain (pPr → styleChain lvlNpPr → master lvlNpPr).

import { childByLocal, childrenByLocal, EMU_PER_PX } from './units.js';
import { resolveFirstColor } from './color.js';

const PT_TO_PX = 4 / 3;                 // 96dpi: 1pt = 1/72" = 96/72 px
const DEFAULT_FAMILY = "'Noto Sans KR', 'Malgun Gothic', sans-serif";
const LINE_MULT = 1.2;                  // baseline line-height factor
// Hangul / CJK / kana / fullwidth ranges — these wrap per glyph.
const CJK = /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\u3000-\u30FF\uFF00-\uFFEF]/;

const num = (v) => (v == null || v === '' ? null : Number(v));
const isTrue = (v) => v === '1' || v === 'true' || v === 'on';

// First non-null result of fn over a most-specific-first element chain.
function pick(chain, fn) {
  for (const el of chain) {
    if (!el) continue;
    const v = fn(el);
    if (v != null) return v;
  }
  return null;
}

// Resolve one run's effective format from its rPr chain (most specific first).
function resolveRunFmt(rPrChain, fontScale, themeColors, defaultFontPt) {
  const szHundredths = pick(rPrChain, (el) => num(el.getAttribute('sz')));
  const pt = (szHundredths != null ? szHundredths / 100 : defaultFontPt) * fontScale;
  const px = Math.max(1, Math.round(pt * PT_TO_PX));

  const b = isTrue(pick(rPrChain, (el) => el.getAttribute('b')));
  const i = isTrue(pick(rPrChain, (el) => el.getAttribute('i')));
  const uAttr = pick(rPrChain, (el) => el.getAttribute('u'));
  const u = uAttr != null && uAttr !== 'none';

  const family = pick(rPrChain, (el) => {
    const latin = childByLocal(el, 'latin') || childByLocal(el, 'ea') || childByLocal(el, 'cs');
    const tf = latin && latin.getAttribute('typeface');
    return tf ? tf : null;
  }) || null;

  const color = pick(rPrChain, (el) => {
    const fill = childByLocal(el, 'solidFill');
    return fill ? resolveFirstColor(fill, themeColors, null) : null;
  }) || 'rgb(0, 0, 0)';

  const fam = family ? `'${family}', ${DEFAULT_FAMILY}` : DEFAULT_FAMILY;
  return {
    px, b, i, u, color, family: fam,
    font: `${i ? 'italic ' : ''}${b ? 'bold ' : ''}${px}px ${fam}`,
  };
}

// Split a run's text into layout tokens: whitespace runs, single CJK glyphs,
// and non-CJK "words". Enables word-wrap for latin and glyph-wrap for CJK.
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') {
      let j = i + 1;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      tokens.push({ t: text.slice(i, j), space: true });
      i = j;
    } else if (CJK.test(ch)) {
      tokens.push({ t: ch, space: false });
      i++;
    } else {
      let j = i + 1;
      while (j < text.length) {
        const c = text[j];
        if (c === ' ' || c === '\t' || CJK.test(c)) break;
        j++;
      }
      tokens.push({ t: text.slice(i, j), space: false });
      i = j;
    }
  }
  return tokens;
}

// Collect the ordered run text/break sequence of a paragraph.
// <a:r> → text run; <a:br/> → hard break; <a:fld> → its <a:t> text.
function paragraphRuns(pEl, fldCtx) {
  const runs = [];
  for (let c = pEl.firstElementChild; c; c = c.nextElementSibling) {
    const name = c.localName;
    if (name === 'r') {
      const t = childByLocal(c, 't');
      runs.push({ br: false, rPr: childByLocal(c, 'rPr'), text: t ? t.textContent : '' });
    } else if (name === 'br') {
      runs.push({ br: true });
    } else if (name === 'fld') {
      const t = childByLocal(c, 't');
      // PowerPoint stores dynamic fields (slide number, slide count) as an <a:fld>
      // whose cached <a:t> text is a stale placeholder ("#" for a brand-new field).
      // Resolve known field types to their live value so headers show "3", not "#".
      const type = c.getAttribute('type') || '';
      let text = t ? t.textContent : '';
      if (fldCtx) {
        if (type === 'slidenum' && fldCtx.slideNum != null) text = String(fldCtx.slideNum);
        else if (type === 'slidecount' && fldCtx.slideCount != null) text = String(fldCtx.slideCount);
      }
      // If a slidenum field somehow still carries a literal "#", swap it too.
      if (type === 'slidenum' && fldCtx && fldCtx.slideNum != null && (text === '#' || text === '')) text = String(fldCtx.slideNum);
      runs.push({ br: false, rPr: childByLocal(c, 'rPr'), text });
    }
  }
  return runs;
}

// Build the paragraph-level element chain (most specific first) at level `lvl`
// for resolving pPr attributes (algn, marL) and paragraph defRPr.
function paraChain(pPr, styleChain, masterTxStyle, lvl) {
  const lvlName = `lvl${Math.min(Math.max(lvl, 0), 8) + 1}pPr`;
  const chain = [];
  if (pPr) chain.push(pPr);
  for (const ls of styleChain || []) {
    const lp = childByLocal(ls, lvlName);
    if (lp) chain.push(lp);
  }
  if (masterTxStyle) {
    const lp = childByLocal(masterTxStyle, lvlName);
    if (lp) chain.push(lp);
  }
  return chain;
}

// Draw a shape's text body into `box` (natural px).
export function drawText(ctx, txBodyEl, box, styleCtx) {
  if (!ctx || !txBodyEl || !box) return;
  const {
    styleChain = [], masterTxStyle = null,
    themeColors = {}, defaultFontPt = 18,
    insetsPx = null, anchorOverride = null,
    slideNum = null, slideCount = null,
  } = styleCtx || {};
  const fldCtx = { slideNum, slideCount };

  const paras = childrenByLocal(txBodyEl, 'p');
  if (!paras.length) return;

  // --- bodyPr: insets, vertical anchor, autofit scaling. ---
  // Callers that own their own insets/anchor (e.g. table cells applying tcPr
  // margins + tcPr@anchor) pass insetsPx/anchorOverride so drawText does not
  // re-apply its own bodyPr default insets (avoids double-inset shrink).
  const bodyPr = childByLocal(txBodyEl, 'bodyPr');
  const insetPx = (attr, dflt) => {
    const v = bodyPr && bodyPr.getAttribute(attr);
    return v != null && v !== '' ? Number(v) / EMU_PER_PX : dflt;
  };
  const lIns = insetsPx ? (insetsPx.l || 0) : insetPx('lIns', 7);
  const rIns = insetsPx ? (insetsPx.r || 0) : insetPx('rIns', 7);
  const tIns = insetsPx ? (insetsPx.t || 0) : insetPx('tIns', 4);
  const bIns = insetsPx ? (insetsPx.b || 0) : insetPx('bIns', 4);
  const anchor = anchorOverride || (bodyPr && bodyPr.getAttribute('anchor')) || 't';

  let fontScale = 1;
  let lnReduction = 0;
  const normAutofit = bodyPr && childByLocal(bodyPr, 'normAutofit');
  if (normAutofit) {
    const fs = num(normAutofit.getAttribute('fontScale'));
    if (fs != null) fontScale = fs / 100000;           // 100000 == 100%
    const lr = num(normAutofit.getAttribute('lnSpcReduction'));
    if (lr != null) lnReduction = lr / 100000;
  }
  const lineFactor = LINE_MULT * (1 - lnReduction);

  const availW0 = Math.max(1, box.w - lIns - rIns);

  // --- Layout pass: build wrapped lines across all paragraphs. ---
  const lines = [];   // { pieces:[{text,fmt,width}], width, maxPx, algn, marL }
  for (const pEl of paras) {
    const pPr = childByLocal(pEl, 'pPr');
    const lvl = pPr ? (Number(pPr.getAttribute('lvl')) || 0) : 0;
    const pchain = paraChain(pPr, styleChain, masterTxStyle, lvl);
    const styleDefRPrs = pchain.map((el) => childByLocal(el, 'defRPr'));

    const algn = pick(pchain, (el) => el.getAttribute('algn')) || 'l';
    const marLemu = pick(pchain, (el) => num(el.getAttribute('marL')));
    const marL = marLemu != null ? marLemu / EMU_PER_PX : 0;
    const availW = Math.max(1, availW0 - marL);

    // Paragraph default font (empty run) — floor for line height on blank lines.
    const paraDefFmt = resolveRunFmt(styleDefRPrs, fontScale, themeColors, defaultFontPt);

    let line = { pieces: [], width: 0, maxPx: paraDefFmt.px, algn, marL };
    const flush = (emitEmpty) => {
      if (line.pieces.length || emitEmpty) lines.push(line);
      line = { pieces: [], width: 0, maxPx: paraDefFmt.px, algn, marL };
    };

    const runs = paragraphRuns(pEl, fldCtx);
    for (const run of runs) {
      if (run.br) { flush(true); continue; }
      if (!run.text) continue;
      const fmt = resolveRunFmt(
        [run.rPr, ...styleDefRPrs], fontScale, themeColors, defaultFontPt,
      );
      ctx.font = fmt.font;
      for (const tok of tokenize(run.text)) {
        const w = ctx.measureText(tok.t).width;
        if (!tok.space && line.width > 0 && line.width + w > availW) flush(false);
        if (tok.space && line.width === 0) continue;   // drop leading space
        line.pieces.push({ text: tok.t, fmt, width: w });
        line.width += w;
        if (fmt.px > line.maxPx) line.maxPx = fmt.px;
      }
    }
    flush(true);   // emit trailing/blank paragraph line
  }
  if (!lines.length) return;

  // --- Vertical anchoring within inner box height. ---
  let totalH = 0;
  for (const ln of lines) totalH += ln.maxPx * lineFactor;
  const innerTop = box.y + tIns;
  const innerH = Math.max(0, box.h - tIns - bIns);
  let y;
  if (anchor === 'ctr') y = innerTop + (innerH - totalH) / 2;
  else if (anchor === 'b') y = box.y + box.h - bIns - totalH;
  else y = innerTop;

  // --- Draw pass (clipped to box). ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  for (const ln of lines) {
    const lineH = ln.maxPx * lineFactor;
    const baseline = y + ln.maxPx;             // approx ascent = font px
    const left = box.x + lIns + ln.marL;
    const avail = Math.max(1, box.w - lIns - rIns - ln.marL);
    let x;
    if (ln.algn === 'ctr') x = left + (avail - ln.width) / 2;
    else if (ln.algn === 'r') x = left + (avail - ln.width);
    else x = left;                              // l / just(≈left)

    for (const pc of ln.pieces) {
      ctx.font = pc.fmt.font;
      ctx.fillStyle = pc.fmt.color;
      ctx.fillText(pc.text, x, baseline);
      if (pc.fmt.u && pc.text.trim()) {
        const uy = baseline + Math.max(1, pc.fmt.px / 12);
        ctx.strokeStyle = pc.fmt.color;
        ctx.lineWidth = Math.max(1, pc.fmt.px / 14);
        ctx.beginPath();
        ctx.moveTo(x, uy);
        ctx.lineTo(x + pc.width, uy);
        ctx.stroke();
      }
      x += pc.width;
    }
    y += lineH;
  }
  ctx.restore();
}

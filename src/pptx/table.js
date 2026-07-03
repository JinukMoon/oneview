// OneView PPTX renderer — table (graphicFrame > <a:tbl>) draw.
//
// drawTable(ctx, el, pxBox) lays out an OOXML table into `pxBox` (natural px,
// same coord system as ctx). Column widths come from <a:tblGrid>/<a:gridCol w>
// and row heights from <a:tr h> (both EMU). The natural table size is scaled
// (independently on X/Y) to fill pxBox, giving cumulative edge coordinates
// colX[]/rowY[]. Cells are walked row-major while tracking the column index;
// merged placeholders (hMerge/vMerge) are skipped so a spanning cell's box —
// derived purely from the colX/rowY edge arrays — naturally covers them.
// Pure aside from ctx side effects.

import { childByLocal, childrenByLocal, emuToPx } from './units.js';
import { resolveFirstColor } from './color.js';
import { drawText } from './text.js';

// Default cell text insets (EMU) per the OOXML spec when tcPr omits them.
const DEF_MAR_LR = 91440;   // ≈ 9.6px left/right
const DEF_MAR_TB = 45720;   // ≈ 4.8px top/bottom
const GRID_FALLBACK = '#d0d0d0'; // faint gridline when a cell has no border spec

const attrNum = (el, name) => {
  const v = el && el.getAttribute ? el.getAttribute(name) : null;
  return v == null || v === '' ? null : Number(v);
};
const isTrue = (v) => v === '1' || v === 'true' || v === 'on';

export function drawTable(ctx, el, pxBox) {
  const tbl = el && el.tbl;
  if (!tbl || !pxBox) return;
  const themeColors = (el && el.themeColors) || {};

  // 1. Column widths (EMU→px) and row heights (EMU→px).
  const grid = childByLocal(tbl, 'tblGrid');
  const cols = grid ? childrenByLocal(grid, 'gridCol') : [];
  const colW = cols.map((c) => emuToPx(attrNum(c, 'w') || 0));
  const rows = childrenByLocal(tbl, 'tr');
  // Row `h` in OOXML is a MINIMUM; PowerPoint auto-grows rows to fit content and
  // frequently stores h="0" for content-sized rows. A raw 0 would collapse the row
  // (and force the remaining rows to stretch), so floor each row to a sensible
  // minimum before fitting to the frame — keeps every row visible and proportionate.
  const MIN_ROW_EMU = 274320; // ≈ 0.3", a readable single text line
  const rowH = rows.map((r) => emuToPx(Math.max(attrNum(r, 'h') || 0, MIN_ROW_EMU)));
  if (!colW.length || !rowH.length) return;

  // 2. Fit natural table size into pxBox (0-guard scale → 1).
  const sumW = colW.reduce((a, b) => a + b, 0);
  const sumH = rowH.reduce((a, b) => a + b, 0);
  const scaleX = sumW > 0 ? pxBox.w / sumW : 1;
  const scaleY = sumH > 0 ? pxBox.h / sumH : 1;
  const avgScale = (scaleX + scaleY) / 2;

  // Cumulative edge coordinates (length N+1); last entry = far edge.
  const colX = [pxBox.x];
  for (let i = 0; i < colW.length; i++) colX.push(colX[i] + colW[i] * scaleX);
  const rowY = [pxBox.y];
  for (let i = 0; i < rowH.length; i++) rowY.push(rowY[i] + rowH[i] * scaleY);

  const nCols = colW.length;

  // 3. Walk rows; per row track the running column index.
  for (let r = 0; r < rows.length; r++) {
    const tcs = childrenByLocal(rows[r], 'tc');
    let c = 0;
    for (let t = 0; t < tcs.length; t++) {
      const tc = tcs[t];
      const span = Math.max(1, attrNum(tc, 'gridSpan') || 1);

      // Merged placeholder cells: not drawn, just advance one column.
      // In DrawingML every grid column has its own <a:tc>; a gridSpan/rowSpan
      // master cell is followed by one hMerge/vMerge placeholder per covered
      // column, so the cursor always advances by exactly 1 per tc.
      if (isTrue(tc.getAttribute && tc.getAttribute('hMerge')) ||
          isTrue(tc.getAttribute && tc.getAttribute('vMerge'))) {
        c += 1;
        continue;
      }

      const rspan = Math.max(1, attrNum(tc, 'rowSpan') || 1);
      const cEnd = Math.min(nCols, c + span);
      const rEnd = Math.min(rows.length, r + rspan);
      const cellX = colX[c];
      const cellY = rowY[r];
      const cellW = colX[cEnd] - cellX;
      const cellH = rowY[rEnd] - cellY;
      if (cellW <= 0 || cellH <= 0) { c += 1; continue; }

      const tcPr = childByLocal(tc, 'tcPr');

      // Cell fill: solidFill (gradFill falls back to its first color if present).
      if (tcPr) {
        const solid = childByLocal(tcPr, 'solidFill') || childByLocal(tcPr, 'gradFill');
        if (solid) {
          const fill = resolveFirstColor(solid, themeColors, null);
          if (fill) {
            ctx.fillStyle = fill;
            ctx.fillRect(cellX, cellY, cellW, cellH);
          }
        }
      }

      // Borders: per-side ln{L,R,T,B}; explicit spec wins, else faint grid.
      drawBorder(ctx, tcPr, 'lnL', cellX, cellY, cellX, cellY + cellH, themeColors, avgScale);
      drawBorder(ctx, tcPr, 'lnR', cellX + cellW, cellY, cellX + cellW, cellY + cellH, themeColors, avgScale);
      drawBorder(ctx, tcPr, 'lnT', cellX, cellY, cellX + cellW, cellY, themeColors, avgScale);
      drawBorder(ctx, tcPr, 'lnB', cellX, cellY + cellH, cellX + cellW, cellY + cellH, themeColors, avgScale);

      // Text: pass the FULL cell box + tcPr insets so drawText applies insets
      // exactly once (no double-inset), and the cell's tcPr@anchor drives vertical
      // alignment (headers are commonly center/bottom anchored).
      const txBody = childByLocal(tc, 'txBody');
      if (txBody) {
        const marPx = (name, dfl, scale) => {
          const v = attrNum(tcPr, name);
          return emuToPx(Number.isFinite(v) ? v : dfl) * scale;
        };
        const anchorAttr = (tcPr && tcPr.getAttribute('anchor')) || 't';
        const cellAnchor = anchorAttr === 'ctr' || anchorAttr === 'b' ? anchorAttr : 't';
        if (cellW > 0 && cellH > 0) {
          drawText(ctx, txBody, { x: cellX, y: cellY, w: cellW, h: cellH }, {
            styleChain: [],
            masterTxStyle: null,
            themeColors,
            defaultFontPt: 12,
            insetsPx: {
              l: marPx('marL', DEF_MAR_LR, scaleX), r: marPx('marR', DEF_MAR_LR, scaleX),
              t: marPx('marT', DEF_MAR_TB, scaleY), b: marPx('marB', DEF_MAR_TB, scaleY),
            },
            anchorOverride: cellAnchor,
          });
        }
      }

      c += 1;
    }
  }
}

// Draw one cell border side. Uses the explicit ln spec (w>0 && a color) when
// present; <a:noFill> suppresses it; absence falls back to a faint 1px grid line.
function drawBorder(ctx, tcPr, side, x1, y1, x2, y2, themeColors, avgScale) {
  let color = GRID_FALLBACK;
  let lw = 1;
  const ln = tcPr ? childByLocal(tcPr, side) : null;
  if (ln) {
    if (childByLocal(ln, 'noFill')) return; // explicitly no border on this side
    const solid = childByLocal(ln, 'solidFill');
    const c = solid ? resolveFirstColor(solid, themeColors, null) : null;
    const w = attrNum(ln, 'w') || 0;
    if (c && w > 0) {
      color = c;
      lw = Math.max(1, emuToPx(w) * avgScale);
    } else {
      return; // ln present but no usable color/width → nothing to draw
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

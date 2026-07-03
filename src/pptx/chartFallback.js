// OneView PPTX renderer — chart / SmartArt / OLE best-effort fallback.
// These graphicData kinds are not vector-rendered. When PowerPoint embedded a
// raster preview (a blip anywhere in the graphicFrame subtree), that image is
// decoded in the pre-pass and drawn as the object (handled by drawPic). When no
// preview exists, this draws a neutral placeholder frame instead of leaving a
// blank/black hole, and the slide's existing "▶ open in PowerPoint" action bar
// affordance lets the user open the original for the live object.

// drawChartPlaceholder(ctx, pxBox): light framed box with a centered label.
export function drawChartPlaceholder(ctx, pxBox) {
  const { x, y, w, h } = pxBox;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.fillStyle = '#f3f4f6';               // neutral light fill
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c7ccd1';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]);
  // Centered label (sized to the box, capped for readability).
  const fs = Math.max(11, Math.min(20, Math.round(h * 0.12)));
  ctx.fillStyle = '#8a9099';
  ctx.font = `${fs}px 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('개체 · 다른 앱으로 열기', x + w / 2, y + h / 2);
  ctx.restore();
}

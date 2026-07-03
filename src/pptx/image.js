// OneView PPTX renderer — picture (pic) drawing.
// Draws a pre-decoded raster image into the element's px box, honoring the
// optional srcRect crop and applying rot/flip via the caller's ctx stack.
// Image decoding is async and happens in a pre-pass (index.js); by draw time the
// decoded HTMLImageElement is attached as el.imageEl. Missing/failed images are
// skipped (no black box).

// el: { kind:'pic', imageEl?, srcRect?{l,t,r,b in 0..1} }
// pxBox: {x,y,w,h} natural px (already position/rot/flip-transformed by caller).
export function drawPic(ctx, el, pxBox) {
  const img = el.imageEl;
  if (!img || !img.width || !img.height) return; // undecoded/failed → skip, not black
  const sr = el.srcRect;
  if (sr && (sr.l || sr.t || sr.r || sr.b)) {
    const sx = Math.max(0, sr.l) * img.width;
    const sy = Math.max(0, sr.t) * img.height;
    const sw = Math.max(1, img.width - (sr.l + sr.r) * img.width);
    const sh = Math.max(1, img.height - (sr.t + sr.b) * img.height);
    ctx.drawImage(img, sx, sy, sw, sh, pxBox.x, pxBox.y, pxBox.w, pxBox.h);
  } else {
    ctx.drawImage(img, pxBox.x, pxBox.y, pxBox.w, pxBox.h);
  }
}

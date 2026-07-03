// OneView PPTX renderer — embedded media resolution.
// Resolves a blip r:embed relationship id to a data: URL using the containing
// part's rels map and the unzipped media bytes.

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  emf: 'image/emf', wmf: 'image/wmf', webp: 'image/webp',
};

// Normalize a rels Target relative to the containing part's directory.
function resolveTarget(partDir, target) {
  const baseParts = partDir ? partDir.split('/').filter(Boolean) : [];
  for (const seg of target.replace(/^\.\//, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') baseParts.pop();
    else baseParts.push(seg);
  }
  return baseParts.join('/');
}

function bytesToBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  // btoa exists in browser; media resolution runs on the main thread.
  return btoa(bin);
}

// embedId (rId..) + rels map ({ [Id]: Target }) + part dir (e.g. 'ppt/slides') → data URL or null.
export function embedToDataUrl(zip, relsMap, embedId, partDir) {
  if (!zip || !relsMap || !embedId) return null;
  const target = relsMap[embedId];
  if (!target) return null;
  const key = resolveTarget(partDir || 'ppt', target);
  const bytes = zip[key] || zip['ppt/media/' + key.split('/').pop()];
  if (!bytes) return null;
  const ext = (key.match(/\.([a-z0-9]+)$/i) || [])[1];
  const mime = MIME[(ext || 'png').toLowerCase()] || 'image/png';
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

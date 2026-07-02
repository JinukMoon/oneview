/* OneView — open any document from one place.
   In-app renderers: PDF / HWP / HWPX / Word / Excel / PPT / image / text.
   Unsupported formats are forwarded to an external app via the native FileBridge plugin. */
(function () {
  'use strict';

  const Capacitor = window.JVCapacitor || window.Capacitor;
  const registerPlugin = window.JVRegisterPlugin
    || (window.Capacitor && window.Capacitor.registerPlugin);
  const FileBridge = registerPlugin
    ? registerPlugin('FileBridge')
    : (Capacitor && Capacitor.Plugins ? Capacitor.Plugins.FileBridge : null);

  // --- logging + compact error overlay (only appears on a real error) ---
  function dbg(msg) { try { console.log('[OneView]', msg); } catch (e) {} }
  // errors are logged to the console only — no on-screen debug/error overlay for users
  function showErr(msg) { dbg(msg); }
  window.addEventListener('error', (e) => showErr('ERROR: ' + (e.message || (e.error && e.error.message)) + ' @' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', (e) => showErr('REJECT: ' + (e.reason && (e.reason.message || e.reason))));

  // --- DOM ---
  const $ = (id) => document.getElementById(id);
  const els = {
    landing: $('landing'),
    loading: $('loading'),
    loadingText: $('loading-text'),
    forward: $('forward'),
    content: $('content'),
    fwdName: $('fwd-name'),
    fwdType: $('fwd-type'),
    fwdMsg: $('fwd-msg'),
    title: document.querySelector('.topbar .title'),
    toast: $('toast'),
    btnDark: $('btn-dark'),
    btnShare: $('btn-share'),
    btnSearch: $('btn-search'),
    btnHome: $('btn-home'),
    pageind: $('pageind'),
    recent: $('recent'),
    actionbar: $('actionbar'),
  };

  let currentFile = null; // {name, path}
  let currentExt = '';
  let openSeq = 0; // generation token — guards against a slow render clobbering a newer one

  // --- zoom (content-only so the header stays fixed) ---
  const ZOOM_MIN = 0.25, ZOOM_MAX = 6;
  let zoom = 1;
  const zoomctl = $('zoomctl');
  const zoomPct = $('zoom-pct');
  function clampZoom(z) { return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); }
  function applyZoom() {
    els.content.style.zoom = zoom;
    if (zoomPct) zoomPct.textContent = Math.round(zoom * 100) + '%';
  }
  let qualityTimer = null;
  function scheduleQualityRerender() {
    if (!pdfRerender && !hwpRerender) return;
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(() => { try { if (pdfRerender) pdfRerender(); if (hwpRerender) hwpRerender(); } catch (e) {} }, 200);
  }
  function setZoom(z) { zoom = clampZoom(z); applyZoom(); scheduleQualityRerender(); }

  // --- dark reader (invert document colors for night reading) ---
  let darkReader = false;
  try { darkReader = localStorage.getItem('oneview_dark') === '1'; } catch (e) {}
  function applyDarkReader() {
    els.content.classList.toggle('dark-reader', darkReader);
    if (els.btnDark) els.btnDark.classList.toggle('active', darkReader);
  }
  function toggleDarkReader() {
    darkReader = !darkReader;
    try { localStorage.setItem('oneview_dark', darkReader ? '1' : '0'); } catch (e) {}
    applyDarkReader();
  }

  // --- UI state ---
  function show(which) {
    ['landing', 'loading', 'forward', 'content'].forEach((k) => {
      els[k].classList.toggle('hidden', k !== which);
    });
    const onContent = which === 'content';
    if (zoomctl) zoomctl.classList.toggle('hidden', !onContent);
    if (els.btnDark) els.btnDark.classList.toggle('hidden', !onContent);
    if (els.btnShare) els.btnShare.classList.toggle('hidden', !onContent);
    if (els.btnSearch) els.btnSearch.classList.toggle('hidden', !onContent);
    if (els.btnHome) els.btnHome.classList.toggle('hidden', which === 'landing');
    if (which === 'content' || which === 'forward') pushDocHistory();
    if (which === 'landing') docHistoryPushed = false;
    if (els.actionbar) els.actionbar.classList.add('hidden'); // renderers re-show as needed
    if (!onContent) closeSearch();
    if (els.pageind) els.pageind.classList.add('hidden'); // PDF re-shows it
    if (onContent) applyDarkReader();
    if (which === 'landing') { setTitle('OneView'); renderRecents(); }
  }
  // --- home / back navigation (hardware back button + home button) ---
  let docHistoryPushed = false;
  function pushDocHistory() {
    if (!docHistoryPushed) { try { history.pushState({ ov: 'doc' }, ''); } catch (e) {} docHistoryPushed = true; }
  }
  function goLanding() {
    openSeq++;              // supersede any in-flight render so it self-cancels via its seq guard
    clearPdfObservers();
    freeResources();        // free pdf doc / blob / HWP WASM / pptx previewer, etc.
    els.content.innerHTML = '';
    show('landing');
  }
  function goHome() {
    if (docHistoryPushed) history.back(); // pops the doc entry → popstate → goLanding
    else goLanding();
  }
  window.addEventListener('popstate', () => { docHistoryPushed = false; goLanding(); });
  function setLoading(text) {
    els.loadingText.textContent = text || '여는 중…';
    show('loading');
  }
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }
  function setTitle(name) { els.title.textContent = name || 'OneView'; }
  function showActionBar(html) {
    if (!els.actionbar) return;
    els.actionbar.innerHTML = html;
    els.actionbar.classList.remove('hidden');
  }

  // --- recents ---
  function loadRecents() {
    try { return JSON.parse(localStorage.getItem('oneview_recents') || '[]'); } catch (e) { return []; }
  }
  function saveRecent(file) {
    try {
      let r = loadRecents().filter((x) => x.path !== file.path);
      r.unshift({ name: file.name, path: file.path, ext: extOf(file.name), ts: Date.now() });
      localStorage.setItem('oneview_recents', JSON.stringify(r.slice(0, 12)));
    } catch (e) {}
  }
  function removeRecent(path) {
    try { localStorage.setItem('oneview_recents', JSON.stringify(loadRecents().filter((x) => x.path !== path))); } catch (e) {}
  }
  function renderRecents() {
    if (!els.recent) return;
    const r = loadRecents();
    if (!r.length) { els.recent.innerHTML = ''; return; }
    els.recent.innerHTML = '<div class="recent-title">최근 본 파일</div>' +
      r.map((x) =>
        '<div class="recent-item" data-path="' + encodeURIComponent(x.path) + '" data-name="' + encodeURIComponent(x.name) + '">' +
        '<span class="ri-ext">' + escapeHtml((x.ext || '?').toUpperCase()) + '</span>' +
        '<span class="ri-name">' + escapeHtml(x.name) + '</span></div>'
      ).join('');
  }

  // --- extension / type helpers ---
  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  // strip active content from HTML generated off untrusted document data
  function sanitizeNode(root) {
    root.querySelectorAll('script, iframe, object, embed, link, meta, base').forEach((e) => e.remove());
    root.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*(javascript|data):/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
  }
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'];
  const TEXT_EXT = ['txt', 'csv', 'log', 'md', 'json', 'xml', 'html', 'htm', 'js', 'css', 'py', 'c', 'cpp', 'java', 'ini', 'yaml', 'yml', 'tsv'];

  function detectByMagic(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image';
    return null;
  }

  // --- lazy-render bookkeeping + resource cleanup ---
  let pdfObservers = [];
  let pdfDoc = null;       // current PDFDocumentProxy — destroyed before next open
  let curBlobUrl = null;   // current image blob URL — revoked before next open
  let pdfRerender = null;  // re-renders visible PDF pages at higher resolution when zoomed
  let hwpRerender = null;  // re-renders visible HWP pages after zoom (IO can miss zoom-driven changes)
  let pptxPreviewer = null; // current pptx-preview instance — destroyed before next open
  function freeResources() {
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) {} pdfDoc = null; }
    if (curBlobUrl) { try { URL.revokeObjectURL(curBlobUrl); } catch (e) {} curBlobUrl = null; }
    pdfRerender = null;
    hwpRerender = null;
    if (pptxPreviewer) { try { pptxPreviewer.destroy(); } catch (e) {} pptxPreviewer = null; }
    xlsxSheetEls = [];
    if (rhwpDoc) { try { rhwpDoc.free(); } catch (e) {} rhwpDoc = null; }
  }
  function clearPdfObservers() {
    pdfObservers.forEach((o) => { try { o.disconnect(); } catch (e) {} });
    pdfObservers = [];
  }

  // --- core open flow ---
  async function openFile(file) {
    dbg('openFile ' + JSON.stringify(file));
    if (!file || !file.path) { goLanding(); return; }
    const myseq = ++openSeq;
    clearPdfObservers();
    freeResources(); // destroy previous PDF doc, revoke image blob, free HWP WASM doc
    currentFile = file;
    if (FileBridge && FileBridge.setCurrent) FileBridge.setCurrent({ path: file.path, name: file.name }).catch(() => {});
    saveRecent(file);
    setZoom(1);
    setTitle(file.name);
    setLoading('여는 중…');

    const ext = extOf(file.name);
    currentExt = ext;
    closeSearch();

    if (ext === 'pdf') return renderPdf(file).catch((e) => fail('PDF', e, file));
    if (ext === 'heic' || ext === 'heif') {
      els.fwdMsg.textContent = '이 형식(HEIC/HEIF)은 기기에서 앱이 직접 못 열어요. 사진 앱으로 열어볼까요?';
      showForward(file);
      doForward();
      return;
    }
    if (IMAGE_EXT.includes(ext)) return renderImage(file, ext).catch((e) => fail('이미지', e, file));
    if (ext === 'hwp') return renderHwp(file).catch((e) => fail('HWP', e, file));
    if (ext === 'hwpx') return renderHwpx(file).catch((e) => fail('HWPX', e, file));
    if (ext === 'docx') return renderDocx(file).catch((e) => fail('Word', e, file));
    if (ext === 'xlsx' || ext === 'xls') return renderXlsx(file).catch((e) => fail('Excel', e, file));
    if (ext === 'pptx') return renderPptx(file).catch((e) => fail('PPT', e, file));
    if (TEXT_EXT.includes(ext)) return renderText(file).catch((e) => fail('텍스트', e, file));

    if (!ext) {
      try {
        const buf = await fetchBytes(file, 16);
        if (myseq !== openSeq) return;
        const kind = detectByMagic(new Uint8Array(buf));
        if (kind === 'pdf') return renderPdf(file).catch((e) => fail('PDF', e, file));
        if (kind === 'image') return renderImage(file, 'png').catch((e) => fail('이미지', e, file));
      } catch (_) {}
    }
    forward(file);
  }

  function fail(label, err, file) {
    const detail = err && (err.stack || err.message || String(err));
    dbg('render failed: ' + label + ' ' + detail);
    showErr(label + ' 렌더 실패:\n' + (detail ? String(detail).split('\n').slice(0, 4).join('\n') : '(no detail)'));
    const gone = /fetch failed|failed to fetch|networkerror|not found|\b404\b/i.test(String(detail || ''));
    if (gone) {
      // the file at this path is unavailable (deleted / moved / temp copy expired) — nothing to forward
      removeRecent(file.path);
      goLanding();
      toast('파일을 열 수 없어요. 삭제·이동되었거나 임시 사본이 사라진 것 같아요.');
      return;
    }
    if (label === 'HWP') {
      els.fwdMsg.textContent = '이 한글 파일은 앱에서 직접 표시가 안 돼요 (배포용·암호화 또는 이미지 포함 문서일 수 있어요). 한글 앱으로 열어볼까요?';
    } else {
      els.fwdMsg.textContent = label + ' 화면 표시에 실패했어요. 다른 앱으로 열어볼까요?';
    }
    showForward(file);
  }

  // --- byte fetching via Capacitor local file server ---
  async function fetchBytes(file, maxBytes) {
    const url = Capacitor && Capacitor.convertFileSrc ? Capacitor.convertFileSrc(file.path) : file.path;
    const res = await fetch(url, { cache: 'no-store' }); // don't let the WebView cache big documents on disk
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    const buf = await res.arrayBuffer();
    if (maxBytes && buf.byteLength > maxBytes) return buf.slice(0, maxBytes);
    return buf;
  }

  // --- PDF (lazy page rendering + page indicator) ---
  async function renderPdf(file) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    const pdfjsLib = window.pdfjsLib;
    const pdf = await pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: 'vendor/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'vendor/standard_fonts/',
    }).promise;
    if (seq !== openSeq) { try { pdf.destroy(); } catch (e) {} return; }
    pdfDoc = pdf;

    const container = els.content;
    container.innerHTML = '';
    show('content');

    const total = pdf.numPages;
    const cssWidth = Math.min(container.clientWidth || window.innerWidth, 1400);
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2); // base res (zoom re-render sharpens further; keep phone memory sane)
    const MAX_CANVAS_W = 3000; // cap backing store to bound memory during zoom re-render

    const page1 = await pdf.getPage(1);
    if (seq !== openSeq) return;
    const vp1 = page1.getViewport({ scale: 1 });
    const scale = (cssWidth - 20) / vp1.width;
    const phW = Math.floor(vp1.width * scale);
    const phH = Math.floor(vp1.height * scale);

    const rendered = new Set();
    async function renderPage(n, ph) {
      if (seq !== openSeq) return;
      const q = baseDpr * Math.max(1, zoom);
      const renderScale = Math.min(scale * q, MAX_CANVAS_W / vp1.width);
      if (ph.firstChild && ph._rs && ph._rs >= renderScale) return; // already rendered at >= this quality
      try {
        if (ph._task) { try { ph._task.cancel(); } catch (e) {} ph._task = null; }
        const page = n === 1 ? page1 : await pdf.getPage(n);
        if (seq !== openSeq) return;
        const vp = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto'; // keep each page's true aspect (handles mixed page sizes)
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
        ph._task = task;
        await task.promise;
        if (seq !== openSeq) return;
        ph.innerHTML = ''; // swap in the finished canvas only now (no flash / no concurrent append)
        ph.appendChild(canvas);
        ph.style.height = 'auto';
        ph._rs = renderScale;
        ph._task = null;
      } catch (e) { dbg('pdf page ' + n + ' err ' + e); }
    }

    const lazyObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const n = +en.target.dataset.page;
        if (en.isIntersecting) {
          if (!rendered.has(n)) { rendered.add(n); renderPage(n, en.target); }
        } else if (rendered.has(n)) {
          // evict offscreen page to cap memory (freeze measured, de-scaled height to avoid scroll jump)
          if (en.target._task) { try { en.target._task.cancel(); } catch (e) {} en.target._task = null; }
          en.target.style.height = (en.target.getBoundingClientRect().height / zoom) + 'px';
          en.target.innerHTML = '';
          en.target._rs = 0;
          rendered.delete(n);
        }
      });
    }, { root: $('viewer'), rootMargin: '1500px 0px' });

    const curObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting && els.pageind) {
          els.pageind.textContent = en.target.dataset.page + ' / ' + total;
        }
      });
    }, { root: $('viewer'), threshold: 0.5 });

    pdfObservers = [lazyObs, curObs];

    for (let n = 1; n <= total; n++) {
      const ph = document.createElement('div');
      ph.className = 'pdf-page-ph';
      ph.dataset.page = n;
      ph.style.width = phW + 'px';
      ph.style.height = phH + 'px';
      container.appendChild(ph);
      lazyObs.observe(ph);
      curObs.observe(ph);
    }
    pdfRerender = () => {
      container.querySelectorAll('.pdf-page-ph').forEach((ph) => {
        const n = +ph.dataset.page;
        if (rendered.has(n)) renderPage(n, ph);
      });
    };

    if (els.pageind) { els.pageind.textContent = '1 / ' + total; els.pageind.classList.remove('hidden'); }
    setTitle(file.name);
  }

  // --- Image ---
  async function renderImage(file, ext) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    curBlobUrl = url; // revoked on next open
    els.content.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'img-view';
    function applyFit() {
      if (seq !== openSeq) return;
      const cw = els.content.clientWidth || window.innerWidth;
      const fitW = img.naturalWidth ? Math.min(img.naturalWidth, cw) : cw;
      img.style.width = fitW + 'px';
      img.style.maxWidth = 'none';
      img.style.height = 'auto';
    }
    img.onload = applyFit;
    img.onerror = () => { if (seq === openSeq) fail('이미지', new Error('img load error'), file); };
    img.src = url;
    els.content.appendChild(img);
    show('content');
    if (img.complete && img.naturalWidth) applyFit();
  }

  // --- HWP / HWPX (via @rhwp/core WASM — canvas raster render, re-rendered on zoom for sharpness) ---
  let rhwpReady = false;
  let rhwpInitPromise = null;
  let rhwpDoc = null; // current HWP document (WASM) — freed before opening another
  async function ensureRhwp() {
    if (rhwpReady) return;
    if (!rhwpInitPromise) {
      setLoading('한글 엔진 로딩…');
      rhwpInitPromise = window.rhwpInit('vendor/rhwp_bg.wasm').then(() => { rhwpReady = true; });
    }
    await rhwpInitPromise;
  }
  async function renderHwp(file) {
    const seq = openSeq;
    await ensureRhwp();
    if (seq !== openSeq) return;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    const doc = new window.RhwpDocument(new Uint8Array(data));
    rhwpDoc = doc; // track for cleanup on next open
    const total = doc.pageCount();
    const container = els.content;
    container.innerHTML = '';
    show('content');
    showActionBar('<button class="iconbtn" id="ppt-open-ext">다른 앱으로 열기 (한컴 등)</button>');

    const cssW = Math.min(container.clientWidth || window.innerWidth, 1400) - 12;
    const baseDpr = Math.min(window.devicePixelRatio || 1, 2); // base res (zoom re-render sharpens further; keep phone memory sane)
    const MAX_CANVAS_W = 3000; // cap backing width to bound memory during zoom re-render

    // reference page pixel size (page 0 at scale 1) → aspect estimate + scale math
    let refW = 595, refH = 842;
    try {
      const probe = document.createElement('canvas');
      doc.renderPageToCanvas(0, probe, 1);
      if (probe.width && probe.height) { refW = probe.width; refH = probe.height; }
    } catch (e) {}
    const phH = Math.round(refH * (cssW / refW));
    // render scale: fit-to-width baseline × quality (dpr × zoom), capped by max canvas width
    function scaleFor() {
      const targetW = Math.min(cssW * baseDpr * Math.max(1, zoom), MAX_CANVAS_W);
      return targetW / refW;
    }

    const rendered = new Set();
    function renderHwpPage(n, ph) {
      const scale = scaleFor();
      if (ph.firstChild && ph._rs >= scale) return; // already rendered at >= this quality
      try {
        const canvas = document.createElement('canvas');
        doc.renderPageToCanvas(n, canvas, scale); // canvas rasterises text at target res (no SVG-text zoom garble)
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        ph.innerHTML = '';
        ph.appendChild(canvas);
        ph.style.height = 'auto';
        ph._rs = scale;
        rendered.add(n);
      } catch (e) { ph.innerHTML = '<div class="hwpx-note">이 페이지를 표시할 수 없어요</div>'; rendered.add(n); }
    }
    const lazy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const n = +en.target.dataset.page;
        if (en.isIntersecting) {
          if (!rendered.has(n)) renderHwpPage(n, en.target);
        } else if (rendered.has(n)) {
          // evict offscreen page (freeze measured, de-scaled height to avoid scroll jump)
          en.target.style.height = (en.target.getBoundingClientRect().height / zoom) + 'px';
          en.target.innerHTML = '';
          en.target._rs = 0;
          rendered.delete(n);
        }
      });
    }, { root: $('viewer'), rootMargin: '1500px 0px' });
    const curObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting && els.pageind) els.pageind.textContent = (+en.target.dataset.page + 1) + ' / ' + total; });
    }, { root: $('viewer'), threshold: 0.5 });
    pdfObservers = [lazy, curObs];

    for (let i = 0; i < total; i++) {
      const ph = document.createElement('div');
      ph.className = 'hwp-svg-page';
      ph.dataset.page = i;
      ph.style.width = cssW + 'px';
      ph.style.height = phH + 'px';
      container.appendChild(ph);
      lazy.observe(ph);
      curObs.observe(ph);
    }
    // after zoom settles, re-render visible pages at the new (higher) scale for sharpness
    hwpRerender = () => {
      const vr = $('viewer').getBoundingClientRect();
      container.querySelectorAll('.hwp-svg-page').forEach((ph) => {
        const r = ph.getBoundingClientRect();
        if (r.bottom > vr.top - 1500 && r.top < vr.bottom + 1500) renderHwpPage(+ph.dataset.page, ph);
      });
    };
    if (els.pageind) { els.pageind.textContent = '1 / ' + total; els.pageind.classList.remove('hidden'); }
    setTitle(file.name + '  (' + total + 'p)');
  }
  const renderHwpx = renderHwp; // @rhwp/core handles both

  // --- Word (docx-preview — preserves tables/styles/layout) ---
  async function renderDocx(file) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    els.content.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'docx-wrap';
    els.content.appendChild(wrap);
    show('content');
    await window.docxRender(data, wrap, null, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      useBase64URL: true,
    });
    if (seq !== openSeq) return;
    mergeBorderedParas(wrap);
  }

  // docx-preview draws a border around EACH paragraph; Word merges consecutive
  // same-border paragraphs into one box. Merge them by dropping the inner edges.
  function borderSig(p) {
    const s = p.style;
    if (s && s.borderStyle && s.borderStyle !== 'none' && s.borderWidth) {
      return s.borderWidth + '|' + s.borderStyle + '|' + s.borderColor;
    }
    return null;
  }
  function mergeBorderedParas(root) {
    const ps = Array.from(root.querySelectorAll('p'));
    let i = 0;
    while (i < ps.length) {
      const sig = borderSig(ps[i]);
      if (!sig) { i++; continue; }
      let j = i;
      while (j + 1 < ps.length && ps[j + 1].previousElementSibling === ps[j] && borderSig(ps[j + 1]) === sig) j++;
      if (j > i) {
        for (let k = i; k <= j; k++) {
          if (k > i) { ps[k].style.borderTop = 'none'; ps[k].style.marginTop = '0'; }
          if (k < j) { ps[k].style.borderBottom = 'none'; ps[k].style.marginBottom = '0'; }
        }
      }
      i = j + 1;
    }
  }

  // --- Excel ---
  // ---- Excel styled rendering (ExcelJS) ----
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function parseRange(r) {
    const p = r.split(':'); const ma = /([A-Z]+)(\d+)/.exec(p[0]); const mb = /([A-Z]+)(\d+)/.exec(p[1]);
    return { c1: colToNum(ma[1]), r1: +ma[2], c2: colToNum(mb[1]), r2: +mb[2] };
  }
  function argbCss(c) { if (c && c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) return '#' + c.argb.slice(2); return null; }
  function fixReservedSheetNames(u8) {
    try {
      const zip = window.JVUnzip(u8); const key = 'xl/workbook.xml';
      if (zip[key]) {
        let xml = new TextDecoder().decode(zip[key]);
        if (/name="History"/.test(xml)) {
          xml = xml.replace(/(<sheet [^>]*name=")History(")/g, '$1History $2');
          zip[key] = new TextEncoder().encode(xml);
          return window.JVZip(zip);
        }
      }
    } catch (e) {}
    return u8;
  }
  function renderExcelSheet(ws) {
    const merges = (ws.model && ws.model.merges ? ws.model.merges : []).map(parseRange);
    const span = {}; const covered = new Set();
    merges.forEach((m) => {
      span[m.r1 + ':' + m.c1] = { cs: m.c2 - m.c1 + 1, rs: m.r2 - m.r1 + 1 };
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (!(r === m.r1 && c === m.c1)) covered.add(r + ':' + c);
    });
    const maxCol = ws.actualColumnCount || ws.columnCount || 1;
    const maxRow = ws.actualRowCount || ws.rowCount || 1;
    const table = document.createElement('table');
    table.className = 'xlsx-table';
    const cg = document.createElement('colgroup');
    const corner = document.createElement('col'); corner.style.width = '40px'; cg.appendChild(corner);
    for (let c = 1; c <= maxCol; c++) {
      const col = document.createElement('col');
      const w = ws.getColumn(c).width;
      col.style.width = (w ? Math.round(w * 7 + 5) : 64) + 'px';
      cg.appendChild(col);
    }
    table.appendChild(cg);
    const head = document.createElement('tr'); head.className = 'xlsx-head';
    const corner2 = document.createElement('th'); corner2.className = 'xlsx-corner'; head.appendChild(corner2);
    for (let c = 1; c <= maxCol; c++) { const th = document.createElement('th'); th.className = 'xlsx-colh'; th.textContent = numToCol(c); head.appendChild(th); }
    table.appendChild(head);
    for (let r = 1; r <= maxRow; r++) {
      const tr = document.createElement('tr');
      const rownum = document.createElement('th'); rownum.className = 'xlsx-rowh'; rownum.textContent = r; tr.appendChild(rownum);
      const row = ws.getRow(r);
      if (row.height) tr.style.height = Math.round(row.height * 1.33) + 'px';
      for (let c = 1; c <= maxCol; c++) {
        if (covered.has(r + ':' + c)) continue;
        const cell = row.getCell(c);
        const td = document.createElement('td');
        const sp = span[r + ':' + c]; if (sp) { if (sp.cs > 1) td.colSpan = sp.cs; if (sp.rs > 1) td.rowSpan = sp.rs; }
        const st = cell.style || {};
        let txt = (cell.text != null ? String(cell.text) : '');
        const nf = cell.numFmt || st.numFmt;
        if (typeof cell.value === 'number' && nf) {
          try { const f = window.XLSX.SSF.format(nf, cell.value); if (f != null) txt = String(f); } catch (e) {}
        }
        td.textContent = txt;
        if (st.fill && st.fill.type === 'pattern') { const fg = argbCss(st.fill.fgColor); if (fg) td.style.background = fg; }
        if (st.font) {
          if (st.font.bold) td.style.fontWeight = 'bold';
          if (st.font.italic) td.style.fontStyle = 'italic';
          const fc = argbCss(st.font.color); if (fc) td.style.color = fc;
          if (st.font.size) td.style.fontSize = st.font.size + 'pt';
        }
        const al = st.alignment || {};
        if (al.horizontal) td.style.textAlign = al.horizontal;
        else if (typeof cell.value === 'number') td.style.textAlign = 'right';
        if (al.vertical) td.style.verticalAlign = al.vertical === 'middle' ? 'middle' : al.vertical;
        if (al.wrapText) td.style.whiteSpace = 'normal';
        const b = st.border || {};
        [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']].forEach((p) => {
          if (b[p[0]] && b[p[0]].style) td.style['border' + p[1]] = '1px solid ' + (argbCss(b[p[0]].color) || '#9aa');
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    return table;
  }

  // Mount sheets with a fixed top tab bar (in #actionbar so it doesn't zoom); one sheet visible at a time.
  let xlsxSheetEls = [];
  function activateSheet(i) {
    xlsxSheetEls.forEach((el, k) => el.classList.toggle('hidden', k !== i));
    if (els.actionbar) els.actionbar.querySelectorAll('.sheet-tab-btn').forEach((b, k) => b.classList.toggle('active', k === i));
  }
  function mountSheets(sheets) {
    els.content.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sheet-view';
    xlsxSheetEls = sheets.map((s, i) => {
      const sec = document.createElement('div');
      sec.className = 'xlsx-sheet' + (i === 0 ? '' : ' hidden');
      const holder = document.createElement('div');
      holder.style.overflowX = 'auto';
      holder.appendChild(s.node);
      sec.appendChild(holder);
      wrap.appendChild(sec);
      return sec;
    });
    els.content.appendChild(wrap);
    show('content');
    if (sheets.length > 1) {
      const btns = sheets.map((s, i) =>
        '<button class="sheet-tab-btn' + (i === 0 ? ' active' : '') + '" data-sheet="' + i + '">' +
        escapeHtml(s.name) + '</button>').join('');
      showActionBar('<div class="sheet-tabs">' + btns + '</div>');
    }
  }

  async function renderXlsx(file) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    const ext = extOf(file.name);
    if (ext !== 'xls' && window.ExcelJS) {
      try {
        const fixed = fixReservedSheetNames(new Uint8Array(data));
        const wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(fixed);
        if (seq !== openSeq) return;
        const sheets = wb.worksheets.map((ws) => ({ name: ws.name.trim(), node: renderExcelSheet(ws) }));
        mountSheets(sheets);
        return;
      } catch (e) { dbg('ExcelJS failed, fallback to SheetJS: ' + (e && e.message)); }
    }
    // fallback: SheetJS plain table (also handles .xls)
    const wb = window.XLSX.read(new Uint8Array(data), { type: 'array' });
    if (seq !== openSeq) return;
    const sheets = wb.SheetNames.map((name) => {
      const holder = document.createElement('div');
      holder.innerHTML = window.XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false });
      sanitizeNode(holder);
      holder.querySelectorAll('td, th').forEach((c) => { const t = c.textContent; if (/[₩$€£¥]/.test(t) && !/\d/.test(t)) c.textContent = ''; });
      return { name: name, node: holder };
    });
    mountSheets(sheets);
  }

  // --- PowerPoint (static preview, vertical slide list + handoff to PowerPoint) ---
  // temporary on-screen debug panel (PPT diagnostics) — tap to dismiss
  function pptDbg(host, line) {
    let box = document.getElementById('ppt-dbg');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ppt-dbg';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:auto;z-index:99999;'
        + 'background:rgba(0,20,40,0.92);color:#8fe;font:11px/1.45 monospace;padding:8px 10px;white-space:pre-wrap';
      box.addEventListener('click', () => box.remove());
      if (document.body) document.body.appendChild(box);
    }
    box.textContent += line + '\n';
    box.scrollTop = box.scrollHeight;
  }

  // On-device black diagnostic: scan a grid over the viewport; for each sample, walk the
  // element stack under that point and report the first ancestor with a non-transparent bg.
  // Tells us WHICH layer (canvas / slide / wrapper / body) is painting black on the phone.
  function runPptDiag() {
    const host = document.getElementById('pptx-wrapper');
    const box = document.getElementById('ppt-dbg') || (function () { pptDbg(host, ''); return document.getElementById('ppt-dbg'); })();
    const W = window.innerWidth, H = window.innerHeight;
    const lines = ['[DIAG] viewport ' + W + 'x' + H];
    const seen = {};
    for (let gy = 0.12; gy < 0.95; gy += 0.14) {
      for (let gx = 0.15; gx < 1; gx += 0.2) {
        const x = Math.round(W * gx), y = Math.round(H * gy);
        const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]).filter(Boolean);
        // find first layer with an opaque-ish background
        for (const el of stack) {
          const cs = getComputedStyle(el);
          const bg = cs.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            const tag = el.tagName + '.' + (typeof el.className === 'string' ? el.className.replace(/\s+/g, '.').slice(0, 22) : '');
            const key = tag + '|' + bg;
            seen[key] = (seen[key] || 0) + 1;
            break;
          }
        }
      }
    }
    Object.keys(seen).sort((a, b) => seen[b] - seen[a]).forEach((k) => lines.push('  ' + seen[k] + '×  ' + k));
    // also count canvases and their computed bg
    if (host) {
      const cvs = host.querySelectorAll('canvas');
      let cbg = {};
      cvs.forEach((c) => { const b = getComputedStyle(c).backgroundColor; cbg[b] = (cbg[b] || 0) + 1; });
      lines.push('[DIAG] canvases=' + cvs.length + '  ' + Object.keys(cbg).map((k) => cbg[k] + '×' + k).join('  '));
    }
    lines.forEach((l) => pptDbg(host, l));
  }


  async function renderPptx(file) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    els.content.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'hwpx-note';
    note.textContent = '슬라이드 렌더링 중… 용량이 크면 시간이 걸릴 수 있어요.';
    els.content.appendChild(note);
    const host = document.createElement('div');
    host.id = 'pptx-wrapper';
    els.content.appendChild(host);
    show('content');
    showActionBar('<button class="iconbtn" id="ppt-open-ext">▶ PowerPoint로 열기 (애니메이션·슬라이드쇼)</button>'
      + '<button class="iconbtn" id="ppt-diag" style="margin-top:6px">🩺 검정 진단</button>');
    const w = Math.min(els.content.clientWidth || window.innerWidth, 1280) - 8;
    const dpr0 = window.devicePixelRatio || 1;
    pptDbg(host, '[PPT] start  file=' + (data.byteLength / 1048576).toFixed(1) + 'MB  width=' + w + '  dpr=' + dpr0);
    pptxPreviewer = window.pptxInit(host, { width: w, mode: 'list' });
    try {
      const t0 = Date.now();
      await pptxPreviewer.preview(data);
      if (seq !== openSeq) return;
      pptDbg(host, '[PPT] preview done in ' + (Date.now() - t0) + 'ms');
      // measure images: total, broken(decode-failed → likely black), oversized
      const imgs = Array.from(host.querySelectorAll('img'));
      let broken = 0, over = 0, maxMP = 0, sumMP = 0;
      for (const im of imgs) {
        try { if (!im.complete) await im.decode().catch(() => {}); } catch (e) {}
        const mp = (im.naturalWidth * im.naturalHeight) / 1e6;
        sumMP += mp; if (mp > maxMP) maxMP = mp;
        if (!im.naturalWidth || !im.naturalHeight) broken++;
        else if (im.naturalWidth > 1400) over++;
      }
      pptDbg(host, '[PPT] imgs=' + imgs.length + '  broken(decode-fail)=' + broken
        + '  >1400px=' + over + '  maxMP=' + maxMP.toFixed(1) + '  sumMP=' + sumMP.toFixed(0));
      await downscalePptxImages(host, seq, (m) => pptDbg(host, m));
      // Force backgrounds via inline style (CSS !important isn't reliably honored on some WebViews):
      // pptx wrapper paints itself #000 → set app bg; each slide → white so empty areas aren't black.
    try {
      const appBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0d1117';
      const wrapEl = host.querySelector('.pptx-preview-wrapper');
      if (wrapEl) wrapEl.style.background = appBg;
      host.style.background = appBg;
      els.content.style.background = appBg;      // scroll gaps fall through to these — make them app bg, not black
      $('viewer').style.background = appBg;
      let whitened = 0;
      host.querySelectorAll('[class*="pptx-preview-slide-wrapper"]').forEach((s) => {
        s.style.background = '#fff';
        s.style.margin = '0 auto';               // drop the 10px inter-slide gap that showed as a black band
        // Some phone GPUs promote transform:scale subtrees to a hardware layer whose backdrop
        // renders BLACK. Force an opaque own-backdrop and defeat layer-isolation quirks.
        s.style.isolation = 'isolate';
        s.style.backgroundColor = '#fff';
        s.style.backfaceVisibility = 'visible';
        s.style.willChange = 'auto';
        whitened++;
      });
      // Inner slide containers → opaque white so nothing underneath shows through as black.
      let innerFixed = 0;
      host.querySelectorAll('.slide-wrapper, .slide-background, .slide-content').forEach((n) => {
        if (getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') { n.style.backgroundColor = '#fff'; innerFixed++; }
      });
      // pptx-preview draws shapes/charts onto <canvas> via zrender. A transparent canvas
      // composited on some phone GPUs shows up BLACK. Give every slide canvas a white backing.
      let canvasFixed = 0;
      host.querySelectorAll('canvas').forEach((c) => { c.style.background = '#fff'; canvasFixed++; });
      pptDbg(host, '[PPT] bg forced: wrapper=' + (wrapEl ? appBg : 'none') + '  slides→white=' + whitened
        + '  inner=' + innerFixed + '  canvas=' + canvasFixed + '  gaps removed');
    } catch (e) { pptDbg(host, '[PPT] bg force err: ' + (e && e.message)); }
      pptDbg(host, '[PPT] done. If still black, tell me the numbers above.');
    } catch (e) {
      pptDbg(host, '[PPT] ERROR: ' + (e && (e.message || e)));
    } finally { if (seq === openSeq) note.remove(); }
  }

  // Re-encode EVERY pptx <img> through a canvas to a plain RGBA PNG. Two fixes at once:
  //  (1) some phone WebViews render palette-PNG + tRNS transparency as BLACK — re-encoding to
  //      straight RGBA makes transparent areas transparent again (the "black half" bug).
  //  (2) oversized bitmaps are downscaled to ~display size to cut decode memory.
  async function downscalePptxImages(host, seq, log) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const imgs = Array.from(host.querySelectorAll('img'));
    let reenc = 0, scaled = 0, failed = 0, decodeFailed = 0;
    for (const img of imgs) {
      if (seq !== openSeq) return;
      try {
        if (!img.complete) { await img.decode().catch(() => {}); }
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) { decodeFailed++; continue; }
        const rect = img.getBoundingClientRect();
        // keep resolution headroom for zoom-in: target = display width × dpr × zoom headroom,
        // but never upscale beyond the source and never exceed a memory cap.
        const ZOOM_HEADROOM = 3;
        const MAX_W = 2200; // per-image width cap (bounds memory even for big source images)
        const wantW = Math.round((rect.width || nw) * dpr * ZOOM_HEADROOM);
        const targetW = Math.min(nw, wantW, MAX_W);   // don't upscale past source; cap for memory
        const scale = targetW < nw ? targetW / nw : 1; // shrink only when source is larger than target
        if (scale < 1) scaled++;
        const cw = Math.max(1, Math.round(nw * scale));
        const ch = Math.max(1, Math.round(nh * scale));
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cw, ch);            // keep transparency (don't paint black)
        ctx.drawImage(img, 0, 0, cw, ch);
        img.src = cv.toDataURL('image/png');     // → plain RGBA PNG; transparent stays transparent
        reenc++;
        await new Promise((r) => setTimeout(r, 0));
      } catch (e) { failed++; }
    }
    if (log) log('[PPT] reencoded=' + reenc + '  downscaled=' + scaled + '  failed=' + failed + '  decodeFailedImgs=' + decodeFailed);
  }

  // --- Text ---
  async function renderText(file) {
    const seq = openSeq;
    const data = await fetchBytes(file);
    if (seq !== openSeq) return;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      if (text.includes('�')) {
        try { text = new TextDecoder('euc-kr').decode(data); } catch (_) {}
      }
    } catch (_) { text = new TextDecoder().decode(data); }
    els.content.innerHTML = '';
    const pre = document.createElement('div');
    pre.className = 'text-view';
    pre.textContent = text;
    els.content.appendChild(pre);
    show('content');
  }

  // --- Forward / share ---
  function showForward(file) {
    els.fwdName.textContent = file.name || '문서';
    const ext = extOf(file.name);
    els.fwdType.textContent = ext ? ('.' + ext + ' 파일') : '';
    show('forward');
  }
  function forward(file) {
    els.fwdMsg.textContent = '이 형식은 다른 앱에서 더 잘 열려요.';
    showForward(file);
    doForward();
  }
  async function doForward() {
    if (!FileBridge || !currentFile) { toast('연결할 앱이 없어요'); return; }
    try { await FileBridge.openExternally(); }
    catch (e) { dbg(e); toast('다른 앱으로 열지 못했어요'); }
  }
  async function doShare() {
    if (!FileBridge || !currentFile) { toast('공유할 파일이 없어요'); return; }
    try { await FileBridge.shareFile(); }
    catch (e) { dbg(e); toast('공유하지 못했어요'); }
  }

  // --- file picker ---
  async function pickFile() {
    if (!FileBridge) { toast('파일 선택을 사용할 수 없어요'); return; }
    try {
      const res = await FileBridge.pickFile();
      if (res && res.path) openFile(res);
    } catch (e) { dbg(e); }
  }

  // --- in-document search (Ctrl+F) — text-based views (Word/Excel/HWPX/text) ---
  const searchBar = $('searchbar');
  const searchInput = $('search-input');
  const searchCount = $('search-count');
  let matches = [], curMatch = -1, searchDebounce = null;

  function clearHighlights() {
    const marks = els.content.querySelectorAll('mark.jv-hl');
    marks.forEach((m) => {
      const t = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(t, m);
    });
    els.content.normalize();
    matches = []; curMatch = -1;
  }
  function openSearch() {
    if (els.content.classList.contains('hidden')) return;
    if (searchBar) searchBar.classList.remove('hidden');
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  }
  function closeSearch() {
    if (searchBar) searchBar.classList.add('hidden');
    clearHighlights();
    if (searchInput) searchInput.value = '';
    if (searchCount) searchCount.textContent = '';
  }
  function runSearch(q) {
    clearHighlights();
    if (!q) { if (searchCount) searchCount.textContent = ''; return; }
    if (currentExt === 'pdf') { if (searchCount) searchCount.textContent = 'PDF 미지원'; return; }
    const ql = q.toLowerCase();
    const walker = document.createTreeWalker(els.content, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.toLowerCase().includes(ql)
        && n.parentNode && !/SCRIPT|STYLE/.test(n.parentNode.nodeName)
        && !(n.parentNode.namespaceURI && n.parentNode.namespaceURI.indexOf('svg') >= 0))
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = []; let nd;
    while ((nd = walker.nextNode())) nodes.push(nd);
    nodes.forEach((node) => {
      const text = node.nodeValue, lower = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let last = 0, idx = lower.indexOf(ql);
      while (idx >= 0) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.className = 'jv-hl';
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        matches.push(mark);
        last = idx + q.length;
        idx = lower.indexOf(ql, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    if (matches.length) gotoMatch(0);
    else if (searchCount) searchCount.textContent = '0';
  }
  function gotoMatch(i) {
    if (!matches.length) return;
    if (curMatch >= 0 && matches[curMatch]) matches[curMatch].classList.remove('jv-hl-cur');
    curMatch = (i + matches.length) % matches.length;
    const m = matches[curMatch];
    m.classList.add('jv-hl-cur');
    m.scrollIntoView({ block: 'center' });
    if (searchCount) searchCount.textContent = (curMatch + 1) + '/' + matches.length;
  }

  // --- wire up ---
  document.addEventListener('click', (e) => {
    const id = e.target.id;
    if (id === 'btn-open' || id === 'btn-open2') pickFile();
    else if (id === 'btn-home') goHome();
    else if (id === 'btn-forward' || id === 'ppt-open-ext') doForward();
    else if (id === 'ppt-diag') runPptDiag();
    else if (id === 'btn-share') doShare();
    else if (id === 'btn-search') openSearch();
    else if (id === 'search-prev') gotoMatch(curMatch - 1);
    else if (id === 'search-next') gotoMatch(curMatch + 1);
    else if (id === 'search-close') closeSearch();
    else if (id === 'btn-dark') toggleDarkReader();
    else if (id === 'zoom-in') setZoom(zoom * 1.25);
    else if (id === 'zoom-out') setZoom(zoom / 1.25);
    else if (id === 'zoom-reset') setZoom(1);
    else if (e.target.classList && e.target.classList.contains('sheet-tab-btn')) activateSheet(+e.target.dataset.sheet);
    else {
      const item = e.target.closest && e.target.closest('.recent-item');
      if (item) {
        openFile({
          name: decodeURIComponent(item.dataset.name),
          path: decodeURIComponent(item.dataset.path),
        });
      }
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(searchInput.value.trim()), 250);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); gotoMatch(curMatch + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') closeSearch();
    });
  }

  // pinch-to-zoom on content only
  const viewerEl = $('viewer');
  let pinchDist = 0, pinchZoom = 1, pinching = false;
  function touchDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  viewerEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && !els.content.classList.contains('hidden')) {
      pinching = true; pinchDist = touchDist(e.touches); pinchZoom = zoom;
    }
  }, { passive: true });
  viewerEl.addEventListener('touchmove', (e) => {
    if (pinching && e.touches.length === 2) {
      e.preventDefault();
      const d = touchDist(e.touches);
      if (pinchDist > 0) setZoom(pinchZoom * (d / pinchDist));
    }
  }, { passive: false });
  viewerEl.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinching = false; }, { passive: true });

  // file arriving while app is open
  if (FileBridge && FileBridge.addListener) {
    FileBridge.addListener('incomingFile', (data) => { if (data && data.path) openFile(data); });
  }

  // hardware back button (Android): in a document → go to landing; already on landing → exit app
  const CapApp = window.JVApp || (Capacitor && Capacitor.Plugins && Capacitor.Plugins.App);
  if (CapApp && CapApp.addListener) {
    CapApp.addListener('backButton', () => {
      if (els.landing.classList.contains('hidden')) goLanding();
      else if (CapApp.exitApp) { try { CapApp.exitApp(); } catch (e) {} }
    });
  }

  // cold-start launch file
  async function boot() {
    show('landing');
    if (!FileBridge) { showErr('FileBridge plugin not available'); return; }
    try {
      const res = await FileBridge.getLaunchFile();
      if (res && res.path) openFile(res);
      else { show('landing'); }
    } catch (e) { showErr('getLaunchFile: ' + (e.message || e)); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

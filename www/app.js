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
  let errBox = null;
  function showErr(msg) {
    try {
      if (!errBox) {
        errBox = document.createElement('div');
        errBox.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:30%;overflow:auto;' +
          'background:rgba(60,0,0,0.9);color:#ffb3b3;font:11px/1.4 monospace;padding:6px 8px;z-index:99999;white-space:pre-wrap';
        if (document.body) document.body.appendChild(errBox);
      }
      errBox.textContent += msg + '\n';
    } catch (e) {}
  }
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
    pageind: $('pageind'),
    recent: $('recent'),
  };

  let currentFile = null; // {name, path}

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
  function setZoom(z) { zoom = clampZoom(z); applyZoom(); }

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
    if (els.pageind) els.pageind.classList.add('hidden'); // PDF re-shows it
    if (onContent) applyDarkReader();
    if (which === 'landing') { setTitle('OneView'); renderRecents(); }
  }
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
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'];
  const TEXT_EXT = ['txt', 'csv', 'log', 'md', 'json', 'xml', 'html', 'htm', 'js', 'css', 'py', 'c', 'cpp', 'java', 'ini', 'yaml', 'yml', 'tsv'];

  function detectByMagic(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image';
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image';
    return null;
  }

  // --- lazy-render bookkeeping (PDF) ---
  let pdfObservers = [];
  function clearPdfObservers() {
    pdfObservers.forEach((o) => { try { o.disconnect(); } catch (e) {} });
    pdfObservers = [];
  }

  // --- core open flow ---
  async function openFile(file) {
    dbg('openFile ' + JSON.stringify(file));
    if (!file || !file.path) { show('landing'); return; }
    clearPdfObservers();
    currentFile = file;
    saveRecent(file);
    setZoom(1);
    setTitle(file.name);
    setLoading('여는 중…');

    const ext = extOf(file.name);

    if (ext === 'pdf') return renderPdf(file).catch((e) => fail('PDF', e, file));
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
        const kind = detectByMagic(new Uint8Array(buf));
        if (kind === 'pdf') return renderPdf(file).catch((e) => fail('PDF', e, file));
        if (kind === 'image') return renderImage(file, 'png').catch((e) => fail('이미지', e, file));
      } catch (_) {}
    }
    forward(file);
  }

  function fail(label, err, file) {
    dbg('render failed: ' + label + ' ' + (err && (err.message || err)));
    els.fwdMsg.textContent = label + ' 화면 표시에 실패했어요. 다른 앱으로 열어볼까요?';
    showForward(file);
  }

  // --- byte fetching via Capacitor local file server ---
  async function fetchBytes(file, maxBytes) {
    const url = Capacitor && Capacitor.convertFileSrc ? Capacitor.convertFileSrc(file.path) : file.path;
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed ' + res.status);
    const buf = await res.arrayBuffer();
    if (maxBytes && buf.byteLength > maxBytes) return buf.slice(0, maxBytes);
    return buf;
  }

  // --- PDF (lazy page rendering + page indicator) ---
  async function renderPdf(file) {
    const data = await fetchBytes(file);
    const pdfjsLib = window.pdfjsLib;
    const pdf = await pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: 'vendor/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'vendor/standard_fonts/',
    }).promise;

    const container = els.content;
    container.innerHTML = '';
    show('content');

    const total = pdf.numPages;
    const cssWidth = Math.min(container.clientWidth || window.innerWidth, 1400);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const page1 = await pdf.getPage(1);
    const vp1 = page1.getViewport({ scale: 1 });
    const scale = (cssWidth - 20) / vp1.width;
    const phW = Math.floor(vp1.width * scale);
    const phH = Math.floor(vp1.height * scale);

    const rendered = new Set();
    async function renderPage(n, ph) {
      try {
        const page = n === 1 ? page1 : await pdf.getPage(n);
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page';
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        ph.innerHTML = '';
        ph.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      } catch (e) { dbg('pdf page ' + n + ' err ' + e); }
    }

    const lazyObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const n = +en.target.dataset.page;
          if (!rendered.has(n)) { rendered.add(n); renderPage(n, en.target); }
        }
      });
    }, { root: $('viewer'), rootMargin: '800px 0px' });

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

    if (els.pageind) { els.pageind.textContent = '1 / ' + total; els.pageind.classList.remove('hidden'); }
    setTitle(file.name);
  }

  // --- Image ---
  async function renderImage(file, ext) {
    const data = await fetchBytes(file);
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    els.content.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'img-view';
    img.src = url;
    img.onerror = () => fail('이미지', new Error('img load error'), file);
    els.content.appendChild(img);
    show('content');
  }

  // --- HWP (v5 binary, via hwp.js) ---
  async function renderHwp(file) {
    const data = await fetchBytes(file);
    const bytes = new Uint8Array(data);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    els.content.innerHTML = '';
    const host = document.createElement('div');
    host.id = 'hwp-container';
    els.content.appendChild(host);
    show('content');
    new window.HWPViewer(host, bin, { type: 'binary' });
  }

  // --- HWPX (zip + OWPML) — text-level extraction ---
  async function renderHwpx(file) {
    const data = await fetchBytes(file);
    const zip = window.JVUnzip(new Uint8Array(data));
    const decoder = new TextDecoder('utf-8');
    const sections = Object.keys(zip).filter((n) => /Contents\/section\d+\.xml$/i.test(n)).sort();
    let html = '';
    sections.forEach((n) => {
      const xml = decoder.decode(zip[n]);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const ps = Array.from(doc.getElementsByTagNameNS('*', 'p'));
      if (ps.length) {
        ps.forEach((p) => {
          const ts = Array.from(p.getElementsByTagNameNS('*', 't'));
          html += '<p>' + (escapeHtml(ts.map((t) => t.textContent).join('')) || '&nbsp;') + '</p>';
        });
      } else {
        const ts = Array.from(doc.getElementsByTagNameNS('*', 't'));
        html += ts.map((t) => '<p>' + escapeHtml(t.textContent) + '</p>').join('');
      }
    });
    els.content.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'doc-view';
    page.innerHTML = '<div class="hwpx-note">HWPX 내용 보기 (레이아웃 단순화)</div>' + (html || '<p>(내용 없음)</p>');
    els.content.appendChild(page);
    show('content');
  }

  // --- Word ---
  async function renderDocx(file) {
    const data = await fetchBytes(file);
    const result = await window.mammoth.convertToHtml({ arrayBuffer: data });
    els.content.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'doc-view';
    page.innerHTML = result.value || '<p>(빈 문서)</p>';
    els.content.appendChild(page);
    show('content');
  }

  // --- Excel ---
  async function renderXlsx(file) {
    const data = await fetchBytes(file);
    const wb = window.XLSX.read(new Uint8Array(data), { type: 'array' });
    els.content.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sheet-view';
    wb.SheetNames.forEach((name) => {
      const tab = document.createElement('div');
      tab.className = 'sheet-tab';
      tab.textContent = name;
      wrap.appendChild(tab);
      const holder = document.createElement('div');
      holder.style.overflowX = 'auto';
      holder.innerHTML = window.XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false });
      wrap.appendChild(holder);
    });
    els.content.appendChild(wrap);
    show('content');
  }

  // --- PowerPoint (static preview + handoff to PowerPoint) ---
  async function renderPptx(file) {
    const data = await fetchBytes(file);
    els.content.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'ppt-bar';
    bar.innerHTML = '<button class="iconbtn" id="ppt-open-ext">▶ PowerPoint로 열기 (애니메이션·슬라이드쇼)</button>';
    els.content.appendChild(bar);
    const host = document.createElement('div');
    host.id = 'pptx-wrapper';
    els.content.appendChild(host);
    show('content');
    const w = Math.min(els.content.clientWidth || window.innerWidth, 1280) - 8;
    const previewer = window.pptxInit(host, { width: w, height: Math.round((w * 9) / 16) });
    await previewer.preview(data);
  }

  // --- Text ---
  async function renderText(file) {
    const data = await fetchBytes(file);
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

  // --- wire up ---
  document.addEventListener('click', (e) => {
    const id = e.target.id;
    if (id === 'btn-open' || id === 'btn-open2') pickFile();
    else if (id === 'btn-forward' || id === 'ppt-open-ext') doForward();
    else if (id === 'btn-share') doShare();
    else if (id === 'btn-dark') toggleDarkReader();
    else if (id === 'zoom-in') setZoom(zoom * 1.25);
    else if (id === 'zoom-out') setZoom(zoom / 1.25);
    else if (id === 'zoom-reset') setZoom(1);
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

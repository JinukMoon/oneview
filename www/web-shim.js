/* OneView web shim — browser/PWA fallback for the native FileBridge plugin.
 *
 * The Android build talks to a native `FileBridge` Capacitor plugin. In a plain
 * browser (GitHub Pages / PWA) that plugin does not exist, so this shim registers
 * a `window.FileBridge` implemented with web standards:
 *   - pickFile()      → <input type="file"> picker; the chosen File is exposed as a
 *                       blob: URL in `path`, which app.js's fetchBytes() fetches as-is.
 *   - shareFile()     → navigator.share (Web Share, incl. files) with a download fallback.
 *   - openExternally  → download fallback (browsers can't hand a blob to another app).
 *   - getLaunchFile() → null (no OS intent hand-off on the web).
 *   - incomingFile    → no-op listener (no OS intent hand-off on the web).
 *
 * Loaded from index.html only when the native bridge is absent, so it never
 * interferes with the packaged Android app.
 */
(function () {
  'use strict';

  // If a real native bridge is present (Capacitor WebView), do nothing.
  var cap = window.JVCapacitor || window.Capacitor;
  var hasNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  if (hasNative) return;

  // Track the currently open File + its blob URL so share/openExternally can reuse it.
  var current = null;      // { file: File, url: string, name: string }
  var listeners = {};      // eventName -> [cb]

  function revoke(url) { try { if (url) URL.revokeObjectURL(url); } catch (e) {} }

  // Build a File-picker <input>, resolve to { name, path } where path is a blob: URL.
  function pickViaInput() {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      // No `accept` filter: OneView sniffs by extension/magic and forwards the rest,
      // so let the user pick anything from their storage / iCloud / photos.
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);

      var done = false;
      function cleanup() {
        try { document.body.removeChild(input); } catch (e) {}
      }
      input.addEventListener('change', function () {
        done = true;
        var f = input.files && input.files[0];
        cleanup();
        if (!f) { resolve(null); return; }
        // Revoke the previous blob URL to avoid leaking memory across opens.
        if (current) revoke(current.url);
        var url = URL.createObjectURL(f);
        current = { file: f, url: url, name: f.name };
        resolve({ name: f.name, path: url });
      });
      // If the dialog is dismissed, `change` never fires. Recover the DOM node when
      // focus returns to the window so we don't leak detached inputs.
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(function () { if (!done) cleanup(); }, 500);
      });
      input.click();
    });
  }

  function downloadCurrent() {
    if (!current) return;
    var a = document.createElement('a');
    a.href = current.url;
    a.download = current.name || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  var FileBridge = {
    // Called by app.js when a document opens; nothing to persist on the web.
    setCurrent: function (info) {
      // If a recent/blob path is re-opened we may not have the File object; keep name.
      if (info && current && info.path === current.url) current.name = info.name || current.name;
      return Promise.resolve();
    },

    pickFile: function () { return pickViaInput(); },

    getLaunchFile: function () { return Promise.resolve(null); },

    shareFile: function () {
      if (!current) return Promise.reject(new Error('no current file'));
      // Prefer Web Share with the actual file (Android Chrome, iOS Safari 15+).
      try {
        if (navigator.canShare && current.file &&
            navigator.canShare({ files: [current.file] })) {
          return navigator.share({ files: [current.file], title: current.name });
        }
      } catch (e) {}
      // Fallback: trigger a download so the user can hand it off manually.
      downloadCurrent();
      return Promise.resolve();
    },

    openExternally: function () {
      // Browsers cannot launch another native app with a blob; offer a download.
      downloadCurrent();
      return Promise.resolve();
    },

    addListener: function (event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
      return { remove: function () {} };
    },
  };

  // Expose the same globals app.js looks for, so no app.js changes are needed.
  // On the web we OVERRIDE JVRegisterPlugin/JVCapacitor unconditionally: the vendor
  // bundle sets them to Capacitor's core, whose registerPlugin('FileBridge') returns a
  // proxy that throws "not implemented on web". We replace it with our real shim so
  // app.js's `registerPlugin('FileBridge')` resolves to the working web implementation.
  window.FileBridge = FileBridge;
  window.JVRegisterPlugin = function (name) {
    return name === 'FileBridge' ? FileBridge : {};
  };
  // Minimal Capacitor stub: no convertFileSrc → fetchBytes uses file.path (blob URL) directly.
  window.JVCapacitor = {
    isNativePlatform: function () { return false; },
    // No convertFileSrc: app.js falls back to fetching file.path (our blob: URL).
    Plugins: { FileBridge: FileBridge, App: { addListener: function () { return { remove: function () {} }; }, exitApp: function () {} } },
  };
  // App plugin (hardware back button) — harmless no-op on web; browser back still works.
  window.JVApp = window.JVCapacitor.Plugins.App;

  // --- PWA: register the service worker for offline / installability ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  // --- adjust landing copy for the web (the default text is Android-app specific) ---
  function tuneLandingCopy() {
    var sub = document.querySelector('#landing .sub');
    if (sub) {
      sub.innerHTML =
        'PDF · 한글(HWP) · Word · Excel · PPT · 이미지<br>무엇이든 이 웹앱 하나로 바로 열어요.<br><br>' +
        '＋ 또는 <b>파일 열기</b>를 눌러<br>휴대폰·클라우드의 파일을 선택하세요.';
    }
    // iOS Safari has no automatic install prompt — show the manual "add to home" tip.
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (isIOS && !standalone) {
      var landing = document.getElementById('landing');
      if (landing && !document.getElementById('ios-install-tip')) {
        var tip = document.createElement('div');
        tip.id = 'ios-install-tip';
        tip.className = 'sub';
        tip.style.marginTop = '18px';
        tip.style.opacity = '0.75';
        tip.style.fontSize = '13px';
        tip.innerHTML = '📲 홈 화면에 앱으로 추가: Safari 하단 <b>공유</b> → <b>홈 화면에 추가</b>';
        landing.appendChild(tip);
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tuneLandingCopy);
  } else {
    tuneLandingCopy();
  }
})();

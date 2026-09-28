/* Phone version, loaded before js/main.js.
 * - starts worker.js (the Python "server" running in the browser) and sends every fetch('/api/...') of the page
 *   there, so the page's own code stays exactly as on the desktop
 * - start-up screen while Python loads, service worker (offline, home screen), iOS keyboard, backup buttons */
(function () {
  'use strict';
  const worker = new Worker('worker.js', { type: 'module' });
  let seq = 0;
  const waiting = new Map();
  let ready = false, bootError = '';
  const readyWaiters = [];

  worker.onmessage = e => {
    const m = e.data || {};
    if (m.type === 'ready') { ready = true; readyWaiters.splice(0).forEach(f => f()); hideSplash(); return; }
    if (m.type === 'boot-error') { bootError = m.error; readyWaiters.splice(0).forEach(f => f()); showBootError(m.error); return; }
    const w = waiting.get(m.id);
    if (w) { waiting.delete(m.id); w(m); }
  };
  worker.onerror = e => { bootError = (e && e.message) || 'worker error'; showBootError(bootError); readyWaiters.splice(0).forEach(f => f()); };

  function call(msg, transfer) {
    return new Promise(res => { const id = ++seq; waiting.set(id, res); worker.postMessage({ ...msg, id }, transfer || []); });
  }
  const whenReady = () => (ready || bootError ? Promise.resolve() : new Promise(r => readyWaiters.push(r)));
  window.__mobile = { call, whenReady };

  /* ---------- fetch('/api/...') -> worker ---------- */
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return realFetch(input, init); }
    const i = url.pathname.indexOf('/api/');
    if (url.origin !== location.origin || i < 0) return realFetch(input, init);
    const path = url.pathname.slice(i);
    const qs = {};
    url.searchParams.forEach((v, k) => { if (!(k in qs)) qs[k] = v; });
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const signal = init.signal;
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      if (signal) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      whenReady().then(() => {
        if (bootError) { resolve(json(503, { error: bootError })); return; }
        return call({ type: 'api', method, path, qs, body: typeof init.body === 'string' ? init.body : '', ui: headers.get('X-UI-Lang') || '' })
          .then(r => resolve(json(r.status || 500, r.body || {})));
      }).catch(reject);
    });
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  /* ---------- start-up screen ---------- */
  const T = {
    zh: { loading: '正在启动…', first: '第一次打开要下载约 13 MB，之后就快了。', fail: '启动失败：', retry: '重新加载',
      bkH: '备份（这台手机上的练习记录）', bkExport: '导出备份', bkImport: '导入备份…',
      bkHint: '导出的文件可以存到「文件」App。导入会替换这台手机上的全部记录（旧的会先自动备份）；也可以导入电脑上的 data/german.db。',
      bkDone: '已导入：{n} 个会话。页面马上重新加载。', bkFail: '没有成功：', bkConfirm: '导入会替换这台手机上现在的全部练习记录，确定吗？' },
    en: { loading: 'Starting…', first: 'The first start downloads about 13 MB; after that it is quick.', fail: 'Could not start: ', retry: 'Reload',
      bkH: 'Backup (practice history on this phone)', bkExport: 'Export backup', bkImport: 'Import backup…',
      bkHint: 'Save the exported file in the Files app. Importing replaces everything on this phone (the old data is backed up first); german.db from the computer works too.',
      bkDone: 'Imported: {n} sessions. The page reloads now.', bkFail: 'Did not work: ', bkConfirm: 'Importing replaces all practice history on this phone. Continue?' },
    de: { loading: 'Wird gestartet…', first: 'Beim ersten Start werden etwa 13 MB geladen, danach geht es schnell.', fail: 'Start fehlgeschlagen: ', retry: 'Neu laden',
      bkH: 'Sicherung (Übungsverlauf auf diesem Handy)', bkExport: 'Sicherung exportieren', bkImport: 'Sicherung importieren…',
      bkHint: 'Die exportierte Datei in der Dateien-App sichern. Importieren ersetzt alles auf diesem Handy (das Alte wird vorher gesichert); german.db vom Computer geht auch.',
      bkDone: 'Importiert: {n} Sitzungen. Die Seite lädt neu.', bkFail: 'Hat nicht geklappt: ', bkConfirm: 'Importieren ersetzt den ganzen Übungsverlauf auf diesem Handy. Fortfahren?' },
  };
  const lang = () => {
    const l = (document.documentElement.lang || navigator.language || 'zh').slice(0, 2).toLowerCase();
    return T[l] ? l : 'zh';
  };
  const tr = (k, v) => (T[lang()][k] || T.zh[k]).replace(/\{(\w+)\}/g, (_, x) => (v && x in v ? v[x] : ''));

  let splash = null, splashTimer = null;
  function showSplash() {
    splash = document.createElement('div');
    splash.className = 'm-splash';
    splash.innerHTML = '<div class="m-box"><div class="logo">Ä</div><b>Schreibwerkstatt</b><p class="m-l"></p><p class="m-s"></p></div>';
    splash.querySelector('.m-l').textContent = tr('loading');
    document.body.appendChild(splash);
    splashTimer = setTimeout(() => { if (splash) splash.querySelector('.m-s').textContent = tr('first'); }, 2500);
  }
  function hideSplash() { clearTimeout(splashTimer); if (splash) { splash.remove(); splash = null; } }
  function showBootError(msg) {
    if (!splash) showSplash();
    clearTimeout(splashTimer);
    splash.querySelector('.m-l').textContent = tr('fail') + msg;
    const s = splash.querySelector('.m-s'); s.textContent = '';
    const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = tr('retry'); b.onclick = () => location.reload();
    s.appendChild(b);
  }

  /* ---------- iOS: keep the input above the keyboard ---------- */
  const vv = window.visualViewport;
  let fullH = 0;                                   // tallest visible height seen = screen without keyboard
  function fitViewport() {
    if (!vv) return;
    const h = Math.round(vv.height), root = document.documentElement;
    root.style.setProperty('--vvh', h + 'px');
    fullH = Math.max(fullH, h);
    const kb = h < fullH - 150;                    // keyboard open: hide the toolbars, give the space to the conversation
    if (kb !== root.classList.contains('kb')) {
      root.classList.toggle('kb', kb);
      requestAnimationFrame(() => {
        const a = document.activeElement, stream = document.getElementById('stream');
        if (a && stream && stream.contains(a)) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        else if (stream) stream.scrollTo({ top: stream.scrollHeight, behavior: 'instant' });
      });
    }
    if (document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) window.scrollTo(0, 0);
  }
  window.addEventListener('orientationchange', () => { fullH = 0; setTimeout(fitViewport, 400); });
  if (vv) vv.addEventListener('resize', fitViewport);

  /* ---------- backup buttons in the settings dialog ---------- */
  function addBackup() {
    const form = document.getElementById('dlgForm');
    if (!form || document.getElementById('mBackup')) return;
    const box = document.createElement('div');
    box.className = 'field m-backup'; box.id = 'mBackup';
    box.innerHTML = '<label></label><div class="keyrow"><button class="btn sm" type="button" data-a="export"></button>' +
      '<button class="btn sm" type="button" data-a="import"></button><input type="file" hidden accept=".db,.sqlite,application/octet-stream,application/x-sqlite3"></div><small></small>';
    const msgs = document.getElementById('cfgMsg');
    form.insertBefore(box, msgs);
    const file = box.querySelector('input[type=file]');
    const label = () => {
      box.querySelector('label').textContent = tr('bkH');
      box.querySelector('[data-a=export]').textContent = tr('bkExport');
      box.querySelector('[data-a=import]').textContent = tr('bkImport');
      box.querySelector('small').textContent = tr('bkHint');
    };
    label();
    document.getElementById('dlg').addEventListener('toggle', label);
    new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    const say = t => { box.querySelector('small').textContent = t; };
    box.querySelector('[data-a=export]').onclick = async () => {
      const r = await call({ type: 'export' });
      if (!r.ok) { say(tr('bkFail') + r.error); return; }
      const d = new Date(), p = n => String(n).padStart(2, '0');
      const name = `schreibwerkstatt-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.db`;
      const f = new File([r.bytes], name, { type: 'application/octet-stream' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    };
    box.querySelector('[data-a=import]').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f || !confirm(tr('bkConfirm'))) return;
      const buf = await f.arrayBuffer();
      const r = await call({ type: 'import', bytes: buf }, [buf]);
      if (!r.ok) { say(tr('bkFail') + r.error); return; }
      say(tr('bkDone', { n: r.sessions }));
      setTimeout(() => location.reload(), 1200);
    };
  }

  function onReady() {
    showSplash();
    if (ready || bootError) { if (ready) hideSplash(); else showBootError(bootError); }
    const inp = document.getElementById('input');
    if (inp) inp.setAttribute('enterkeyhint', 'send');
    const prov = document.getElementById('cfgProvider');           // no Ollama on a phone
    const ol = prov && prov.querySelector('option[value=ollama]');
    if (ol) ol.remove();
    addBackup();
    fitViewport();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();

  /* save right away when the app goes to the background (iOS may close it without warning) */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') call({ type: 'flush' }); });

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && window.isSecureContext && !/[?&]nosw\b/.test(location.search))
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

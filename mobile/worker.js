/* Phone version: the "server" runs here, in a background thread of the page.
 * Pyodide (Python compiled for the browser) runs the desktop server.py unchanged (see py/mobile_glue.py).
 * The data folder /data (german.db, settings.json with the API key, logs) is kept in the browser's IndexedDB. */
import { loadPyodide } from './pyodide/pyodide.mjs';

let py = null, handle = null;
const syncfs = populate => new Promise((res, rej) => py.FS.syncfs(populate, e => (e ? rej(e) : res())));

const boot = (async () => {
  py = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href });
  py.FS.mkdirTree('/data');
  py.FS.mount(py.FS.filesystems.IDBFS, {}, '/data');
  await syncfs(true);                                         // IndexedDB -> /data
  py.FS.mkdirTree('/app');
  const files = await (await fetch('py/files.json', { cache: 'no-cache' })).json();
  await Promise.all(files.map(async f => {
    const r = await fetch('py/' + f);
    if (!r.ok) throw new Error('py/' + f + ': HTTP ' + r.status);
    py.FS.writeFile('/app/' + f, new Uint8Array(await r.arrayBuffer()));
  }));
  py.runPython('import sys; sys.path.insert(0, "/app"); import mobile_glue');
  const glue = py.pyimport('mobile_glue');
  handle = glue.handle;
  self.glue = glue;
  await persist();
})();

/* /data -> IndexedDB after every change; calls that arrive while one is running are merged into one more run */
let saving = null, again = false;
function persist() {
  if (saving) { again = true; return saving; }
  saving = (async () => {
    try { do { again = false; await syncfs(false); } while (again); }
    finally { saving = null; }
  })();
  return saving;
}

async function netFetch(r) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (r.timeout || 180) * 1000);
  try {
    const resp = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body ?? undefined, signal: ctl.signal });
    return { status: resp.status, text: await resp.text() };
  } catch (e) {
    if (e && e.name === 'AbortError') return { error: 'timeout' };
    const offline = self.navigator && self.navigator.onLine === false;
    return { error: 'network', msg: offline ? 'offline' : (e && e.message) || 'network error' };
  } finally { clearTimeout(timer); }
}

async function api({ method, path, qs, body, ui }) {
  const answers = [];
  for (let round = 0; round < 16; round++) {
    const out = JSON.parse(handle(method, path, JSON.stringify(qs || {}), body || '', ui || 'zh', JSON.stringify(answers)));
    if (out && out.need) { answers.push(await netFetch(out.need)); continue; }
    if (method !== 'GET') await persist();
    return { status: out[0], body: out[1] };
  }
  return { status: 500, body: { error: 'too many network requests for one call' } };
}

self.onmessage = async e => {
  const m = e.data || {};
  try {
    await boot;
    if (m.type === 'api') {
      postMessage({ id: m.id, ...(await api(m)) });
    } else if (m.type === 'export') {
      await saving;
      const bytes = py.FS.readFile('/data/german.db');
      postMessage({ id: m.id, ok: true, bytes }, [bytes.buffer]);
    } else if (m.type === 'import') {
      const b = new Uint8Array(m.bytes);
      const head = new TextDecoder().decode(b.slice(0, 15));
      if (head !== 'SQLite format 3') throw new Error('not a SQLite database file');
      py.FS.writeFile('/data/import.tmp', b);
      let n;
      try { n = self.glue.import_db('/data/import.tmp'); }
      finally { try { py.FS.unlink('/data/import.tmp'); } catch { /* already moved */ } }
      await persist();
      postMessage({ id: m.id, ok: true, sessions: n });
    } else if (m.type === 'flush') {
      await persist();
      postMessage({ id: m.id, ok: true });
    } else if (m.type === 'ping') {
      postMessage({ id: m.id, ok: true });
    }
  } catch (err) {
    const msg = String((err && err.message) || err);
    postMessage({ id: m.id, status: 500, body: { error: msg }, ok: false, error: msg });
  }
};

boot.then(() => postMessage({ type: 'ready' }), err => postMessage({ type: 'boot-error', error: String((err && err.message) || err) }));

/* Connection test, status button and the settings dialog */
import { $, h } from './dom.js';
import { LANG, LANGS, LEARN_LANGS, LEVEL_LIST, t } from './i18n.js';
import { CFG, MIRROR_KEY, OLD_KEY, PRESETS, SET, applySettings, mirror, syncCfg } from './config.js';
import { conn } from './llm.js';
import { applySeeds } from './mock.js';
import { state } from './state.js';
import { db, updateDbNote } from './db.js';
import { renderHistory } from './history.js';

/* =====================================================================
 * 连接检测与设置界面
 * ===================================================================== */
export let connSeq = 0;
export async function connect() {
  const my = ++connSeq;
  if (CFG.source === 'mock') {
    Object.assign(conn, { mode: 'mock', models: [], short: '', label: '', code: '', note: t('mockNote') });
    updateStatus(); return;
  }
  let r;
  if (!db.available) r = { ok: false, short: t('noServerShort'), models: [], note: t('noServerNote') };
  else {
    try { r = await db.req('POST', '/llm/test', {}); }
    catch (e) { r = { ok: false, short: t('noServerShort'), models: [], note: t('noServerNet', { e: e.message }) }; }
  }
  if (my !== connSeq) return;                                   // 期间又发起了新的检测，以最新的为准
  Object.assign(conn, { mode: r.ok ? 'online' : 'offline', models: r.models || [], note: r.note || '', short: r.short || '', code: r.code || '', label: r.label || SET.labels[CFG.provider] });
  updateStatus();
}
export function updateStatus() {
  const b = $('#status'), bn = $('#banner'); let cls = 'mock', txt = t('statusMock'), banner = '', bcls = 'banner';
  if (conn.mode === 'online') {
    cls = conn.note ? 'warn' : 'ok'; txt = `${conn.label} · ${CFG.model}`;
  } else if (conn.mode === 'offline') {
    cls = 'off'; txt = conn.short || t('notConnected');
    banner = t('bannerOff', { s: conn.short || t('notConnected') }); bcls = 'banner off';
  } else banner = t('bannerMock');
  b.className = 'status ' + cls; $('span', b).textContent = txt;
  b.title = (conn.note ? conn.note + '\n' : '') + t('clickSettings');
  bn.hidden = !banner; bn.textContent = banner; bn.className = bcls;
  $('#modelList').replaceChildren(...conn.models.slice(0, 300).map(m => h('option', { value: m })));
}

/* ---------- 设置读写（服务器上的 settings.json） ---------- */
export function readOldCfg() {                        // 旧版本把设置放在浏览器里，第一次连上服务器时搬过去
  try {
    const o = JSON.parse(localStorage.getItem(OLD_KEY)); if (!o || typeof o !== 'object') return null;
    const pick = k => typeof o[k] === 'string' && o[k].trim() ? o[k].trim() : undefined;
    return { source: o.source === 'mock' ? 'mock' : 'auto', profile: { provider: 'ollama', base: pick('base'), model: pick('model'), think: pick('think') } };
  } catch { return null; }
}
export async function loadSettings() {
  if (db.available) {
    try {
      let x = await db.req('GET', '/settings');
      if (x.fresh) {
        const old = readOldCfg();
        if (old) { for (const k of Object.keys(old.profile)) if (old.profile[k] === undefined) delete old.profile[k]; x = await db.req('PUT', '/settings', old); }
      }
      try { localStorage.removeItem(OLD_KEY); } catch { /* 忽略 */ }
      applySettings(x);
    } catch (e) { console.warn('读取设置失败：', e); }
  } else {
    try {
      const m = JSON.parse(localStorage.getItem(MIRROR_KEY));
      if (m && (m.source === 'mock' || m.source === 'auto')) SET.source = m.source;
      if (m && m.lang && LEARN_LANGS.includes(m.lang.learn)) LANG.learn = m.lang.learn;
      if (m && m.lang && LANGS.includes(m.lang.explain)) LANG.explain = m.lang.explain;
      if (m && m.lang && LEVEL_LIST.includes(m.lang.level)) LANG.level = m.lang.level;
    } catch { /* 忽略 */ }
  }
  syncCfg();
}
export async function pushSettings(body) {
  if (!db.available) {
    if (body.source) SET.source = body.source; if (body.topic_dedupe) SET.topicDedupe = body.topic_dedupe;
    if (body.learn_lang) LANG.learn = body.learn_lang; if (body.explain_lang) LANG.explain = body.explain_lang; if (body.level) LANG.level = body.level;
    syncCfg(); mirror(); return;
  }
  applySettings(await db.req('PUT', '/settings', body));
}

/* ---------- 设置窗口：改动 0.8 秒后自动保存并重新检测连接，不需要点保存 ---------- */
export const dlg = $('#dlg');
export const HINTS = {                     // 界面文字的 key
  ollama: { base: 'hOllamaBase', hb: 'hOllamaHb', hm: 'hOllamaHm', think: 'hOllamaThink' },
  openai: { base: 'hOpenaiBase', hb: 'hOpenaiHb', hm: 'hOpenaiHm', think: 'hOpenaiThink' },
  anthropic: { base: 'hAnthBase', hb: 'hAnthHb', hm: 'hAnthHm', think: '' },
  deepseek: { base: 'hDsBase', hb: 'hDsHb', hm: 'hDsHm', think: 'hDsThink' },
};
export let formProvider = 'ollama', saveTimer = null, saving = Promise.resolve();
export const setMsg = t => { $('#cfgMsg').textContent = t; };
export const matchPreset = base => { const b = base.trim().replace(/\/+$/, ''); const m = PRESETS.find(p => p[2] && p[2] === b); return m ? m[0] : 'custom'; };

export function fillForm() {
  const name = formProvider = SET.active, p = SET.profiles[name], hk = HINTS[name];
  $('#cfgProvider').value = name;
  $('#cfgPreset').value = p.preset || matchPreset(p.base);
  $('#cfgBase').value = p.base; $('#cfgModel').value = p.model; $('#cfgThink').value = p.think; $('#cfgSource').value = SET.source; $('#cfgDedupe').value = SET.topicDedupe;
  $('#lblBase').textContent = t(hk.base); $('#hintBase').textContent = t(hk.hb); $('#hintModel').textContent = t(hk.hm); $('#lblThink').textContent = hk.think ? t(hk.think) : '';
  $('#fPreset').hidden = name !== 'openai'; $('#fKey').hidden = name === 'ollama'; $('#fThink').hidden = name === 'anthropic';
  $('#cfgModel').placeholder = name === 'ollama' ? 'gpt-oss:20b' : name === 'deepseek' ? 'deepseek-flash' : t('modelPh');
  const ds = name === 'deepseek', opt = v => $(`#cfgThink option[value="${v}"]`);     // DeepSeek：off = 关闭思考（它默认是开的）
  opt('off').textContent = t(ds ? 'thinkOffDs' : 'thinkOff'); opt('low').textContent = t(ds ? 'thinkLowDs' : 'thinkLow');
  $('#cfgThink').closest('.field').querySelector('small').textContent = t(ds ? 'thinkHintDs' : 'thinkHint');
  fillKey(); $('#dlgNoServer').hidden = db.available;
}
export function fillKey() {
  const p = SET.profiles[formProvider];
  $('#cfgKey').value = ''; $('#cfgKey').placeholder = p.has_key ? t('keySaved') : t('keyPaste');
  $('#btnClearKey').disabled = !p.has_key;
}
export function openSettings() {
  fillForm();
  setMsg(conn.mode === 'online' ? (conn.note || t('connectedDot')) : (conn.mode === 'offline' ? conn.note : ''));
  if (!dlg.open) dlg.showModal();
}
export function scheduleSave() { clearTimeout(saveTimer); setMsg('…'); saveTimer = setTimeout(commitForm, 800); }
export function commitForm() {
  clearTimeout(saveTimer); saveTimer = null;
  saving = saving.then(doCommit).catch(e => setMsg(t('saveFailed') + e.message));
  return saving;
}
export async function doCommit() {
  const name = formProvider;
  const prof = { provider: name, base: $('#cfgBase').value.trim(), model: $('#cfgModel').value.trim() };
  if (name !== 'anthropic') prof.think = $('#cfgThink').value;
  if (name === 'openai') prof.preset = $('#cfgPreset').value;
  const key = $('#cfgKey').value.trim(); if (key && name !== 'ollama') prof.api_key = key;
  setMsg(t('savingTesting'));
  await pushSettings({ active: name, source: $('#cfgSource').value, topic_dedupe: $('#cfgDedupe').value, profile: prof });
  if (formProvider === name) { if (!$('#cfgBase').value.trim()) $('#cfgBase').value = SET.profiles[name].base; fillKey(); }
  await afterSettingsChanged();
}
export async function afterSettingsChanged() {
  await connect();
  if (conn.mode === 'online') {
    const list = conn.models.length ? '\n' + t('modelsAvail', { n: conn.models.length }) + conn.models.slice(0, 12).join(t('listSep')) + (conn.models.length > 12 ? ' …' : '') : '';
    setMsg(t('savedOk') + (conn.note ? '\n' + conn.note : '') + list);
  } else if (conn.mode === 'mock') setMsg(t('savedMock'));
  else setMsg((conn.code === 'no_model' || conn.code === 'no_key' ? t('savedNotReady') : t('savedNoConn')) + '\n' + conn.note);
  applySeeds(); updateDbNote();
  if (state.view === 'history') renderHistory();
}
export async function switchProvider(name) {
  await commitForm();                          // 先把旧接口的改动存好
  await pushSettings({ active: name });
  fillForm(); setMsg(t('testing'));
  await afterSettingsChanged();
}



/* Wiring that ran when the page loaded (event listeners …); called once by main.js */
export function init_settings() {
  for (const id of ['cfgBase', 'cfgModel', 'cfgKey']) $('#' + id).addEventListener('input', scheduleSave);
  for (const id of ['cfgThink', 'cfgSource', 'cfgDedupe']) $('#' + id).addEventListener('change', scheduleSave);
  $('#cfgPreset').addEventListener('change', e => { const p = PRESETS.find(x => x[0] === e.target.value); if (p && p[2]) $('#cfgBase').value = p[2]; scheduleSave(); });
  $('#cfgBase').addEventListener('input', () => { $('#cfgPreset').value = matchPreset($('#cfgBase').value); });
  $('#cfgProvider').addEventListener('change', e => switchProvider(e.target.value));
  $('#btnClearKey').addEventListener('click', async () => {
    await commitForm();
    await pushSettings({ profile: { provider: formProvider, api_key: '' } }); fillKey();
    await afterSettingsChanged();
  });
  $('#btnTest').addEventListener('click', () => commitForm());
  $('#btnClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (saveTimer) commitForm(); });
}

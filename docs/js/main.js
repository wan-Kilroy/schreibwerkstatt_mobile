/* Start-up: event wiring, switching languages, finishing sessions left open, window.__sw for tests */
import { $, toast } from './dom.js';
import { LANG, applyStaticText, lname, same, t } from './i18n.js';
import { CFG, SET, init_config } from './config.js';
import { diffTokens } from './diff.js';
import { conn } from './llm.js';
import { srcLangOk } from './exercises.js';
import { regroupWords, segmentPlain, splitSyllables } from './zh.js';
import { llmApi } from './api.js';
import { applySeeds } from './mock.js';
import { detectIntent } from './intent.js';
import { connect, init_settings, loadSettings, openSettings, pushSettings, updateStatus } from './settings.js';
import { state } from './state.js';
import { PAGE_VERSION, db, updateDbNote } from './db.js';
import { aiOpen, autosize, endCurrentSession, giveUp, input, newPrompt, newSession, promptQueue, resetStream, send, skipPrompt, syncPending } from './practice.js';
import { deleteOpenSession, renderDetail, renderHistory, startup } from './history.js';
import { init_stats, refreshSums } from './stats.js';

init_config();
init_settings();
init_stats();

/* ---------- 标签切换 ---------- */
export function show(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === view));
  if (view === 'history') { renderHistory(); refreshSums(); } else input.focus();
}

/* =====================================================================
 * 事件与初始化
 * ===================================================================== */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
$('#btnPrompt').addEventListener('click', () => newPrompt());
$('#btnOpen').addEventListener('click', () => aiOpen());
$('#btnNew').addEventListener('click', () => newSession());
$('#btnSkip').addEventListener('click', () => skipPrompt());
$('#btnGiveUp').addEventListener('click', () => giveUp());
$('#btnSend').addEventListener('click', () => send());
$('#btnBack').addEventListener('click', () => { state.openId = null; renderHistory(); });
export let qTimer; $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(renderHistory, 200); });
$('#histLang').addEventListener('change', () => { renderHistory(); refreshSums(); });

/* ---------- 切换学习语言 / 讲解语言 / 水平 ---------- */
/* 换语言：当前会话（如果已经练了几句）结束，下一句开始新会话；只换水平：会话继续，只是之后出的题按新水平 */
export async function setLanguages(next) {
  const before = { ...LANG };
  Object.assign(LANG, next);
  const langChanged = LANG.learn !== before.learn || LANG.explain !== before.explain;
  try { await pushSettings({ learn_lang: LANG.learn, explain_lang: LANG.explain, level: LANG.level }); }
  catch (e) { toast(t('saveFailed') + e.message); }
  promptQueue.items = [];                                   // 按旧语言 / 旧水平出的题作废
  if (langChanged) {
    if (LANG.learn !== before.learn) $('#histLang').value = LANG.learn;   // 历史和统计也跟着换到新的学习语言
    const ended = !state.busy && endCurrentSession();
    if (!ended) { Object.assign(state.session, { lang: LANG.learn, explainLang: LANG.explain, level: LANG.level }); state.pending = null; syncPending(); resetStream(); }
    applyStaticText(); updateStatus(); updateDbNote();
    if (LANG.explain !== before.explain) connect();          // 服务器返回的连接提示也换成新的界面语言
    if (same()) toast(t('langSame', { L: lname(LANG.learn) }));
    else if (ended) toast(t('langSwitched', { L: lname(LANG.learn), E: lname(LANG.explain) }));
    if (state.view === 'history') { renderHistory(); refreshSums(); }
  } else {
    state.session.level = LANG.level;
    if (state.session.dbId) db.updateSession(state.session, { level: LANG.level });
  }
}
$('#selLearn').addEventListener('change', e => setLanguages({ learn: e.target.value }));
$('#selExplain').addEventListener('change', e => setLanguages({ explain: e.target.value }));
$('#selLevel').addEventListener('change', e => setLanguages({ level: e.target.value }));
$('#btnDel').addEventListener('click', deleteOpenSession);
$('#status').addEventListener('click', openSettings);
input.addEventListener('input', autosize);
/* 焦点不在任何输入框、按钮上（比如点了一下页面空白处）时按 Enter，也按流程走下一步 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented || state.view !== 'practice') return;
  if (e.target.closest && e.target.closest('input, textarea, select, button, a, dialog, [contenteditable]')) return;
  e.preventDefault(); send();
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }   // 中文输入法选词时的回车不发送
});

/* 上次没正常结束的会话（关掉页面、断电等）：补上结束时间，并让模型补生成标题和总结 */
export async function finalizeStale() {
  const redraw = id => {                                   // 历史页开着就刷新一下，让“生成中”变成真正的标题
    if (state.view !== 'history') return;
    if (state.openId == null) renderHistory(); else if (id != null && state.openId === id) renderDetail();
  };
  try {
    let r; try { r = await db.closeStale(); } catch { return; }
    if (conn.mode === 'online') {
      const ids = r.need_summary.slice(0, 5);
      ids.forEach(id => startup.ids.add(id));
      redraw();
      for (const id of ids) {
        try {
          const out = await llmApi.summarize(await db.get(id));
          await db.req('PATCH', '/sessions/' + id, { title: out.title, summary: out.summary });
        } catch { break; }                                 // 模型没准备好就下次再补
        finally { startup.ids.delete(id); }
        redraw(id);
      }
    }
  } finally { startup.pending = false; startup.ids.clear(); redraw(); }
}

applyStaticText();
resetStream();
(async () => {
  await db.check();
  await loadSettings();                          // 设置在服务器上，要先连上服务器（里面也有上次选的语言）
  Object.assign(state.session, { lang: LANG.learn, explainLang: LANG.explain, level: LANG.level });
  $('#histLang').value = LANG.learn;             // 历史和统计默认只看正在学的语言
  applyStaticText(); resetStream();
  await connect();
  applySeeds(); updateDbNote();
  if (!db.available && CFG.source !== 'mock') toast(t('toastNoServer'));
  else if (db.available && db.version !== PAGE_VERSION) toast(t('oldServer'), 8000);
  else if (conn.mode === 'offline') toast(t('toastNoModel', { s: conn.short || t('notConnected') }));
  else if (conn.note) toast(conn.note);
  if (db.enabled) await finalizeStale(); else startup.pending = false;
})();
window.__sw = { state, db, conn, SET, CFG, LANG, detectIntent, srcLangOk, regroupWords, segmentPlain, splitSyllables, diffTokens };   // 仅供调试 / tests 文件夹里的自动测试
input.focus();

/* History page: list, search, language filter, session detail, delete */
import { $, h, toast } from './dom.js';
import { fmtDate, lname, pl, t } from './i18n.js';
import { countKinds } from './mock.js';
import { newSessionObj, state } from './state.js';
import { db } from './db.js';
import { renderMessage } from './feedback.js';
import { busySessions, resetStream, syncPending } from './practice.js';
import { renderStats } from './stats.js';

/* ---------- 历史页 ---------- */
export const chipsFor = s => {
  const c = countKinds(s), out = [];
  out.push(h('span', { class: 'chip', text: t('langChip', { L: lname(s.lang || 'de'), E: lname(s.explainLang || 'zh') }) }));
  if (c.translate) out.push(h('span', { class: 'chip', text: t('chipTr', { n: c.translate }) }));
  if (c.chat) out.push(h('span', { class: 'chip', text: t('chipChat', { n: c.chat }) }));
  if (c.ask) out.push(h('span', { class: 'chip', text: t('chipAsk', { n: c.ask }) }));
  return out;
};
export const startup = { pending: true, ids: new Set() };   // 刚打开页面：上次没正常结束的会话正在补生成标题和总结
export const isSummarizing = s => [...busySessions].some(x => (x.dbId || x.id) === s.id) || startup.ids.has(s.id) || (startup.pending && !s.live && !s.title);
export const gen = label => h('span', { class: 'gen' }, label, h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i', { text: '.' }), h('i', { text: '.' }), h('i', { text: '.' })));   // “生成中…”，省略号会动
export const titleNode = s => (!s.live && !s.title && isSummarizing(s)) ? gen(t('titleGen')) : sTitle(s);
export const summaryNode = s => (!s.live && !s.summary && isSummarizing(s)) ? gen(t('summaryGen')) : sSummary(s);
export const sTitle = s => s.live ? t('liveSession') : (s.title || (isSummarizing(s) ? t('titleGen') : t('untitled')));
export const sSummary = s => s.live ? t('liveSummary') : (s.summary || (isSummarizing(s) ? t('summaryGen') : ''));
export function snippetNode(text, q) {
  if (!q || !text) return null;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return h('div', { class: 'snippet', text: text.slice(0, 48) + (text.length > 48 ? '…' : '') });
  const a = Math.max(0, i - 14), b = Math.min(text.length, i + q.length + 24);
  return h('div', { class: 'snippet' }, (a ? '…' : ''), text.slice(a, i), h('em', { text: text.slice(i, i + q.length) }), text.slice(i + q.length, b), (b < text.length ? '…' : ''));
}
/* 没有数据库时（模拟模式 / 没用 run.bat 启动）：在页面内存里找 */
export function findMatch(s, q) {
  const lq = q.toLowerCase();
  for (const m of s.messages) for (const f of [m.content, m.corrected, m.better]) if (f && f.toLowerCase().includes(lq)) return f;
  return null;
}
export function localRows(q, lang) {
  const lq = q.toLowerCase();
  const all = [...(state.session.messages.length ? [state.session] : []), ...state.history].filter(s => !lang || s.lang === lang);
  return all.map(s => ({ id: s.id, live: s === state.session, title: s.title, summary: s.summary, createdAt: s.createdAt, endedAt: s.endedAt, counts: countKinds(s), match: q ? findMatch(s, q) : null, lang: s.lang, explainLang: s.explainLang }))
    .filter(r => !q || r.match || [sTitle(r), sSummary(r)].some(x => x.toLowerCase().includes(lq)));
}
export function localDetail(id) {
  const s = [state.session, ...state.history].find(x => x.id === id);
  return s && { id: s.id, live: s === state.session, title: s.title, summary: s.summary, createdAt: s.createdAt, endedAt: s.endedAt, messages: s.messages, lang: s.lang, explainLang: s.explainLang };
}

export let histReq = 0;                               // 只认最后一次请求的结果，避免快速输入搜索词时旧结果覆盖新结果
export async function renderHistory() {
  const detail = state.openId != null, st = !detail && state.statsOpen && db.enabled;
  $('#histList').style.display = detail || st ? 'none' : 'flex';
  $('#histDetail').style.display = detail ? 'flex' : 'none';
  $('#histStats').style.display = st ? 'flex' : 'none';
  if (detail) return renderDetail();
  if (st) return renderStats();

  const q = $('#q').value.trim(), lang = $('#histLang').value, my = ++histReq;
  let rows;
  try { rows = db.enabled ? await db.list(q, lang) : localRows(q, lang); }
  catch (e) { if (my === histReq) $('#histCards').replaceChildren(h('div', { class: 'none', text: t('histFail') + e.message })); return; }
  if (my !== histReq) return;
  $('#histCount').textContent = t(q ? 'found' : 'total', { n: rows.length, sessN: pl(rows.length, 'sessN') });
  const box = $('#histCards'); box.replaceChildren();
  if (!rows.length) { box.append(h('div', { class: 'none', text: t(q ? 'noMatch' : 'noHistory') })); return; }
  rows.forEach(r => {
    box.append(h('button', { class: 'card', type: 'button', onclick: () => { state.openId = r.id; renderHistory(); } },
      h('div', { class: 'card-top' }, h('h3', {}, titleNode(r)), h('time', { text: fmtDate(r.createdAt) })),
      sSummary(r) ? h('p', {}, summaryNode(r)) : null,
      h('div', { class: 'chips' }, r.live ? h('span', { class: 'chip live', text: t('live') }) : null, chipsFor(r)),
      snippetNode(r.match, q)));
  });
}
export async function renderDetail() {
  const my = ++histReq;
  let s = null;
  try { s = db.enabled ? await db.get(state.openId) : localDetail(state.openId); } catch { s = null; }
  if (my !== histReq) return;
  if (!s) { state.openId = null; return renderHistory(); }
  $('#dTitle').replaceChildren(titleNode(s));
  $('#dSummary').replaceChildren(summaryNode(s));
  $('#dMeta').textContent = `${fmtDate(s.createdAt)}${s.endedAt ? ' – ' + fmtDate(s.endedAt) : (s.live ? t('metaLive') : '')} · ${t('msgs', { n: s.messages.length, msgN: pl(s.messages.length, 'msgN') })} · ${t('langChip', { L: lname(s.lang || 'de'), E: lname(s.explainLang || 'zh') })}`;
  const box = $('#dStream'); box.replaceChildren(...s.messages.map(m => renderMessage(m, true, s)));
  $('#histDetail .hist-scroll').scrollTop = 0;
}
export async function deleteOpenSession() {
  const btn = $('#btnDel');
  if (!btn.dataset.armed) {                    // 第一次点：变成"再点一次确认"，3 秒内再点才真的删
    btn.dataset.armed = '1'; btn.textContent = t('delConfirm');
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = t('delSession'); }, 3000);
    return;
  }
  delete btn.dataset.armed; btn.textContent = t('delSession');
  const id = state.openId;
  try {
    let wasLive;
    if (db.enabled) { await db.remove(id); wasLive = id === state.session.dbId; }
    else { state.history = state.history.filter(x => x.id !== id); wasLive = id === state.session.id; }
    if (wasLive) { state.session = newSessionObj(); state.pending = null; syncPending(); resetStream(); }
  } catch (e) { toast(t('delFail') + e.message); return; }
  state.openId = null; renderHistory(); toast(t('deleted'));
}

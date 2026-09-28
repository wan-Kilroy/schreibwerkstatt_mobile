/* Saving sessions and messages through server.py (/api/sessions …) */
import { $, squash, toast, uid } from './dom.js';
import { LANG, t, ui } from './i18n.js';
import { CFG } from './config.js';
import { diffTokens } from './diff.js';
import { state } from './state.js';

/* =====================================================================
 * 数据库（server.py 提供 /api/...，数据在 data/german.db）
 *   - 写入排成一条队列，保证「先建会话、再存消息、再更新纠错结果」的顺序
 *   - 没有后端（比如双击打开页面）或选了模拟模式时，历史只保存在页面内存里
 * ===================================================================== */
export const packMsg = m => {
  const o = { role: m.role, kind: m.kind, content: m.content };
  for (const [k, v] of [['zh', m.zh], ['status', m.status], ['is_correct', m.isCorrect], ['corrected', m.corrected], ['better', m.better],
    ['better_note', m.betterNote], ['meaning', m.meaning], ['brief', m.brief], ['explanation', m.explanation], ['retyped', m.retyped], ['focus', m.focus], ['extra', extraOf(m)], ['errors', m.errors]]) if (v !== undefined) o[k] = v;
  return o;
};
/* 拼音等语言相关的附加信息存在 extra 列（JSON）；没有就不存 */
export const extraOf = m => {
  const x = {};
  if (m.pinyin) x.py = m.pinyin;
  if (m.betterPinyin) x.better_py = m.betterPinyin;
  if (m.words) x.words = m.words;
  if (m.betterWords) x.better_words = m.betterWords;
  if (m.studentWords) x.student_words = m.studentWords;
  if (m.review) x.review = m.review;                  // v0.4：这道题来自复习（reviews 表的 id）
  if (m.reported) x.reported = m.reported;            // v0.6：学生报告过这道题有问题（原因）
  if (m.gaveUp) x.gave_up = true;                     // v0.6：学生点了「我不会」，corrected 是参考译文
  return Object.keys(x).length ? x : undefined;
};
export const analysisFields = m => ({ is_correct: m.isCorrect, corrected: m.corrected, better: m.better, better_note: m.betterNote, meaning: m.meaning, brief: m.brief, errors: m.errors || [], ...(extraOf(m) ? { extra: extraOf(m) } : {}) });
export const hydrate = r => {                       // 数据库行 -> 界面用的消息对象
  const m = { id: uid(), dbId: r.id, role: r.role, kind: r.kind, content: r.content };
  if (r.zh) m.zh = r.zh;
  if (r.status) m.status = r.status;
  if (r.explanation) m.explanation = r.explanation;
  if (r.retyped) m.retyped = r.retyped;
  if (r.focus) m.focus = r.focus;
  if (r.is_correct !== null && r.is_correct !== undefined) {
    m.isCorrect = !!r.is_correct; m.corrected = r.corrected || r.content; m.meaning = r.meaning || 'ok';
    m.brief = r.brief || ''; m.better = r.better || ''; m.betterNote = r.better_note || '';
    m.errors = (r.errors || '').split(',').filter(Boolean);
    m.diff = m.isCorrect ? null : diffTokens(squash(r.content), squash(m.corrected));   // 高亮不存库，读出来时重新对比
  }
  if (r.extra) {
    try {
      const x = JSON.parse(r.extra);
      m.pinyin = x.py || ''; m.betterPinyin = x.better_py || '';
      if (x.words) m.words = x.words;
      if (x.better_words) m.betterWords = x.better_words;
      if (x.student_words) m.studentWords = x.student_words;
      if (x.review) m.review = x.review;
      if (x.reported) m.reported = x.reported;
      if (x.gave_up) m.gaveUp = true;
    } catch { /* 忽略坏数据 */ }
  }
  return m;
};
export const sessionRow = r => ({
  id: r.id, dbId: r.id, live: r.id === state.session.dbId, title: r.title, summary: r.summary,
  createdAt: new Date(r.created_at), endedAt: r.ended_at ? new Date(r.ended_at) : null,
  counts: r.counts || { translate: 0, chat: 0, ask: 0 }, match: r.match || null,
  lang: r.lang || 'de', explainLang: r.explain_lang || 'zh', level: r.level || null,
});
/* 和 server.py 的 VERSION 一致。不一致 = 页面是新的，但黑色窗口里还在跑旧的 server.py（只刷新了页面、没重启 run.bat） */
export const PAGE_VERSION = '0.7';
export const db = {
  available: false,
  path: '',
  warned: false,
  q: Promise.resolve(),
  get enabled() { return this.available && CFG.source !== 'mock'; },     // 模拟模式不写库，免得演示数据混进真实历史
  async req(method, path, body) {
    const headers = { 'X-UI-Lang': ui(), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error === 'unknown endpoint' ? t('oldServer') : (j.error || ('HTTP ' + r.status)));
    return j;
  },
  async check() {
    if (!location.protocol.startsWith('http')) { this.available = false; return; }
    try { const j = await this.req('GET', '/health'); this.available = !!j.ok; this.path = j.db || ''; this.version = j.version || ''; } catch { this.available = false; }
  },
  fail(e) { console.warn('数据库操作失败：', e); if (!this.warned) { this.warned = true; toast(t('saveHistErr') + e.message); } },
  enqueue(fn) { this.q = this.q.then(fn).catch(e => this.fail(e)); return this.q; },
  addMessage(s, m) {
    if (!this.enabled) return;
    return this.enqueue(async () => {
      if (!s.dbId) {
        const r = await this.req('POST', '/sessions', { lang: s.lang, explain_lang: s.explainLang, level: s.level });
        s.dbId = r.id; s.createdAt = new Date(r.created_at);
      }
      m.dbId = (await this.req('POST', `/sessions/${s.dbId}/messages`, packMsg(m))).id;
    });
  },
  updateMessage(m, fields) { if (this.enabled) return this.enqueue(async () => { if (m.dbId) await this.req('PATCH', '/messages/' + m.dbId, fields); }); },
  updateSession(s, fields) { if (this.enabled) return this.enqueue(async () => { if (s.dbId) await this.req('PATCH', '/sessions/' + s.dbId, fields); }); },
  async list(q, lang) { return (await this.req('GET', '/sessions?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '') + (lang ? '&lang=' + lang : ''))).map(sessionRow); },
  async recent(n) { return (await this.req('GET', `/sessions?summarized=1&limit=${n}&lang=${LANG.learn}&explain=${LANG.explain}`)).map(sessionRow); },
  async get(id) { const j = await this.req('GET', '/sessions/' + id); const s = sessionRow(j); s.messages = j.messages.map(hydrate); return s; },
  async remove(id) { await this.q; return this.req('DELETE', '/sessions/' + id); },
  closeStale() { return this.req('POST', '/sessions/close-stale', {}); },
};
export function updateDbNote() {
  const n = $('#dbNote'); let txt, warn = false;
  if (CFG.source === 'mock') txt = t('dbMock');
  else if (!db.available) { txt = t('dbNoServer'); warn = true; }
  else txt = t('dbPath') + (db.path || 'german.db');
  n.textContent = txt; n.className = 'dbnote' + (warn ? ' warn' : '');
}

/* Practice page: message stream, sending, exercises, session end + summary */
import { $, h, toast, uid } from './dom.js';
import { LANG, lname, quote, same, t, trName } from './i18n.js';
import { CFG } from './config.js';
import { conn } from './llm.js';
import { api } from './api.js';
import { mockApi } from './mock.js';
import { detectIntent } from './intent.js';
import { openSettings } from './settings.js';
import { newSessionObj, nodes, state } from './state.js';
import { analysisFields, db, extraOf } from './db.js';
import { GIVEUP_MARK } from './prompts.js';
import { renderMessage, typingDots } from './feedback.js';
import { renderHistory } from './history.js';

/* =====================================================================
 * 渲染
 * ===================================================================== */
export const streamEl = $('#stream'), streamIn = $('#streamIn');
export const input = $('#input');

/* ---------- 练习页：消息流 ---------- */
export function renderEmpty() {
  const mk = (t, fn) => h('button', { class: 'btn', type: 'button', text: t, onclick: fn });
  const L = lname(LANG.learn), sm = same();
  return h('div', { class: 'empty', id: 'empty' },
    h('h2', { text: t('emptyH') }),
    h('p', { text: t(sm ? 'emptyPSame' : 'emptyP', { tr: trName(), L }) }),
    h('div', { class: 'row' }, sm ? null : mk(t('btnPrompt', { tr: trName() }), () => newPrompt()), mk(t('btnOpen'), () => aiOpen())),
    h('div', { class: 'legend' },
      h('div', { text: t(sm ? 'legend1Same' : 'legend1', { L }) }),
      h('div', { text: t(sm ? 'legend2Same' : 'legend2', { ex: t('askEx', { L }) }) }),
      h('div', { text: t('legend3') }),
      h('div', { text: t('legend4') }),
      LANG.learn === 'zh' ? h('div', { text: t('legendPy') }) : null));
}
export function resetStream() { nodes.clear(); streamIn.replaceChildren(renderEmpty()); }
export function scrollDown() { requestAnimationFrame(() => { streamEl.scrollTop = streamEl.scrollHeight; }); }
export function add(m) {
  $('#empty')?.remove();
  state.session.messages.push(m);
  state.lastActivity = Date.now();
  db.addMessage(state.session, m);
  const n = renderMessage(m); nodes.set(m.id, n);
  const t = $('#typingRow'); t ? streamIn.insertBefore(n, t) : streamIn.append(n);
  scrollDown(); updateEnterHint();
}
export function refresh(m) {
  const old = nodes.get(m.id); if (!old) return;
  const n = renderMessage(m); old.replaceWith(n); nodes.set(m.id, n);
  scrollDown(); updateEnterHint();
}
export let hintTimer;
export function setBusy(b) {
  state.busy = b;
  ['btnSend', 'btnPrompt', 'btnOpen'].forEach(id => { $('#' + id).disabled = b; });
  $('#typingRow')?.remove(); clearTimeout(hintTimer);
  if (b) {
    const hint = h('span', { class: 'wait-hint' });
    streamIn.append(h('div', { class: 'msg ai', id: 'typingRow' }, h('div', { style: 'display:flex;align-items:center;gap:10px' }, typingDots(), hint)));
    hintTimer = setTimeout(() => { if (conn.mode === 'online' && CFG.provider === 'ollama') hint.textContent = t('loadingHint'); }, 8000);
    scrollDown();
  } else { input.focus(); updateEnterHint(); }
}
export function showError(e, retry) {
  $('#errRow')?.remove();
  const box = h('div', { class: 'bubble ai err' }, h('div', { class: 'rich' }, h('div', { text: e.message || String(e) })));
  const row = h('div', { class: 'msg ai', id: 'errRow' }, box,
    h('div', { class: 'prompt-foot' },
      h('button', { class: 'btn sm', type: 'button', text: t('retry'), onclick: () => { row.remove(); retry(); } }),
      h('button', { class: 'btn sm', type: 'button', text: t('openSettings'), onclick: () => openSettings() })));
  streamIn.append(row); scrollDown();
}
/* 输入框空着按 Enter（或焦点不在任何输入框、按钮上时按 Enter）= 流程里的下一步（按钮上带 ↵）：
 *   有题在等 → 我不会（写了字就是发送纠错）；
 *   看到纠错 / 答案后 → 跟着敲第 1 遍 → 遮住再敲一遍（第 2 遍）→ 下一句；正在敲的时候 → 回到跟着敲的输入框；
 *   写对了（没有要敲的）→ 下一句；聊天回复之后什么也不做。
 *   不管焦点在下面的输入框还是别处，都按这个顺序走。目标刚换的 1 秒内空回车不算，防止连按两下误触 */
export function enterButton() {
  if (state.busy) return null;
  if (state.pending) return same() ? null : nodes.get(state.pending.id)?.querySelector('[data-act=giveup]') || $('#btnGiveUp');
  const last = state.session.messages[state.session.messages.length - 1];
  if (!last || last.role !== 'user' || last.diff === undefined) return null;
  const n = nodes.get(last.id);
  if (!n) return null;
  const next = n.querySelector('[data-act=next]');
  const rb = n.querySelector('[data-act=retype]');
  if (last.isCorrect || !rb) return next;
  const rp = n.querySelector('.rt'), open = rp && !rp.hidden, st = last.rtStage;
  if (st === 'done') return next;
  if (!open) return rb;                                          // 还没开始，或者面板收起了：先打开
  if (st === 'r1done') return rp.querySelector('[data-act=rt-hide]');
  return rp.querySelector('.rt-input');                           // 正在敲：回到跟着敲的输入框
}
export function pressEnterTarget() {
  updateEnterHint();
  const b = enterButton();
  if (!b || Date.now() - (state.enterSince || 0) < GIVEUP_GUARD_MS) return;
  if (b.matches('textarea, input')) b.focus(); else b.click();
}
let enterTarget = null;
export function updateEnterHint() {
  const b = enterButton();
  if (b !== enterTarget) { enterTarget = b; state.enterSince = Date.now(); }
  document.querySelectorAll('.enter-target').forEach(x => { if (x !== b) x.classList.remove('enter-target'); });
  if (b && b.id !== 'btnGiveUp' && b.matches('button')) b.classList.add('enter-target');
}
export function syncPending() {
  const bar = $('#pendingBar'), p = state.pending;
  queueMicrotask(updateEnterHint);
  bar.hidden = !p;
  if (p) $('.txt', bar).replaceChildren(h('b', { text: t('pendingBar') }), quote(p.content));
}

/* ---------- 动作 ---------- */
export async function recentSummaries() {
  if (db.enabled) {
    try { return (await db.recent(10)).map(x => `${x.title}：${x.summary}`); } catch { return []; }
  }
  return state.history.filter(x => x.summary).slice(0, 10).map(x => `${x.title}：${x.summary}`);
}
export function setPromptStatus(p, st) { p.status = st; refresh(p); db.updateMessage(p, { status: st }); }

export const IDLE_MS = 30 * 60 * 1000;             // 超过 30 分钟没有操作，就自动结束当前会话
export const busySessions = new Set();              // 正在生成标题/总结的会话
export function rollIfIdle() {
  if (state.session.messages.length && !state.pending && Date.now() - state.lastActivity > IDLE_MS) {
    endCurrentSession(); toast(t('idleEnded'));
  }
}
export function endCurrentSession() {
  const s = state.session;
  if (!s.messages.length) return false;
  s.endedAt = new Date(); s.title = ''; s.summary = '';
  db.updateSession(s, { ended_at: 'now' });
  if (!db.enabled) state.history.unshift(s);
  state.session = newSessionObj(); state.pending = null; state.lastActivity = Date.now();
  syncPending(); resetStream(); $('#errRow')?.remove();
  summarizeAndSave(s);
  return true;
}
export async function summarizeAndSave(s) {
  busySessions.add(s);
  try {
    let r, fromModel = true;
    try { r = await api.summarize(s); } catch { r = await mockApi.summarize(s); fromModel = false; }
    s.title = r.title; s.summary = r.summary;
    if (fromModel) await db.updateSession(s, { title: r.title, summary: r.summary });     // 只有模型生成的才存库；没生成成功下次启动会补
  } finally { busySessions.delete(s); }
  if (state.view === 'history' && state.openId == null) renderHistory();
}

/* 已经批量生成、还没出过的中文句子。换话题或会话结束（state.session 变了）就作废 */
export const promptQueue = { session: null, topic: '', items: [] };          // items: { zh, focus }
export function takeQueuedPrompt(topic) {
  const q = promptQueue;
  if (q.session !== state.session || q.topic !== topic) { q.items = []; return null; }
  const used = state.session.messages.filter(m => m.kind === 'prompt').map(m => m.content);
  while (q.items.length) { const it = q.items.shift(); if (!used.includes(it.zh)) return it; }
  return null;
}
export async function newPrompt() {
  if (state.busy) return;
  rollIfIdle();
  if (state.pending) { setPromptStatus(state.pending, 'skipped'); state.pending = null; syncPending(); }
  $('#errRow')?.remove();
  setBusy(true);
  try {
    const topic = $('#topic').value.trim();
    let item = await dueReview(topic) || takeQueuedPrompt(topic);
    if (!item) {
      const sess = state.session;
      const used = sess.messages.filter(m => m.kind === 'prompt').map(m => m.content);
      const list = await api.newPrompts({ topic, used, recent: CFG.topicDedupe === 'local' ? null : await recentSummaries() });
      Object.assign(promptQueue, { session: sess, topic, items: list.slice(1) });
      item = list[0];
    }
    setBusy(false);
    const m = { id: uid(), role: 'assistant', kind: 'prompt', content: item.zh, status: 'pending' };
    if (item.focus) m.focus = item.focus;
    if (item.review) { m.review = item.review; m.reviewStep = item.step; }
    add(m); state.pending = m; syncPending();
  } catch (e) { setBusy(false); showError(e, () => newPrompt()); }
}
/* v0.4 复习：做错过的题到期了，就在新题之间插一句（不连着出两道复习题；设了话题时不插，免得跑题）。
 * 到期规则和记录都在 server.py（reviews 表），答完纠错后服务器自动更新 */
export async function dueReview(topic) {
  if (!db.enabled || topic || same()) return null;
  const prompts = state.session.messages.filter(m => m.kind === 'prompt');
  if (prompts.length && prompts[prompts.length - 1].review) return null;
  try {
    await db.q;
    const r = await db.req('GET', `/reviews?lang=${LANG.learn}&explain=${LANG.explain}&limit=10`);
    const used = new Set(prompts.filter(m => m.review).map(m => m.content));      // 同一个会话里一句只复习一次
    const it = (r.due || []).find(x => !used.has(x.source));
    return it ? { zh: it.source, focus: it.focus || null, review: it.id, step: it.step } : null;
  } catch (e) { console.warn('读取复习失败：', e); return null; }
}
/* v0.6：报告有问题的题目（记在 reports 表里，这句也不会再出现在复习里）；还没答的题标成「已报告」并换一句 */
export async function reportPrompt(p, reason) {
  if (db.enabled) {
    try { await db.q; await db.req('POST', '/reports', { kind: 'bad_exercise', reason, message_id: p.dbId ?? null, level: LANG.level }); }
    catch (e) { toast(t('reportFail') + e.message); return; }
  }
  const pending = state.pending === p;
  p.reported = reason;
  if (pending) { state.pending = null; syncPending(); setPromptStatus(p, 'bad'); }
  else { refresh(p); db.updateMessage(p, { extra: extraOf(p) }); }
  toast(t(pending ? 'reportNext' : 'reportThanks'));
  if (pending) newPrompt();
}
export async function removeReview(p) {
  try { await db.req('DELETE', '/reviews/' + p.review); } catch (e) { toast(e.message); return; }
  toast(t('reviewRemoved'));
  if (state.pending === p) newPrompt();          // 跳过这句，直接出下一句
}
let reviewHintShown = false;
/* 纠错完成后：复习题告诉学生结果；第一次做错一道新题时说明一次「会自动加入复习」 */
export function reviewToast(m) {
  if (m.kind !== 'translate' || !db.enabled) return;
  const wrong = !m.isCorrect || m.meaning === 'off';
  if (m.review) toast(t(wrong ? 'reviewAgain' : (m.reviewStep ?? 0) + 1 >= 3 ? 'reviewDone' : 'reviewPass'));
  else if (wrong && !reviewHintShown) { reviewHintShown = true; toast(t('reviewAdded')); }
}
/* 回复可能是纯文字，也可能是 { text, words }（学中文：分词 + 拼音，存在 extra 里） */
export const replyMsg = r => (typeof r === 'string' ? { id: uid(), role: 'assistant', kind: 'reply', content: r }
  : Object.assign({ id: uid(), role: 'assistant', kind: 'reply', content: r.text }, r.words ? { words: r.words } : {}));
export function skipPrompt() {
  if (!state.pending) return;
  setPromptStatus(state.pending, 'skipped');
  state.pending = null; syncPending();
}
export async function aiOpen() {
  if (state.busy) return;
  rollIfIdle();
  $('#errRow')?.remove();
  setBusy(true);
  try {
    const r = await api.opener($('#topic').value.trim());
    setBusy(false);
    add(replyMsg(r));
  } catch (e) { setBusy(false); showError(e, () => aiOpen()); }
}
export async function processTurn(m) {
  $('#errRow')?.remove();
  setBusy(true);
  try {
    if (m.kind !== 'ask' && m.diff === undefined) {
      const res = await api.analyze({ intent: m.kind, text: m.content, zh: m.zh });
      if (res.notTarget) {                       // 规则把它当成了练习，模型说这其实不是学习语言：改按提问处理
        const was = m.kind; m.kind = 'ask'; delete m.zh;
        db.updateMessage(m, { kind: 'ask', zh: null });
        if (was === 'translate') {               // 那句翻译题还没答：恢复成等待翻译
          const p = [...state.session.messages].reverse().find(x => x.kind === 'prompt' && x.status === 'answered');
          if (p && !state.pending) { setPromptStatus(p, 'pending'); state.pending = p; syncPending(); }
        }
        refresh(m);
      } else {
        Object.assign(m, res);
        db.updateMessage(m, analysisFields(m));
        refresh(m);
        reviewToast(m);
      }
    }
    if (m.kind === 'chat') {
      const r = await api.chatReply({ session: state.session, topic: $('#topic').value.trim() });
      setBusy(false); add(replyMsg(r));
    } else if (m.kind === 'ask') {
      const text = await api.ask({ text: m.content });
      setBusy(false); add({ id: uid(), role: 'assistant', kind: 'answer', content: text });
    } else setBusy(false);
  } catch (e) { setBusy(false); showError(e, () => processTurn(m)); }
}
export const GIVEUP_GUARD_MS = 1000;
export function send() {
  const text = input.value.trim();
  if (!text) { pressEnterTarget(); return; }
  if (state.busy) return;
  input.value = ''; autosize();
  rollIfIdle();
  const intent = detectIntent(text, state.pending && !same());
  const m = { id: uid(), role: 'user', kind: intent, content: text };
  if (intent === 'translate') {
    const p = state.pending; m.zh = p.content;
    if (p.focus) m.focus = p.focus;                 // v0.4：译文也记下语法点，用来找「常错的语法点」
    if (p.review) { m.review = p.review; m.reviewStep = p.reviewStep; }
    setPromptStatus(p, 'answered'); state.pending = null; syncPending();
  }
  add(m);
  processTurn(m);
}
/* v0.6「我不会」：这道题算答了（没做对），给参考译文，可以跟着敲，进复习 */
export function giveUp() {
  const p = state.pending;
  if (!p || state.busy) return;
  rollIfIdle();
  const m = { id: uid(), role: 'user', kind: 'translate', content: GIVEUP_MARK, zh: p.content, gaveUp: true };
  if (p.focus) m.focus = p.focus;
  if (p.review) { m.review = p.review; m.reviewStep = p.reviewStep; }
  setPromptStatus(p, 'answered'); state.pending = null; syncPending();
  add(m);
  processGiveUp(m);
}
export async function processGiveUp(m) {
  $('#errRow')?.remove();
  setBusy(true);
  try {
    Object.assign(m, await api.giveUp({ zh: m.zh, focus: m.focus }));
    db.updateMessage(m, analysisFields(m));
    refresh(m);
    setBusy(false);
    reviewToast(m);
  } catch (e) { setBusy(false); showError(e, () => processGiveUp(m)); }
}
export function newSession() {
  if (state.busy) return;
  if (!endCurrentSession()) { toast(t('emptySession')); return; }
  toast(t('sessionEnded'));
}

export function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }

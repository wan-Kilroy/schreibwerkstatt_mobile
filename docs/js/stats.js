/* Statistics: today / total, calendar heat map, day details */
import { $, h, pad } from './dom.js';
import { LOCALE, lname, pl, t, tb, ui } from './i18n.js';
import { state } from './state.js';
import { db } from './db.js';
import { renderHistory } from './history.js';
import { errLabel } from './errors.js';
import { LANG } from './i18n.js';

/* ---------- 统计：今日 / 累计，以及每天一格的日历图 ---------- */
/* 数据来自 /api/stats：每写一句一行（删除会话后也保留），这里按本地日期归到“天”。
 * 一“句”= 译文 + 对话；提问（X 怎么说）单独记；词数只算译文和对话里你自己写的德语。 */
export const LEVELS = [1, 4, 8, 15];                                  // 一天练到这么多句，颜色就升一档
export const levelOf = n => n >= LEVELS[3] ? 4 : n >= LEVELS[2] ? 3 : n >= LEVELS[1] ? 2 : n >= LEVELS[0] ? 1 : 0;
export const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
/* 日期文字：中文界面沿用「9月22日 周二」，其他语言用浏览器自带的本地化格式 */
export const dayLabel = (d, long) => ui() === 'zh'
  ? (long ? `${d.getFullYear()}年` : '') + `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAY[d.getDay()]}`
  : d.toLocaleDateString(LOCALE[ui()], long ? { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
export const monthLabel = d => (ui() === 'zh' ? `${d.getMonth() + 1}月` : d.toLocaleDateString(LOCALE[ui()], { month: 'short' }));
export const statLang = () => $('#histLang').value;                   // 统计跟着历史页的语言筛选
export const unitName = n => pl(n, statLang() === 'zh' ? 'unitChars' : 'unitWords');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const stats = { days: new Map(), weeks: 26, picked: null, req: 0, sreq: 0 };   // req / sreq：日历图和顶部汇总各自只认最后一次请求

export async function loadStats() {
  await db.q;                                                  // 刚发的那句还在排队写库时，先等它写完
  const lang = statLang(), rows = (await db.req('GET', '/stats' + (lang ? '?lang=' + lang : ''))).rows, days = new Map();
  const since = Date.now() - 30 * 864e5, err = { checked: 0, wrong: 0, tags: new Map() };          // 近 30 天的错误类型
  for (const r of rows) {
    if (r.k !== 'ask' && (r.ok === 0 || r.ok === 1) && new Date(r.t).getTime() >= since && Array.isArray(r.e)) {
      err.checked++;
      if (r.ok === 0 || r.e.length) err.wrong++;
      for (const k of r.e) err.tags.set(k, (err.tags.get(k) || 0) + 1);
    }
    const k = dayKey(new Date(r.t));
    let d = days.get(k);
    if (!d) days.set(k, d = { n: 0, tr: 0, ch: 0, ask: 0, words: 0, ok: 0, retyped: 0, sessions: new Set() });
    if (r.k === 'ask') d.ask++;
    else { d.n++; if (r.k === 'translate') d.tr++; else d.ch++; d.words += r.w; d.retyped += r.r || 0; if (r.ok === 1) d.ok++; }
    d.sessions.add(r.s);
  }
  days.err = err;
  return days;
}

export const bold = v => h('b', { text: v });
export async function refreshSums() {                                 // 历史列表顶部：今日已练 xx 句 · 累计 xx 句
  const row = $('#statsRow');
  row.hidden = !db.enabled;
  if (!db.enabled) return;
  const my = ++stats.sreq;
  try {
    const days = await loadStats();
    if (my !== stats.sreq) return;
    stats.days = days;
    const td = days.get(dayKey(new Date())), today = td ? td.n : 0;
    let total = 0; for (const d of days.values()) total += d.n;
    $('#stSums').replaceChildren(h('span', {},
      today ? tb('todayDone', { n: today, w: td.words, unit: unitName(td.words), sentN: pl(today, 'sentN') }) : t('noToday'),
      h('span', { class: 'sep', text: '|' }), tb('totalS', { n: total, sentN: pl(total, 'sentN') })));
  } catch { row.hidden = true; }
}

export async function renderStats() {
  const my = ++stats.req;
  try {
    const days = await loadStats();
    if (my !== stats.req) return;
    stats.days = days;
  } catch (e) { $('#heat').replaceChildren(h('div', { class: 'none', text: t('statsFail') + e.message })); return; }
  drawHeat();
  drawErrors(stats.days.err);
  drawReviews(my);
  drawFoci(my);
}

/* v0.5：当前水平的语法点（只有分了等级的语言才显示，现在是德语）：练过几个、最近一次对不对 */
export async function drawFoci(my) {
  const box = $('#stFoci'), lang = statLang() || LANG.learn;
  try {
    const r = await db.req('GET', `/foci/progress?lang=${lang}&level=${LANG.level}`);
    if (my !== stats.req) return;
    box.hidden = !r.group || !r.items.length;
    if (box.hidden) return;
    const done = r.items.filter(x => x.n).length, good = r.items.filter(x => x.last_ok).length;
    box.replaceChildren(h('h3', { text: t('focH', { lv: r.group === 'C1' ? 'C1/C2' : r.group, L: lname(lang) }) }),
      h('p', {}, ...tb('focLine', { p: done, t: r.items.length, g: good })),
      h('p', { class: 'quiet', text: t('focHint') }),
      h('div', { class: 'foclist' }, ...r.items.map(x => h('span', {
        class: 'foc' + (x.last_ok === true ? ' ok' : x.last_ok === false ? ' bad' : ''), lang: 'de',
        title: x.n ? t('focTip', { n: x.n, ok: x.ok }) : '', text: x.focus }))));
  } catch { box.hidden = true; }
}

/* v0.4：常错类型（近 30 天，按次数排）。数据来自每句纠错时模型给的 errors */
export function drawErrors(err) {
  const box = $('#stErr');
  const list = err ? [...err.tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) : [];
  if (!list.length) { box.replaceChildren(h('h3', { text: t('errH') }), h('p', { class: 'quiet', text: t('errNone') })); return; }
  const max = list[0][1];
  box.replaceChildren(h('h3', { text: t('errH') }), h('p', { class: 'quiet' }, ...tb('errSub', { c: err.checked, x: err.wrong })),
    h('div', { class: 'errlist' }, ...list.slice(0, 10).flatMap(([k, n]) => [
      h('span', { text: errLabel(k) }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(4, Math.round(n / max * 100))}%` })),
      h('span', { class: 'n', text: t('errTimes', { n }) })])));
}
/* v0.4：复习进度（reviews 表）：现在该复习 / 之后 / 已掌握 */
export async function drawReviews(my) {
  const box = $('#stRev'), lang = statLang();
  try {
    const r = await db.req('GET', '/reviews?limit=1' + (lang ? '&lang=' + lang : ''));
    if (my !== stats.req) return;
    const c = r.counts || {};
    box.hidden = !(c.due || c.waiting || c.done);
    box.replaceChildren(h('h3', { text: t('revH') }), h('p', {}, ...tb('revLine', { d: c.due || 0, w: c.waiting || 0, m: c.done || 0 })),
      h('p', { class: 'quiet', text: t('revHint') }));
  } catch { box.hidden = true; }
}

export function drawHeat() {
  const W = stats.weeks, today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today), dow = (today.getDay() + 6) % 7;                     // 周一 = 0
  const dayAt = (w, r) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - (W - 1 - w) * 7 + r);
  if (!stats.picked) stats.picked = todayKey;
  const heat = $('#heat'), kids = [];
  heat.className = 'heat' + (W <= 26 ? ' big' : '');
  heat.style.gridTemplateColumns = `repeat(${W}, var(--cell))`;
  let days = 0, sentences = 0, words = 0;
  for (let w = 0; w < W; w++) {
    for (let r = 0; r < 7; r++) {                                                      // 月份标签放在“含有 1 号的那一列”，和 1 号那格左对齐
      const d1 = dayAt(w, r);
      if (d1.getDate() === 1 && d1 <= today) { kids.push(h('div', { class: 'mon', style: `grid-column:${w + 1} / span 3`, text: monthLabel(d1) })); break; }
    }
    for (let r = 0; r < 7; r++) {
      const dt = dayAt(w, r);
      if (dt > today) break;                                                           // 还没到的日子不画
      const k = dayKey(dt), d = stats.days.get(k), n = d ? d.n : 0;
      if (n) { days++; sentences += n; words += d.words; }
      kids.push(h('button', {
        type: 'button', 'data-k': k, style: `grid-column:${w + 1}; grid-row:${r + 2}`,
        class: `day lv${levelOf(n)}${dt.getDate() === 1 ? ' first' : ''}${k === todayKey ? ' today' : ''}${k === stats.picked ? ' sel' : ''}`,
        'aria-label': t('dayAria', { date: dayLabel(dt), n, sentN: pl(n, 'sentN') }),
      }));
    }
  }
  heat.replaceChildren(...kids);
  $('#stRange').replaceChildren(...tb(W <= 26 ? 'rangeHalf' : 'rangeYear', { d: days, s: sentences, w: words, unit: unitName(words), dayN: pl(days, 'dayN'), sentN: pl(sentences, 'sentN') }));
  $('#stLegend').textContent = t('perDay', { x: LEVELS.map((v, i) => i < 3 ? `${v}${LEVELS[i + 1] - 1 > v ? '–' + (LEVELS[i + 1] - 1) : ''}` : v + '+').join(' / ') });
  document.querySelectorAll('.seg .btn').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.weeks === W)));
  showDay(stats.picked);
  $('#heatScroll').scrollLeft = 1e6;                                                   // 窄屏时从今天这一端看起
}

export function showDay(k) {
  const [y, m, dd] = k.split('-').map(Number), d = stats.days.get(k);
  const tile = (v, label, sub) => h('div', { class: 'tile' }, bold(v), h('span', { text: label }), sub ? h('small', { text: sub }) : null);
  const box = $('#stDay');
  box.replaceChildren(
    h('h3', { text: dayLabel(new Date(y, m - 1, dd), true) + (k === dayKey(new Date()) ? t('todayMark') : '') }),
    d ? h('div', { class: 'tiles' },
      tile(d.n, t('tSent'), t('tSentSub', { a: d.tr, b: d.ch })),
      tile(d.words, t(statLang() === 'zh' ? 'tChars' : 'tWords'), statLang() ? t('tWordsSub', { L: lname(statLang()) }) : t('tWordsAll')),
      tile(`${d.ok} / ${d.n}`, t('tOk'), d.n ? `${Math.round(d.ok / d.n * 100)}%` : ''),
      tile(d.retyped, t('tRetyped')),
      tile(d.ask, t('tAsk')),
      tile(d.sessions.size, t('tSessions'))) : h('p', { class: 'quiet', text: t('noPractice') }));
}
export const heatDay = e => { const b = e.target.closest && e.target.closest('.day'); return b && b.dataset.k; };
        // 悬停：预览



/* Wiring that ran when the page loaded (event listeners …); called once by main.js */
export function init_stats() {
  $('#heat').addEventListener('mouseover', e => { const k = heatDay(e); if (k) showDay(k); });
  $('#heat').addEventListener('focusin', e => { const k = heatDay(e); if (k) showDay(k); });
  $('#heat').addEventListener('mouseleave', () => showDay(stats.picked));
  $('#heat').addEventListener('click', e => {                                                         // 点击：固定这一天
    const k = heatDay(e); if (!k) return;
    stats.picked = k;
    document.querySelectorAll('#heat .sel').forEach(x => x.classList.remove('sel'));
    e.target.closest('.day').classList.add('sel');
    showDay(k);
  });
  document.querySelectorAll('.seg .btn').forEach(b => b.addEventListener('click', () => { stats.weeks = +b.dataset.weeks; drawHeat(); }));
  $('#btnStats').addEventListener('click', () => { state.statsOpen = true; renderHistory(); });
  $('#btnStatsBack').addEventListener('click', () => { state.statsOpen = false; renderHistory(); refreshSums(); });
}

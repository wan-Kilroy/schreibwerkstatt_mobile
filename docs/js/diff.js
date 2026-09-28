/* What changed between the student sentence and the correction (red / green), normalizeAnalysis() */
import { END_PUNCT, normEnd, squash } from './dom.js';
import { cleanWords } from './zh.js';
import { cleanErrors } from './errors.js';
import { LANG } from './i18n.js';

/* =====================================================================
 * 词级对比（真实版本里由后端 difflib 完成；现在直接在浏览器里算）
 *   返回 { orig:[{lead,t,x}], fixed:[{lead,t,x}], changes:[{from,to}] }
 * ===================================================================== */
/* 汉字（和假名）每个字单独算一个 token：中文句子没有空格，按词对比会把整句当成一个词 */
export const TOKEN_RE = /(\s*)(\p{sc=Han}|\p{sc=Hiragana}|\p{sc=Katakana}|(?:(?![\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}])[\p{L}\p{N}'’\-])+|[^\s\p{L}\p{N}])/gu;
export const HAN = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;
export const joinTokens = arr => arr.reduce((a, x) => (a && !HAN.test(a.slice(-1)) && !HAN.test(x[0]) ? a + ' ' + x : a + x), '');
export const tokenize = s => [...s.matchAll(TOKEN_RE)].map(m => ({ lead: m[1], t: m[2] }));

export function diffTokens(a, b) {
  const A = tokenize(a), B = tokenize(b), n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i].t === B[j].t ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i].t === B[j].t) { ops.push({ k: 'eq', a: A[i++], b: B[j++] }); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ k: 'del', a: A[i++] });
    else ops.push({ k: 'ins', b: B[j++] });
  }
  while (i < n) ops.push({ k: 'del', a: A[i++] });
  while (j < m) ops.push({ k: 'ins', b: B[j++] });

  const orig = ops.filter(o => o.k !== 'ins').map(o => ({ lead: o.a.lead, t: o.a.t, x: o.k === 'del' }));
  const fixed = ops.filter(o => o.k !== 'del').map(o => ({ lead: o.b.lead, t: o.b.t, x: o.k === 'ins' }));
  const groups = []; let cur = null;
  for (const o of ops) {
    if (o.k === 'eq') { cur = null; continue; }
    if (!cur) { cur = { from: [], to: [] }; groups.push(cur); }
    if (o.k === 'del') cur.from.push(o.a.t); else cur.to.push(o.b.t);
  }
  return { orig, fixed, changes: groups.map(g => ({ from: joinTokens(g.from), to: joinTokens(g.to) })) };
}

/* 把模型返回的结果整理成界面用的结构 */
export function normalizeAnalysis(j, text, intent) {
  text = squash(text);
  let corrected = squash(j.corrected) || text;
  if (!/[.!?…。！？]$/.test(text)) corrected = corrected.replace(END_PUNCT, '');     // 用户没写句末标点，就不强加
  const meaning = intent === 'translate' && j.meaning === 'off' ? 'off' : 'ok';
  const isCorrect = corrected === text;
  let better = squash(j.better);
  if (meaning === 'off' || !better || normEnd(better).toLowerCase() === normEnd(corrected).toLowerCase()) better = '';
  return {
    isCorrect, corrected, meaning,
    diff: isCorrect ? null : diffTokens(text, corrected),
    brief: isCorrect && meaning !== 'off' ? '' : squash(j.brief),
    better, betterNote: better ? squash(j.better_note) : '',
    notTarget: j.not_target === true,                                      // 模型说：这句根本不是在写学习语言（其实是提问）
    pinyin: isCorrect ? '' : squash(j.pinyin), betterPinyin: better ? squash(j.better_pinyin) : '',   // 旧格式（整句拼音），只为兼容
    words: cleanWords(j.words, corrected), betterWords: better ? cleanWords(j.better_words, better) : null,   // 学中文：分词 + 拼音
    studentWords: cleanWords(j.student_words, text, false),
    errors: cleanErrors(j.errors, LANG.learn, { isCorrect, meaning }),       // v0.4：错误类型（统计「常错类型」用）
  };
}

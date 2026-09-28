/* Chinese: pinyin from the model, word segmentation in the browser, pinyin-above-word layout */
import { END_PUNCT, h, squash } from './dom.js';
import { HAN } from './diff.js';
import { NO_RETRY, llmChat, parseJSON } from './llm.js';
import { REPLY_SCHEMA } from './prompts.js';

export const splitPy = text => {
  const lines = String(text || '').split('\n'); const i = lines.findIndex(l => /^\s*PY\s*[:：]/i.test(l));
  return i < 0 ? { text: String(text || '').trim(), py: '' } : { text: lines.filter((_, k) => k !== i).join('\n').trim(), py: lines[i].replace(/^\s*PY\s*[:：]\s*/i, '').trim() };
};

/* 分词 + 拼音：words = [[词, 拼音], …]（studentWords 只有词）。拼起来必须和原句一样（不算空格），对不上就不用，退回普通显示 */
export const noSp = x => String(x || '').replace(/\s+/g, '');
export function cleanWords(arr, sentence, withPy = true) {
  if (!Array.isArray(arr) || !arr.length || !sentence) return null;
  let out = [];
  for (const it of arr) {
    const w = typeof it === 'string' ? it : it && (it.w ?? it.word ?? it[0]);
    const py = typeof it === 'string' ? '' : it && (it.py ?? it.pinyin ?? it[1]);
    if (typeof w !== 'string' || !w.trim()) continue;
    out.push(withPy ? [w.trim(), squash(py || '')] : w.trim());
  }
  const joined = () => noSp(out.map(x => (withPy ? x[0] : x)).join(''));
  const target = noSp(sentence);
  while (out.length && joined() !== target && END_PUNCT.test(withPy ? out[out.length - 1][0] : out[out.length - 1]) && joined().startsWith(target))
    out = out.slice(0, -1);                                   // 句末标点被页面去掉了（学生没写），分词里也去掉
  return joined() === target ? out : null;
}
/* 学中文时的回复：模型返回 JSON {reply, words}；解析失败就当普通文字 */
export async function zhReply(msgs, opts) {
  try {
    const j = parseJSON(await llmChat(msgs, { ...opts, schema: REPLY_SCHEMA }));
    const text = squash(j.reply);
    if (text) return { text, words: cleanWords(j.words, text) };
  } catch (e) { if (e.kind && NO_RETRY.has(e.kind)) throw e; }
  return { text: splitPy(await llmChat(msgs, opts)).text, words: null };
}

export const pyLine = py => (py ? h('div', { class: 'py', lang: 'zh-Latn-pinyin', text: py }) : null);
/* 每个字是否改动过（来自 diffTokens 的 orig / fixed），不算空格 */
export const charFlags = tokens => { const f = []; for (const k of tokens) for (const ch of k.t) if (!/\s/.test(ch)) f.push(!!k.x); return f; };
export const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
/* ---------- 中文分词：由浏览器自带的 Intl.Segmenter 来分（模型常常把句子拆成单字，不可靠），
 * 模型只负责每个字的读音；模型自己标成一个多字词的（如 图书馆），不再拆开 ---------- */
export const ZH_SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh-CN', { granularity: 'word' }) : null;
export const SYL_RE = /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|ang|eng|ing|ong|ian|iao|uai|uan|ai|ao|an|ei|en|er|ia|ie|in|iu|ou|ua|uo|ui|un|ue|a|o|e|i|u)r?$/;
/* 一个词的拼音拆成 n 个音节："tán gāngqín" → tán, gāng, qín。先按空格 / 隔音符号分段，每段再拆；
 * 段内优先让后面的音节以辅音开头（拼音里元音开头的音节前本该有 '，所以 tángāngqín = tán gāng qín）。拆不开返回 null */
export function splitSyllables(py, n) {
  const parts = String(py || '').trim().split(/[\s'’\-]+/).filter(Boolean);
  if (!parts.length) return null;
  if (n === 1) return [parts.join("'")];
  const bases = parts.map(p => [...p].map(c => c.normalize('NFD')[0].toLowerCase().replace('ü', 'u')).join(''));
  const splitPart = (pi, k, strict) => {                    // 第 pi 段拆成 k 个音节
    const src = [...parts[pi]], base = bases[pi];
    const go = (i, left) => {
      if (left === 0) return i === base.length ? [] : null;
      for (let j = Math.min(base.length, i + 6); j > i; j--) {
        if (!SYL_RE.test(base.slice(i, j))) continue;
        if (strict && j < base.length && /[aoe]/.test(base[j])) continue;
        const rest = go(j, left - 1);
        if (rest) return [src.slice(i, j).join(''), ...rest];
      }
      return null;
    };
    return go(0, k);
  };
  const assign = (pi, left, strict) => {                    // 把剩下的 left 个音节分给第 pi 段及以后
    if (pi === parts.length) return left === 0 ? [] : null;
    for (let k = 1; k <= left - (parts.length - pi - 1); k++) {
      const mine = splitPart(pi, k, strict); if (!mine) continue;
      const rest = assign(pi + 1, left - k, strict);
      if (rest) return [...mine, ...rest];
    }
    return null;
  };
  return assign(0, n, true) || assign(0, n, false);
}
/* 一个词里的音节连写；元音开头的音节前加隔音符号（nǚ'ér、fāng'àn） */
export const joinSyllables = syl => syl.reduce((a, x) => (a && /^[aoeāáǎàōóǒòēéěè]/i.test(x) ? a + "'" + x : a + x), '');
/* 浏览器分词，再补两条：「图书+馆」「火车+站」这类（前面是词、后面是表示场所 / 人的单字）合成一个词；
 * 连在一起的非汉字（Wi-Fi、3.5）不拆开。返回每个词的字数 */
export const ZH_SUFFIX = new Set([...'馆店厅室园场站院楼局所厂部处街路机器员家者师生费票证卡']);
export function segmentLens(text) {
  const segs = [...ZH_SEG.segment(text)].map(x => x.segment), out = [];
  for (const sg of segs) {
    const prev = out[out.length - 1], hasHan = HAN.test(sg);
    if (prev && ((!hasHan && !HAN.test(prev.s) && !/^\s+$/.test(sg)) ||
        ([...sg].length === 1 && ZH_SUFFIX.has(sg) && [...prev.s].length >= 2 && [...prev.s].every(c => HAN.test(c))))) prev.s += sg;
    else out.push({ s: sg });
  }
  return out.map(x => [...x.s].length);
}
/* 模型给的 [[词, 拼音]] → 按浏览器分词重新组合成 [[词, 整词拼音]]；做不到时原样返回 */
export function regroupWords(items) {
  if (!ZH_SEG || !items || !items.length) return items;
  const chars = [];                                         // { c: 字, py: 这个字的拼音, g: 模型给的第几个词 }
  for (let g = 0; g < items.length; g++) {
    const cs = [...noSp(items[g][0])], han = cs.filter(c => HAN.test(c)).length;
    const syl = han ? splitSyllables(items[g][1], han) : [];
    if (han && !syl) return items;
    let k = 0; for (const c of cs) chars.push({ c, py: HAN.test(c) ? syl[k++] : '', g });
  }
  const out = []; let i = 0;
  for (const n of segmentLens(chars.map(x => x.c).join(''))) {
    const part = chars.slice(i, i + n); i += n;
    out.push([part.map(y => y.c).join(''), joinSyllables(part.map(y => y.py).filter(Boolean))]);
  }
  return out;
}
/* 没有拼音的句子（你的原文）：直接用浏览器分词；不支持时用模型给的分词 */
export function segmentPlain(text, fallback) {
  if (!ZH_SEG) return fallback;
  const cs = [...noSp(text)], out = []; let i = 0;
  for (const n of segmentLens(cs.join(''))) { out.push(cs.slice(i, i + n).join('')); i += n; }
  return out;
}

/* 学中文的句子：按词排开（withPy 时拼音在词上方）；flags 给出时，改动的字照旧标红 / 标绿（拼音不标色） */
export function renderWords(words, { flags = null, cls = '', withPy = true } = {}) {
  if (withPy) words = regroupWords(words);
  const line = h('span', { class: 'zw-line', lang: 'zh-CN' }); let i = 0;
  for (const wd of words) {
    const w = withPy ? wd[0] : wd, py = withPy ? wd[1] : '';
    const base = h('span', { class: 'zw-b' }); let mk = null;
    for (const ch of noSp(w)) {
      if (flags && flags[i++]) { if (!mk) { mk = h('mark', { class: cls }); base.append(mk); } mk.append(ch); }
      else { mk = null; base.append(ch); }
    }
    const punct = PUNCT_ONLY.test(w), c = 'zw' + (punct ? ' p' : '') + (withPy ? ' zp' : '');
    line.append(withPy ? h('span', { class: c }, h('span', { class: 'zw-py', lang: 'zh-Latn-pinyin', text: punct ? '' : py }), base) : h('span', { class: c }, base));
  }
  if (withPy) fitObserver.observe(line);                   // 显示出来（量得到宽度）时再调字距
  return line;
}
/* 拼音比汉字宽的多字词：把字隔开「多出宽度的一半」，最多 0.2 个字宽；拼音不长的词不变 */
export function fitWords(line) {
  for (const wd of line.querySelectorAll('.zw.zp')) {
    const b = wd.querySelector('.zw-b'), py = wd.querySelector('.zw-py'), n = [...noSp(b.textContent)].length;
    b.style.letterSpacing = ''; b.style.marginRight = '';
    if (n < 2) continue;
    const extra = py.getBoundingClientRect().width - b.getBoundingClientRect().width;
    if (extra <= 0) continue;
    const ls = Math.min(extra * 0.5 / (n - 1), parseFloat(getComputedStyle(b).fontSize) * 0.2);   // 词内字距始终明显小于词间距
    b.style.letterSpacing = ls + 'px'; b.style.marginRight = -ls + 'px';   // 最后一个字后面不多出空白
  }
}
export const fitObserver = new ResizeObserver(entries => {
  for (const e of entries) if (e.contentRect.width > 0) { fitWords(e.target); fitObserver.unobserve(e.target); }
});

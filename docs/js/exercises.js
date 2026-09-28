/* Exercise sentences: language check, generation for the local de-duplication, topic filter */
import { squash } from './dom.js';
import { EN_NAME, LANG } from './i18n.js';
import { llmJSON } from './llm.js';
import { ANY_TOPIC, SRC_KEY, promptsLocalSchema, sysPromptsLocal } from './prompts.js';
import { HAN_ALL, LATIN_ALL, count, langScore } from './intent.js';
import { db } from './db.js';

/* 模型出的原句是不是讲解语言写的（不是就丢掉重出）。只用文字本身判断，不花 token */
export function srcLangOk(text, explain = LANG.explain, learn = LANG.learn) {
  const han = count(text, HAN_ALL), latin = count(text, LATIN_ALL);
  if (explain === 'zh') return han > 0 && han >= latin / 3;               // 中文原句：主要是汉字
  if (han) return false;                                                   // 英语 / 德语原句里不该有汉字
  if (learn === 'zh') return latin > 0;                                     // 学中文：只要不是汉字就行
  const mine = langScore(text, explain), theirs = langScore(text, learn);  // 拉丁字母语言之间：看常用小词和特殊字母
  return !(theirs >= 2 && theirs > mine);
}
export const pickSrc = it => squash(typeof it === 'string' ? it : (it && (it[SRC_KEY[LANG.explain]] || it.text || it.sentence || it.zh)) || '');

/* ---------- local 模式的两个小函数 ---------- */
export async function generateSentences({ topic, foci, words, tag, strict = false }) {
  const E = EN_NAME[LANG.explain], L = EN_NAME[LANG.learn];
  const user = `Topic: ${topic || ANY_TOPIC}\nWrite ${foci.length} ${E} sentences (not ${L}), one per ${L} grammar focus:\n${foci.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    + (words.length ? `\nAvoid these recently used topic words (and the settings or activities they belong to): ${words.join(LANG.explain === 'zh' ? '、' : ', ')}` : '')
    + (strict ? `\nYour previous sentences were written in ${L}. This is wrong: write every sentence in ${E}.` : '');
  const j = await llmJSON(sysPromptsLocal(), user, promptsLocalSchema(), { temperature: 0.9, tag });
  const out = []; out.wrongFoci = [];
  (Array.isArray(j.sentences) ? j.sentences : []).forEach((it, i) => {
    const zh = pickSrc(it);
    const k = it && Number.isInteger(it.n) && it.n >= 1 && it.n <= foci.length ? it.n : i + 1;
    if (!zh) return;
    if (!srcLangOk(zh)) { out.wrongFoci.push(foci[k - 1] || null); console.warn('出的题不是讲解语言，丢掉：', zh); return; }
    if (!out.some(o => o.zh === zh)) out.push({ zh, focus: foci[k - 1] || null });
  });
  return out;
}
export async function topicFilter(candidates, context, topic, force, round) {
  try { return await db.req('POST', '/topics/filter', { candidates, context, topic, force_if_empty: force, round, lang: LANG.learn, explain_lang: LANG.explain }); }
  catch (e) { console.warn('本地话题过滤失败，这一批不过滤：', e); return { kept: candidates, dropped: [], forced: false }; }
}

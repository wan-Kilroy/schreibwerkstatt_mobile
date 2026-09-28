/* Is a message practice (translation / chat) or a question? detectIntent() */
import { LANG } from './i18n.js';

/* 自动识别：写的是学习语言 → 译文 / 对话；其他语言 → 提问。
 * 规则只看文字本身（不花 token）；判断错了的，纠错时模型会返回 not_target，页面再自动改按提问处理。 */
export const HAN_ALL = /\p{sc=Han}/gu, LATIN_ALL = /\p{sc=Latin}/gu;
export const ASK_RE = {                  // 明确在问"怎么说 / 什么意思"（用哪种语言问都算提问）
  en: /\b(how (do|would|can) (you|i|we) (say|write|call|pronounce)|what (does|do|is)\b.{0,40}\bmean|what is .{1,40} in (german|english|chinese|french)|what'?s the difference)\b/i,
  de: /\b(wie (sagt|schreibt|nennt) man|was (bedeutet|heißt)|was ist der unterschied)\b/i,
  zh: /(怎么说|怎么讲|怎么表达|什么意思|有什么区别|用(德语|英语|中文|汉语|法语)怎么)/,
  fr: /(comment (dit-on|on dit|dire|traduire)|que (veut|signifie) dire|qu['’]est-ce que .{1,40} veut dire|quelle est la différence)/i,
};
export const FN_WORDS = {                // 各语言最常见、又不会出现在另一种语言里的小词
  en: /\b(the|is|are|was|were|how|what|you|do|does|can|to|of|and|it|this|that|with|my|i'm)\b/gi,
  de: /\b(der|die|das|ist|sind|und|nicht|ich|du|wie|was|mit|ein|eine|auf|zu|es|sich|mein|bin)\b/gi,
  fr: /(?:^|[^\p{L}'’])(le|la|les|un|une|des|du|est|sont|et|je|tu|il|elle|nous|vous|ils|pas|que|qui|dans|pour|avec|ce|cette|mon|ma|c['’]est|j['’]ai)(?![\p{L}])/giu,
};
export const count = (text, re) => (text.match(re) || []).length;
export const ACCENTS = { de: /[äöüß]/gi, fr: /[éèêàçùâîôûœë]/gi };
export const langScore = (text, code) => count(text, FN_WORDS[code]) + (ACCENTS[code] ? count(text, ACCENTS[code]) : 0);
export const asksHowToSay = text => Object.values(ASK_RE).some(re => re.test(text));
export function detectIntent(text, pending, learn = LANG.learn, explain = LANG.explain) {
  const practice = pending && learn !== explain ? 'translate' : 'chat';
  if (asksHowToSay(text)) return 'ask';
  if (learn === explain) return 'chat';                                   // 同一种语言：只有上面那种明确的提问才算
  const han = count(text, HAN_ALL), latin = count(text, LATIN_ALL);
  if (learn === 'zh') return han && han >= latin / 3 ? practice : 'ask';  // 学中文：主要是汉字才算在练习
  if (han) return 'ask';                                                  // 学德语 / 英语 / 法语时出现汉字：提问
  const mine = langScore(text, learn);                                    // 这几种拉丁字母语言之间：数各自的常用小词
  const theirs = Math.max(...['de', 'en', 'fr'].filter(c => c !== learn).map(c => langScore(text, c)));
  return theirs >= 2 && theirs > mine ? 'ask' : practice;
}

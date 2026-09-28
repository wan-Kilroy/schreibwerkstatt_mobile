/* The model API used by the page (llmApi) and the switch between real model and demo data (api) */
import { squash } from './dom.js';
import { EN_NAME, LANG, lname, t } from './i18n.js';
import { CFG } from './config.js';
import { normalizeAnalysis } from './diff.js';
import { conn, llmChat, llmJSON } from './llm.js';
import { ANY_TOPIC, PROMPTS_SCHEMA, PROMPT_BATCH, SUMMARY_SCHEMA, analysisSchema, focusList, giveUpSchema, sysAnalyze, sysAsk, sysChat, sysExplain, sysGiveUp, sysOpener, sysPrompts, sysSummary } from './prompts.js';
import { cleanWords } from './zh.js';
import { generateSentences, pickSrc, srcLangOk, topicFilter } from './exercises.js';
import { splitPy, zhReply } from './zh.js';
import { mockApi } from './mock.js';
import { connect } from './settings.js';
import { db } from './db.js';
import { recentSummaries } from './practice.js';

/* ---------- 真实接口：调用设置里选的模型 ---------- */
export const llmApi = {
  /* 一批候选句，返回 [{ zh, focus }]（zh = 原句，用讲解语言写）。local：本地词面去重（省 token，覆盖最近 30 题）；summary：旧方式 */
  async newPrompts({ topic, used, recent, n = PROMPT_BATCH }) {
    if (CFG.topicDedupe === 'local' && db.enabled) {
      let cd = null;
      try { await db.q; cd = await db.req('GET', `/topics/cooldown?k=40&lang=${LANG.learn}&explain=${LANG.explain}&level=${LANG.level}&topic=${encodeURIComponent(topic)}`); }
      catch (e) { console.warn('本地话题去重不可用，改用旧方式：', e); }
      if (cd) return this.newPromptsLocal({ topic, n, cd });
    }
    return this.newPromptsSummary({ topic, used, recent: recent || await recentSummaries(), n });
  },
  async newPromptsSummary({ topic, used, recent, n }) {
    let list = focusList();
    if (db.enabled) { try { const r = await db.req('GET', `/foci?lang=${LANG.learn}&level=${LANG.level}`); if (r.foci && r.foci.length) list = r.foci; } catch { /* 用内置清单 */ } }
    const foci = [...list].sort(() => Math.random() - 0.5).slice(0, n);
    const avoid = [...recent, ...used.map(z => 'Sentence: ' + z)].slice(-24);
    const E = EN_NAME[LANG.explain], L = EN_NAME[LANG.learn];
    const base = `Topic: ${topic || ANY_TOPIC}\nWrite ${n} ${E} sentences (not ${L}), one per ${L} grammar focus:\n${foci.map((f, i) => `${i + 1}. ${f}`).join('\n')}\nAvoid repeating these recent topics and sentences:\n${avoid.length ? avoid.map(a => '- ' + a).join('\n') : '- (none)'}`;
    let wrong = 0;
    for (const strict of [false, true]) {                           // 全是错的语言时，带着提醒再要一次
      const user = base + (strict ? `\nYour previous sentences were written in ${L}. This is wrong: write every sentence in ${E}.` : '');
      const j = await llmJSON(sysPrompts(), user, PROMPTS_SCHEMA, { temperature: 0.9, tag: strict ? 'prompts_retry' : 'prompts' });
      const out = [];
      for (const it of Array.isArray(j.sentences) ? j.sentences : []) {
        const zh = pickSrc(it);
        if (!zh) continue;
        if (!srcLangOk(zh)) { wrong++; continue; }
        if (!out.some(o => o.zh === zh) && !used.includes(zh)) out.push({ zh, focus: null });
      }
      if (out.length) return out;
      if (!wrong) break;
    }
    throw new Error(wrong ? t('wrongSrcLang', { E: lname(LANG.explain), L: lname(LANG.learn) }) : t('noSentence'));
  },
  /* 冷却词来自 server.py 的 /api/topics/cooldown；多要 OVERGENERATE 句，过滤后不足 MIN_KEEP 句才针对缺口重试（最多 MAX_RETRIES 次） */
  async newPromptsLocal({ topic, n, cd }) {
    const T = cd.config || {};
    const over = T.OVERGENERATE ?? 2, minKeep = T.MIN_KEEP ?? 3, retries = T.MAX_RETRIES ?? 1, capWords = (T.MAX_HINT_WORDS ?? 20) + 10;
    let words = cd.words || [];
    let asked = (cd.foci || []).slice(0, n + over);
    if (!asked.length) asked = [...focusList()].sort(() => Math.random() - 0.5).slice(0, n + over);
    const kept = [], seen = [];
    let strict = false, wrongLang = 0;
    for (let round = 1; ; round++) {
      const cands = await generateSentences({ topic, foci: asked, words, strict, tag: round === 1 ? 'prompts' : 'prompts_retry' });
      wrongLang += cands.wrongFoci.length;
      strict = strict || cands.wrongFoci.length > 0;                 // 有写错语言的：重试时明确提醒
      seen.push(...cands);
      const f = cands.length ? await topicFilter(cands, kept.map(k => k.zh), topic, false, round) : { kept: [], dropped: [] };
      kept.push(...f.kept);
      if (kept.length >= minKeep || round > Math.max(retries, strict ? 1 : 0)) break;
      const again = [...f.dropped.map(d => d.focus), ...cands.wrongFoci].filter(Boolean);
      asked = (again.length ? again : asked).slice(0, Math.max(1, n - kept.length));
      words = [...new Set([...words, ...f.dropped.flatMap(d => d.hit_words || [])])].slice(0, capWords);
    }
    let out = kept;
    if (!out.length && seen.length) out = (await topicFilter(seen, [], topic, true, 0)).kept;   // 一句都不剩：放行命中最少的一句
    if (!out.length) throw new Error(wrongLang ? t('wrongSrcLang', { E: lname(LANG.explain), L: lname(LANG.learn) }) : t('noSentence'));
    return out.map(k => ({ zh: k.zh, focus: k.focus || null }));
  },
  async analyze({ intent, text, zh }) {
    const user = intent === 'translate' ? `Task: translate\nSource (${EN_NAME[LANG.explain]}): ${zh}\nStudent: ${text}` : `Task: chat\nStudent: ${text}`;
    const j = await llmJSON(sysAnalyze(), user, analysisSchema(), { temperature: 0.2, tag: 'analyze' });
    return normalizeAnalysis(j, text, intent);
  },
  /* 我不会：参考译文 + 说明；结果和纠错一样存（算没做对，错误类型「不会」） */
  async giveUp({ zh, focus }) {
    const j = await llmJSON(sysGiveUp(focus), `Source (${EN_NAME[LANG.explain]}): ${zh}`, giveUpSchema(), { temperature: 0.3, tag: 'giveup' });
    const corrected = squash(j.translation);
    if (!corrected) throw new Error(t('noAnswer'));
    return giveUpResult(corrected, squash(j.note), LANG.learn === 'zh' ? cleanWords(j.words, corrected) : null);
  },
  async chatReply({ session, topic }) {
    const hist = session.messages
      .filter(m => (m.role === 'user' && m.kind === 'chat') || (m.role === 'assistant' && m.kind === 'reply'))
      .slice(-6).map(m => ({ role: m.role, content: splitPy(m.content).text }));          // 拼音行不发回去，省 token
    const msgs = [{ role: 'system', content: sysChat(topic) }, ...hist];
    if (LANG.learn === 'zh') return zhReply(msgs, { temperature: 0.8, tag: 'chat' });
    return (await llmChat(msgs, { temperature: 0.8, tag: 'chat' })).trim();
  },
  async ask({ text }) {
    return (await llmChat([{ role: 'system', content: sysAsk() }, { role: 'user', content: text }], { temperature: 0.3, tag: 'ask' })).trim();
  },
  async explain(m) {
    if (m.gaveUp) {
      const u = `Source (${EN_NAME[LANG.explain]}): ${m.zh}\nTranslation: ${m.corrected}\nThe student could not translate this sentence. Explain step by step how the translation is built.`;
      return (await llmChat([{ role: 'system', content: sysExplain() }, { role: 'user', content: u }], { temperature: 0.3, tag: 'explain' })).trim();
    }
    const user = `Student's sentence: ${m.content}\nCorrected: ${m.corrected}\n${m.better ? 'Better: ' + m.better + '\n' : ''}${m.zh ? `Source (${EN_NAME[LANG.explain]}): ${m.zh}\n` : ''}`;
    return (await llmChat([{ role: 'system', content: sysExplain() }, { role: 'user', content: user }], { temperature: 0.3, tag: 'explain' })).trim();
  },
  async opener(topic) {
    const msgs = [{ role: 'system', content: sysOpener(topic) }, { role: 'user', content: 'Start.' }];
    if (LANG.learn === 'zh') return zhReply(msgs, { temperature: 0.9, tag: 'opener' });
    return (await llmChat(msgs, { temperature: 0.9, tag: 'opener' })).trim();
  },
  async summarize(s) {
    const tag = { prompt: 'exercise', translate: 'student translation', chat: 'student', ask: 'question', reply: 'AI', answer: 'AI' };
    const own = s.messages.filter(m => m.kind !== 'reply' && m.kind !== 'answer');      // AI 的长回复不发，省 token；一句学生的话都没有时才退回全部
    const text = (own.length ? own : s.messages).map(m => (m.gaveUp ? '[student could not translate the exercise]' : `[${tag[m.kind] || m.kind}] ${m.content}`)).join('\n').slice(0, 3000);
    const j = await llmJSON(sysSummary(), text, SUMMARY_SCHEMA, { temperature: 0.3, tag: 'summary' });
    return { title: squash(j.title) || t('untitled'), summary: squash(j.summary) };
  },
};

export const giveUpResult = (corrected, note, words) => ({ isCorrect: false, corrected, meaning: 'ok', brief: note, better: '', betterNote: '',
  diff: null, words: words || null, betterWords: null, studentWords: null, errors: ['gave_up'], gaveUp: true });

/* 按连接状态选择接口。没连上模型时直接报错（不会假装检查）；每次操作前会自动重连一次，所以中途再启动 Ollama、或改好设置都行 */
export const api = new Proxy({}, { get: (_, k) => async (...args) => {
  if (conn.mode === 'offline') await connect();
  if (conn.mode === 'offline') { const e = new Error(conn.note); e.net = true; throw e; }
  return (conn.mode === 'online' ? llmApi : mockApi)[k](...args);
} });

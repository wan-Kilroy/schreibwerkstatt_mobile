/* Demo mode: canned answers and sample history */
import { daysAgo, normEnd, rnd, sleep, uid } from './dom.js';
import { LANG, quote, t } from './i18n.js';
import { normalizeAnalysis, tokenize } from './diff.js';
import { conn } from './llm.js';
import { PROMPT_BATCH } from './prompts.js';
import { state } from './state.js';

/* =====================================================================
 * 模拟接口（只有在设置里主动选择时才用，接口和 llmApi 完全一致）
 * ===================================================================== */
export const PROMPTS = [
  { zh: '虽然天气不好，我们还是去爬山了。', de: 'Obwohl das Wetter schlecht war, sind wir wandern gegangen.' },
  { zh: '请问去火车站怎么走？', de: 'Entschuldigung, wie komme ich zum Bahnhof?' },
  { zh: '我已经等这辆公交车二十分钟了。', de: 'Ich warte schon seit zwanzig Minuten auf diesen Bus.' },
  { zh: '如果我有更多时间，我会多学一点德语。', de: 'Wenn ich mehr Zeit hätte, würde ich mehr Deutsch lernen.' },
  { zh: '他问我明天是否有空。', de: 'Er hat mich gefragt, ob ich morgen Zeit habe.' },
  { zh: '这个周末我想去慕尼黑看展览。', de: 'Dieses Wochenende möchte ich nach München fahren, um eine Ausstellung zu sehen.' },
  { zh: '你能帮我检查一下这份申请材料吗？', de: 'Kannst du meine Bewerbungsunterlagen bitte kurz prüfen?' },
  { zh: '由于生病，他昨天没来上课。', de: 'Wegen einer Krankheit ist er gestern nicht zum Unterricht gekommen.' },
];
/* 其他语言组合的演示题（原句用讲解语言） */
export const MOCK_SRC = {
  en: ['This weekend I want to go to Munich to see an exhibition.', 'I have been waiting for this bus for twenty minutes.', 'Could you check my application documents?', 'If I had more time, I would read more books.'],
  de: ['Ich lerne seit zwei Jahren Chinesisch.', 'Letztes Wochenende habe ich drei Bücher aus der Bibliothek ausgeliehen.', 'Kannst du mir helfen, die Bewerbung zu prüfen?', 'Wenn ich mehr Zeit hätte, würde ich mehr lesen.'],
  zh: ['上周末我去了图书馆，借了三本书。', '我已经等这辆公交车二十分钟了。', '如果我有更多时间，我会多看书。', '你能帮我检查一下这份申请材料吗？'],
};
export const mockSources = () => (LANG.learn === 'de' && LANG.explain === 'zh' ? PROMPTS.map(p => p.zh) : MOCK_SRC[LANG.explain]);
export const MOCK_RULES = {
  de: [
    [/Wohenende/, 'Wochenende', 'Wochenende 拼写错误。'],
    [/\bdiese Wochenende\b/, 'dieses Wochenende', 'Wochenende 是中性名词，用 dieses。'],
    [/\bim (München|Berlin|Freising|Hamburg)\b/, 'in $1', '城市名前用 in，不用 im。'],
    [/\bein Kaffee\b/, 'einen Kaffee', 'Kaffee 是阳性，第四格用 einen。'],
    [/\bwarte für\b/, 'warte auf', 'warten 固定搭配 auf + 第四格。'],
    [/\bmit der (Freund|Bus|Zug|Vermieter)\b/, 'mit dem $1', 'mit 后面接第三格，阳性名词用 dem。'],
    [/\bweil ich habe (.+?)([.!?]|$)/i, 'weil ich $1 habe$2', 'weil 引导从句，变位动词放句末。'],
    [/\bIch habe gegangen\b/, 'Ich bin gegangen', 'gehen 的完成时用 sein。'],
  ],
  en: [
    [/\bI have gone to\b/, 'I went to', '(demo) simple past with a finished time'],
    [/\bthree book\b/, 'three books', '(demo) plural after three'],
    [/\bhe go\b/, 'he goes', '(demo) third person -s'],
  ],
  fr: [
    [/\bj['’]ai allé\b/, 'je suis allé', '(démo) aller + être'],
    [/\bà le\b/, 'au', '(démo) à + le = au'],
    [/\btrois livre\b/, 'trois livres', '(démo) pluriel'],
  ],
  zh: [
    [/学习了中文两年/, '学习了两年中文', '（演示）时量补语放在宾语前面。'],
    [/三个书/, '三本书', '（演示）书的量词是"本"。'],
    [/我很喜欢吃饭在食堂/, '我很喜欢在食堂吃饭', '（演示）地点状语放在动词前面。'],
  ],
};
export const MOCK_PINYIN = { '我学习了两年中文。': 'Wǒ xuéxíle liǎng nián Zhōngwén.', '我学习了两年中文': 'Wǒ xuéxíle liǎng nián Zhōngwén',
  '我借了三本书。': 'Wǒ jièle sān běn shū.', '我很喜欢在食堂吃饭。': 'Wǒ hěn xǐhuan zài shítáng chīfàn.' };
export const REPLIES = {
  de: ['Interessant! Erzähl mir mehr darüber. Was hast du am Wochenende gemacht?', 'Gern! Möchtest du auch etwas essen oder nur etwas trinken?',
    'Das klingt gut. Und wie geht es dir sonst so?', 'Verstehe. Hast du dafür schon Pläne für nächste Woche?'],
  fr: ['Intéressant ! Qu’est-ce que tu as fait ce week-end ?', 'Avec plaisir ! Tu veux aussi manger quelque chose ?', 'Ça a l’air bien. Et sinon, comment ça va ?'],
  en: ['Interesting! Tell me more. What did you do at the weekend?', 'Sure! Would you like something to eat as well?', 'Sounds good. How are things otherwise?'],
  zh: [{ text: '真有意思！你周末做了什么？', words: [['真', 'zhēn'], ['有意思', 'yǒu yìsi'], ['！', ''], ['你', 'nǐ'], ['周末', 'zhōumò'], ['做', 'zuò'], ['了', 'le'], ['什么', 'shénme'], ['？', '']] },
    { text: '好啊！你还想吃点儿什么吗？', words: [['好', 'hǎo'], ['啊', 'a'], ['！', ''], ['你', 'nǐ'], ['还', 'hái'], ['想', 'xiǎng'], ['吃', 'chī'], ['点儿', 'diǎnr'], ['什么', 'shénme'], ['吗', 'ma'], ['？', '']] }],
};
export let replyIdx = 0;

export function mockAnalyze(intent, text, zh, learn = LANG.learn, explain = LANG.explain) {
  let corrected = text; const briefs = [];
  for (const [re, rep, b] of MOCK_RULES[learn]) if (re.test(corrected)) { corrected = corrected.replace(re, rep); briefs.push(b); }
  let meaning = 'ok', better = '', betterNote = '';
  if (intent === 'translate' && learn === 'de' && explain === 'zh') {
    const ref = (PROMPTS.find(p => p.zh === zh) || {}).de || '';
    const a = new Set(tokenize(text).map(t => t.t.toLowerCase())), r = tokenize(ref).map(t => t.t.toLowerCase());
    const overlap = r.length ? r.filter(t => a.has(t)).length / r.length : 1;
    if (ref && overlap < 0.3) { meaning = 'off'; corrected = ref; briefs.length = 0; briefs.push('（模拟）译文和原句的意思差得比较远。'); }
    else if (ref && normEnd(corrected).toLowerCase() !== normEnd(ref).toLowerCase()) { better = ref; betterNote = '（模拟）参考写法，句型更地道。'; }
  }
  const brief = briefs.join(' ');
  return normalizeAnalysis({ corrected, better, better_note: betterNote, brief, meaning, pinyin: MOCK_PINYIN[corrected] || (learn === 'zh' ? '(pinyin)' : '') }, text, intent);
}
export function mockAsk(text) {
  if (LANG.learn === 'de' && /报销|Erstattung|reimburs/i.test(text))
    return '「报销」常见的德语说法：\n» die Erstattung\n» die Kostenerstattung\n\nErstattung 是通用说法；Kostenerstattung 更强调"费用被退还"，申请报销时更常见。';
  if (LANG.learn === 'zh') return '(demo)\n» 押金 (yājīn)\n» 保证金 (bǎozhèngjīn)\n\n押金 is the usual word for a rental deposit.';
  return '(demo)\n» …\n» …\n\n1-3 expressions and how they differ.';
}
export function countKinds(s) {
  if (s.counts) return s.counts;          // 来自数据库的列表行已经带统计
  return s.messages.reduce((c, m) => { if (m.role === 'user') c[m.kind]++; return c; }, { translate: 0, chat: 0, ask: 0 });
}

export const mockApi = {
  async newPrompts({ used, n = PROMPT_BATCH }) {
    await sleep(rnd(450, 800));
    const all = mockSources(), pool = all.filter(z => !used.includes(z));
    return (pool.length ? pool : all).sort(() => Math.random() - 0.5).slice(0, n).map(zh => ({ zh, focus: null }));
  },
  async analyze({ intent, text, zh }) { await sleep(rnd(600, 1100)); return mockAnalyze(intent, text, zh); },
  async giveUp({ zh }) { await sleep(rnd(500, 900)); const { giveUpResult } = await import('./api.js'); return giveUpResult('(demo) ' + zh, '(demo)', null); },
  async chatReply() { await sleep(rnd(400, 800)); const r = REPLIES[LANG.learn]; return r[replyIdx++ % r.length]; },
  async ask({ text }) { await sleep(rnd(600, 1000)); return mockAsk(text); },
  async explain(m) {
    await sleep(rnd(700, 1200));
    const lines = ['(demo) ' + t('explainBtn') + ':', ''];
    if (m.diff) m.diff.changes.forEach(c => lines.push(`• ${quote(c.from || '—')} → ${quote(c.to || '—')}`));
    if (m.brief) lines.push('', m.brief);
    if (m.better) lines.push('', t('rtBetter') + t('colon') + m.better);
    return lines.join('\n');
  },
  async opener(topic) {
    await sleep(rnd(500, 900));
    if (LANG.learn === 'en') return topic ? `Hi! Let's talk about “${topic}”. What comes to mind first?` : 'Hi! What would you like to talk about today?';
    if (LANG.learn === 'zh') return { text: '你好！今天你想聊什么？', words: [['你好', 'nǐ hǎo'], ['！', ''], ['今天', 'jīntiān'], ['你', 'nǐ'], ['想', 'xiǎng'], ['聊', 'liáo'], ['什么', 'shénme'], ['？', '']] };
    if (LANG.learn === 'fr') return topic ? `Salut ! Parlons de « ${topic} ». Qu’est-ce qui te vient à l’esprit ?` : 'Salut ! De quoi veux-tu parler aujourd’hui ?';
    return topic ? `Hallo! Lass uns über „${topic}“ sprechen. Was fällt dir dazu als Erstes ein?` : 'Hallo! Worüber möchtest du heute sprechen?';
  },
  async summarize(s) {                          // 也是模型生成失败时的临时标题（不存库）
    await sleep(1200);
    const c = countKinds(s), first = s.messages.find(m => m.role === 'user');
    return {
      title: [c.translate && `${t('k_translate')} ${c.translate}`, c.chat && `${t('k_chat')} ${c.chat}`, c.ask && `${t('k_ask')} ${c.ask}`].filter(Boolean).join(' · ') || t('untitled'),
      summary: first ? quote(first.content.slice(0, 24) + (first.content.length > 24 ? '…' : '')) : '',
    };
  },
};

/* ---------- 示例历史（仅模拟模式显示） ---------- */
export function seedHistory() {
  const P = (zh, st = 'answered') => ({ id: uid(), role: 'assistant', kind: 'prompt', content: zh, status: st });
  const U = (kind, text, zh) => Object.assign({ id: uid(), role: 'user', kind, content: text, zh }, kind === 'ask' ? {} : mockAnalyze(kind, text, zh, 'de', 'zh'));
  const R = (text, kind = 'reply') => ({ id: uid(), role: 'assistant', kind, content: text });
  const [p1, , p3, p4] = PROMPTS;
  const u1 = U('translate', 'Obwohl das Wetter schlecht war, wir sind gewandert.', p1.zh);
  u1.explanation = '（示例）obwohl 引导让步从句，从句里变位动词放句末；\n从句放在句首时，主句要"倒装"：变位动词排第一位，主语 wir 排第二位。\n\n例：Obwohl es regnet, gehen wir spazieren.\n例：Obwohl er müde war, sind wir noch ins Kino gegangen.';
  return [
    { id: uid(), seed: true, lang: 'de', explainLang: 'zh', title: '点餐对话 + 天气句子', summary: '练了 obwohl 从句的语序，模拟在咖啡馆点单，并问了"报销"的说法。',
      createdAt: daysAgo(1, 20, 15), endedAt: daysAgo(1, 20, 41), messages: [
        P(p1.zh), u1, U('chat', 'Ich möchte gern ein Kaffee bestellen.'), R('Gern! Möchten Sie auch etwas essen?'),
        U('chat', 'Nein danke, nur der Kaffee.'), U('ask', '"报销"用德语怎么说？'), R(mockAsk('报销'), 'answer')] },
    { id: uid(), seed: true, lang: 'de', explainLang: 'zh', title: '公交与等车', summary: '练了 warten auf 的介词搭配，以及 Konjunktiv II 的 wenn 从句。',
      createdAt: daysAgo(3, 9, 5), endedAt: daysAgo(3, 9, 22), messages: [
        P(p3.zh), U('translate', 'Ich warte seit zwanzig Minuten für diesen Bus.', p3.zh),
        P(p4.zh), U('translate', 'Wenn ich mehr Zeit hätte, würde ich mehr Deutsch lernen.', p4.zh)] },
    { id: uid(), seed: true, lang: 'de', explainLang: 'zh', title: '租房邮件相关提问', summary: '问了几个租房和邮件里的固定说法，写了一句给房东的话。',
      createdAt: daysAgo(6, 18, 30), endedAt: daysAgo(6, 18, 52), messages: [
        U('ask', 'how do you say "deposit" in a rental contract?'),
        R('租房合同里的"押金"：\n» die Kaution\n\nKaution 是最常用的说法，通常为三个月冷租金以内。', 'answer'),
        U('chat', 'Ich schreibe mit der Vermieter wegen der Heizung.'), R('Verstehe. Ist die Heizung schon lange kaputt?')] },
    { id: uid(), seed: true, lang: 'de', explainLang: 'zh', title: '周末计划与从句', summary: '聊了周末去慕尼黑看展览，纠正了 weil 从句的动词位置。',
      createdAt: daysAgo(10, 21, 0), endedAt: daysAgo(10, 21, 18), messages: [
        R('Hallo! Worüber möchtest du heute sprechen?'), U('chat', 'Ich gehe nicht aus, weil ich habe keine Zeit.'), R('Schade! Und was machst du stattdessen?')] },
  ];
}
export function applySeeds() {
  state.history = state.history.filter(s => !s.seed);
  if (conn.mode === 'mock') state.history.push(...seedHistory());
}

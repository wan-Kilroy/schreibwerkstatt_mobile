/* Languages (learning / explanation / level), interface texts in zh / en / de, t(), applyStaticText() */
import { $, h, pad } from './dom.js';
import { PRESETS } from './config.js';

export const fmtDate = d => ui() === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  : `${d.toLocaleDateString(LOCALE[ui()], { day: 'numeric', month: 'short' })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* =====================================================================
 * 语言（v0.2）：学习语言 LANG.learn、讲解语言 LANG.explain（= 题目句子和界面的语言）、水平 LANG.level
 *   t('key', {vars}) 取当前界面语言的文字；{name} 会被 vars 里同名的值替换
 * ===================================================================== */
export const LEARN_LANGS = ['de', 'en', 'zh', 'fr'];     // 可以学的语言
export const LANGS = ['de', 'en', 'zh'];                  // 讲解语言 = 界面语言
export const LEVEL_LIST = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const LANG = { learn: 'de', explain: 'zh', level: 'B2' };
export const NAMES = {                       // 语言名，按界面语言
  zh: { de: '德语', en: '英语', zh: '中文', fr: '法语' },
  en: { de: 'German', en: 'English', zh: 'Chinese', fr: 'French' },
  de: { de: 'Deutsch', en: 'Englisch', zh: 'Chinesisch', fr: 'Französisch' },
};
export const ABBR = { de: '德', en: '英', zh: '中', fr: '法' };              // 中文界面里的「中译德」这种简称
export const EN_NAME = { de: 'German', en: 'English', zh: 'Chinese (Mandarin, simplified characters)', fr: 'French' };   // 写给模型的语言名
export const LOCALE = { zh: 'zh-CN', en: 'en-GB', de: 'de-DE', fr: 'fr-FR' };
export const LOGO = { de: 'Ä', en: 'Aa', zh: '文', fr: 'É' };

export const I18N = {
  zh: {
    coach: '{L}写作教练', tabPractice: '练习', tabHistory: '历史', navPages: '页面', connecting: '连接中…',
    learnLbl: '学', explainLbl: '讲解', levelLbl: '水平', langAria: '语言和水平',
    langSwitched: '已切换：学{L}，用{E}讲解。上一个会话已结束。', langSame: '学{L}，也用{L}讲解：只有对话和提问，没有翻译题。',
    topicLbl: '话题', topicPh: '可空，例如：点餐、租房、天气',
    trName: '{S}译{T}', btnPrompt: '出一句{tr}', btnOpen: 'AI 开场', btnNew: '新会话', skip: '跳过', send: '发送',
    inputPh: '用{L}写一句话；也可以用{E}问「……{L}怎么说」', inputPhSame: '用{L}写一句话；也可以问「……怎么说」「……是什么意思」',
    hint: 'Enter 发送，Shift+Enter 换行 · 空着按 Enter = 带 ↵ 的按钮 · 自动识别：{L} = 译文 / 对话，其他语言 = 提问',
    hintSame: 'Enter 发送，Shift+Enter 换行 · {L} = 对话；问「怎么说 / 什么意思」= 提问',
    inputAria: '输入',
    btnStats: '统计', qPh: '搜索标题、总结或对话内容', qAria: '搜索历史', allLangs: '全部语言', histLangAria: '按学习语言筛选',
    backList: '← 返回列表', statsH: '练习统计',
    statsP: '每天一格，练了就涂色，颜色越深练得越多。鼠标移上去或点一下，看当天的详细数字。带浅边框的是每月 1 号。',
    rangeAria: '显示范围', half: '近半年', year: '近一年', less: '少', more: '多',
    delSession: '删除此会话', delConfirm: '再点一次确认删除',
    dlgTitle: '模型设置',
    noServerDlg: '没有连上 server.py：这里的设置没法保存，也没法连接模型。请用文件夹里的 run.bat 启动，再刷新本页。',
    provLbl: '接口类型', provOllama: 'Ollama（本机运行的模型）', provOpenai: 'OpenAI 兼容（OpenAI / 通义 / OpenRouter / Gemini …）', provAnthropic: 'Anthropic（Claude）',
    provDeepseek: 'DeepSeek',
    hDsBase: '接口地址', hDsHb: '一般不用改。程序会请求 {地址}/chat/completions。API Key 在 platform.deepseek.com 申请。',
    hDsHm: '推荐 deepseek-flash（便宜、快）；要更强可以用 deepseek-v4-pro。连接成功后输入框会列出可选模型。', hDsThink: '思考模式',
    thinkOffDs: '关闭（推荐：快、省钱）', thinkLowDs: 'low（开启思考）', thinkHintDs: 'DeepSeek 默认会先「思考」再回答，纠错这种短任务关掉更快更便宜；开启后回答可能更仔细，但要多等几秒。',
    presetLbl: '常用服务', presetHint: '只是帮你填好下面的地址；地址以服务商官方文档为准',
    presetQwen: '阿里云百炼（通义千问）', presetLms: 'LM Studio（本机）', presetCustom: '自定义地址',
    keyHint: '只保存在这台电脑的 settings.json 里，页面不会再显示它。不要把这个文件发给别人。', clear: '清除',
    modelLbl: '模型', modelPh: '模型名', thinkLbl: '推理强度', thinkLow: 'low（推荐，最快）', thinkHigh: 'high（最慢）', thinkOff: '不传该参数（不确定就选这个）',
    thinkHint: '只对支持「推理强度」的模型有效；服务商不认这个参数时，程序会自动去掉它重试。',
    srcLbl: '数据来源', srcAuto: '连接上面设置的模型（连不上会明确提示，不会假装检查）', srcMock: '只用模拟数据（仅调界面用，纠错结果是假的）',
    dedupeLbl: '出题去重方式', dedupeLocal: '本地词面比对（省 token，覆盖最近 30 题）', dedupeSummary: '把最近 10 个会话概要发给模型（旧方式）',
    dedupeHint: '本地方式在电脑上比对最近出过的题，命中重复话题词的句子会被丢弃；旧方式作为备用，随时可切回。',
    autosave: '修改会自动保存', testConn: '测试连接', done: '完成',
    hOllamaBase: 'Ollama 地址', hOllamaHb: '程序会请求 {地址}/api/chat。Ollama 装在别的电脑上时改这里。', hOllamaHm: '连接成功后，输入框会列出 Ollama 里已安装的模型。', hOllamaThink: '推理强度（gpt-oss 支持 low / medium / high）',
    hOpenaiBase: '接口地址', hOpenaiHb: '程序会请求 {地址}/chat/completions，地址一般以 /v1 结尾。', hOpenaiHm: '填服务商文档里的模型名；服务提供模型列表时，连接成功后输入框会列出可选模型。', hOpenaiThink: '推理强度（仅推理模型）',
    hAnthBase: '接口地址', hAnthHb: '一般不用改。程序会请求 {地址}/v1/messages。', hAnthHm: '填 Anthropic 文档里的模型名；连接成功后输入框会列出可选模型。',
    keySaved: '已保存（不显示）；留空表示不修改', keyPaste: '粘贴 API Key',
    connectedDot: '已连接。', saveFailed: '保存失败：', savingTesting: '正在保存并检测连接…', modelsAvail: '可用模型（{n}）：',
    savedOk: '✓ 已保存，连接正常。', savedMock: '已保存。现在是模拟模式。', savedNotReady: '已保存，但还不能用：', savedNoConn: '已保存，但没连上：', testing: '检测连接…',
    listSep: '、', q1: '「', q2: '」', colon: '：',
    noJson: '模型没有返回有效的 JSON', timeoutMsg: '模型响应超时。可以在设置里调低推理强度，或换一个更快的模型。',
    noServerNet: '没有连上 server.py（{e}）。请确认 run.bat 打开的黑色窗口还在运行。', netErr: '网络错误', serverErr: '服务器返回错误 {s}',
    noSentence: '模型没有生成句子', untitled: '未命名会话',
    wrongSrcLang: '模型出的句子是{L}的，不是{E}的，已经丢掉。再点一次试试；如果一直这样，可以换一个更大的模型。',
    mockNote: '当前是模拟模式（设置里选择的）：纠错和回复都是预设的演示数据。', noServerShort: '没有连上 server.py',
    noServerNote: '没有连上 server.py，所以没法连接模型，设置也没法保存。\n请双击文件夹里的 run.bat 启动（不要直接双击 index.html），启动后刷新本页。',
    statusMock: '模拟模式', notConnected: '未连接', bannerOff: '没有连上模型（{s}）：现在发送的内容不会被检查。点右上角看原因。',
    bannerMock: '模拟模式：下面的纠错和回复都是预设的演示数据，不是真实检查。', clickSettings: '点击打开设置',
    saveHistErr: '保存历史时出错：', dbMock: '模拟模式：不会保存历史。', dbNoServer: '没有连上 server.py：历史不会保存，设置也没法保存，模型也连不上。请用 run.bat 启动。', dbPath: '历史保存在本机文件：',
    generating: '生成中', generatingDots: '生成中…',
    rtFixedOff: '参考译文', rtFixed: '我的句子（改正后）', rtBetter: '更地道的写法', rtAria: '要敲哪一个', rtInput: '跟着敲', rtPh: '自己敲，Enter 检查（不能粘贴）',
    rtR1: '第 1 遍 · 看着答案，逐字敲一遍', rtR2: '第 2 遍 · 答案已遮住，凭记忆再敲一遍（点一下答案可以偷看，继续敲就会自动遮回去）',
    rtAllRight: '✓ 全对。', rtAgain: ' 遮住答案再默写一遍，记得更牢。', rtHide: '遮住再敲一遍', rtDone2: '✓ 默写正确，这句练完了。', rtEnterNext: '按 Enter 进入下一句。', rtNotYet: '还没敲完。',
    rtYouTyped: '你敲的', rtShould: '应为', rtNoPaste: '要自己敲，不能粘贴。',
    fbOff: '译文的意思和原句有出入{brief}。下面是参考译文。', fbOk: '语法没有发现错误', fbOrig: '你的原文', fbRef: '参考译文', fbFixed: '正确写法', fbHint: '点评', fbBetter: '更地道', fbPinyin: '拼音',
    explainBtn: '详细解释', explainHide: '收起解释', retyped: '已跟敲 {n} 次', retypeBtn: '跟着敲一遍', retypeHeavy: '跟着敲一遍（错得较多，建议）', retypeGiveUp: '跟着敲一遍（建议）', next: '下一句',
    notAnswered: '未回答', waiting: '等你翻译', answered: '已回答', skipped: '已跳过', promptLbl: '{tr} · 请翻译成{L}',
    oldServer: '后台 server.py 还是旧版本（只刷新了页面，没重启）：请关掉黑色窗口，重新双击 run.bat。',
    giveUp: '我不会', fbNote: '说明', noAnswer: '模型没有给出答案，请再试一次。',
    reportBtn: '题目有问题', reportAsk: '哪里有问题？', r_unnatural: '原句不自然', r_wrong: '原句有错', r_level: '难度不对', r_other: '其他', reported: '已报告', reportNext: '已记下，换一句。', reportThanks: '已记下。', reportFail: '没能记下：', cancel: '取消',
    k_translate: '译文', k_chat: '对话', k_ask: '提问', recognized: '识别为：',
    emptyH: '开始今天的练习', emptyP: '来一句{tr}，或者直接用{L}聊。每句话都会先在你自己的句子里改错。', emptyPSame: '直接用{L}聊。每句话都会先在你自己的句子里改错。',
    legend1: '· 输入{L}：有等待翻译的句子时算"译文"，否则算"对话"', legend1Same: '· 输入{L}：算"对话"',
    legend2: '· 输入其他语言：算"提问"，例如{ex}', legend2Same: '· 问「……怎么说」「……是什么意思」：算"提问"',
    askEx: '「"押金"用{L}怎么说」',
    legend3: '· 「正确写法」只改你句子里的错误；有明显更地道的说法时，才会另给一行「更地道」', legend4: '· 点「详细解释」才会生成语法讲解，之后再点直接显示',
    legendPy: '· 学中文时，改正后的句子和 AI 的回复会按词分开，拼音标在每个词的上方',
    loadingHint: '模型思考中；第一次调用要先加载模型，可能要等半分钟…', retry: '重试', openSettings: '打开设置', pendingBar: '等你翻译：',
    idleEnded: '距离上次操作已超过 30 分钟，上一个会话已自动结束。', emptySession: '当前会话还是空的', sessionEnded: '已结束会话，正在生成标题和总结',
    chipTr: '译文 {n}', chipChat: '对话 {n}', chipAsk: '提问 {n}', langChip: '{L} · {E}讲解',
    titleGen: '标题生成中', summaryGen: '总结生成中', liveSession: '进行中的会话', liveSummary: '会话结束后会自动生成标题和总结。',
    histFail: '读取历史失败：', found: '找到 {n} 个会话', total: '共 {n} 个会话', noMatch: '没有找到匹配的会话',
    noHistory: '还没有历史会话。练习几句、点「新会话」结束后，会出现在这里。', live: '进行中', metaLive: '（进行中）', msgs: '{n} 条消息',
    deleted: '已删除这个会话', delFail: '删除失败：',
    todayDone: '今日已练 {n} 句 · {w} {unit}', noToday: '今日还没有练习', totalS: '累计 {n} 句', statsFail: '读取统计失败：',
    fbTypes: '错误类型', reviewTag: '复习', reviewPass: '复习通过 ✓ 下次隔得更久再出现。', reviewDone: '这句已经掌握 ✓ 不再复习。',
    reviewAgain: '还有错，明天再复习这句。', reviewAdded: '翻译做错的句子会自动加入复习，明天起再出现。', reviewRemove: '不再复习', reviewRemoved: '已移出复习',
    errH: '常错类型（近 30 天）', errNone: '近 30 天还没有记录到错误类型（从这个版本开始记录）。', errSub: '{c} 句检查过的句子里，{x} 句有错', errTimes: '{n} 次',
    revH: '复习', revLine: '现在该复习 {d} 句 · 之后还有 {w} 句 · 已掌握 {m} 句',
    focH: '{L}语法点（{lv}）', focLine: '已练 {p} / {t} 个 · 最近一次做对 {g} 个', focHint: '绿色 = 最近一次做对，橙色 = 最近一次做错，灰色 = 还没练过。出题时大约每 5 题有 1 题复习低一级的语法点；C1 和 C2 共用一份清单。', focTip: '练了 {n} 次，做对 {ok} 次',
    revHint: '翻译做错的句子会在 1、3、7 天后再出现（出题时自动插进来，设了话题时不插）；连续做对 3 次就算掌握。',
    rangeHalf: '近半年：练了 {d} 天 · {s} 句 · {w} {unit}', rangeYear: '近一年：练了 {d} 天 · {s} 句 · {w} {unit}',
    perDay: '每天 {x} 句', dayAria: '{date}：{n} 句', todayMark: '（今天）', unitWords: '词', unitChars: '字',
    tSent: '句数', tSentSub: '译文 {a} · 对话 {b}', tWords: '词数', tChars: '字数', tWordsSub: '你写的{L}', tWordsAll: '所有语言', tOk: '一次写对', tRetyped: '跟着敲次数', tAsk: '提问次数', tSessions: '会话数',
    noPractice: '这天没有练习。', sentN: '句', dayN: '天', sessN: '个会话', msgN: '条消息',
    toastNoServer: '没有连上 server.py：设置和历史都不会保存。请用 run.bat 启动。', toastNoModel: '没有连上模型（{s}）：现在不会检查句子。点右上角看原因。',
  },
  en: {
    coach: '{L} writing coach', tabPractice: 'Practice', tabHistory: 'History', navPages: 'Pages', connecting: 'Connecting…',
    learnLbl: 'Learn', explainLbl: 'Explained in', levelLbl: 'Level', langAria: 'Languages and level',
    langSwitched: 'Switched: learning {L}, explained in {E}. The previous session has ended.', langSame: 'Learning {L} with explanations in {L}: chat and questions only, no translation exercises.',
    topicLbl: 'Topic', topicPh: 'optional, e.g. ordering food, flat hunting, weather',
    trName: '{S} → {T}', btnPrompt: 'Sentence to translate', btnOpen: 'AI starts', btnNew: 'New session', skip: 'Skip', send: 'Send',
    inputPh: 'Write a sentence in {L}, or ask in {E}: “How do you say … in {L}?”', inputPhSame: 'Write a sentence in {L}, or ask “How do you say …?” / “What does … mean?”',
    hint: 'Enter sends, Shift+Enter adds a line · Enter on an empty field = the button marked ↵ · {L} = translation / chat, other languages = question',
    hintSame: 'Enter sends, Shift+Enter adds a line · {L} = chat; “How do you say / What does … mean” = question',
    inputAria: 'Input',
    btnStats: 'Statistics', qPh: 'Search titles, summaries or messages', qAria: 'Search the history', allLangs: 'All languages', histLangAria: 'Filter by language learned',
    backList: '← Back to the list', statsH: 'Practice statistics',
    statsP: 'One square per day: coloured when you practised, darker means more. Hover over or tap a day for its numbers. Squares with a light frame are the 1st of a month.',
    rangeAria: 'Range', half: 'Last 6 months', year: 'Last 12 months', less: 'Less', more: 'More',
    delSession: 'Delete this session', delConfirm: 'Click again to delete',
    dlgTitle: 'Model settings',
    noServerDlg: 'Not connected to server.py: these settings cannot be saved and no model can be reached. Start the app with run.bat in its folder, then reload this page.',
    provLbl: 'Interface', provOllama: 'Ollama (model running on this computer)', provOpenai: 'OpenAI-compatible (OpenAI / Qwen / OpenRouter / Gemini …)', provAnthropic: 'Anthropic (Claude)',
    provDeepseek: 'DeepSeek',
    hDsBase: 'API address', hDsHb: 'Usually no need to change. The app calls {address}/chat/completions. Get an API key at platform.deepseek.com.',
    hDsHm: 'deepseek-flash is recommended (cheap, fast); deepseek-v4-pro is stronger. Once connected, the field lists the available models.', hDsThink: 'Thinking mode',
    thinkOffDs: 'off (recommended: fast and cheap)', thinkLowDs: 'low (thinking on)', thinkHintDs: 'DeepSeek “thinks” before answering by default. For short tasks like corrections, off is faster and cheaper; on can be more careful but takes a few seconds longer.',
    presetLbl: 'Common services', presetHint: 'Only fills in the address below; the provider’s documentation is what counts',
    presetQwen: 'Alibaba Cloud Model Studio (Qwen)', presetLms: 'LM Studio (this computer)', presetCustom: 'Custom address',
    keyHint: 'Stored only in settings.json on this computer; the page never shows it again. Do not send that file to anyone.', clear: 'Clear',
    modelLbl: 'Model', modelPh: 'model name', thinkLbl: 'Reasoning effort', thinkLow: 'low (recommended, fastest)', thinkHigh: 'high (slowest)', thinkOff: 'don’t send it (choose this if unsure)',
    thinkHint: 'Only for models that support a reasoning effort; if the service rejects it, the app retries without it.',
    srcLbl: 'Data source', srcAuto: 'Use the model set above (you are told clearly if it cannot be reached)', srcMock: 'Demo data only (for trying the interface; corrections are fake)',
    dedupeLbl: 'Avoiding repeated exercises', dedupeLocal: 'Compare words locally (saves tokens, covers the last 30 sentences)', dedupeSummary: 'Send the last 10 session summaries to the model (old way)',
    dedupeHint: 'The local way compares new sentences with recent ones on this computer and drops those that repeat a topic word; the old way stays available as a fallback.',
    autosave: 'Changes are saved automatically', testConn: 'Test connection', done: 'Done',
    hOllamaBase: 'Ollama address', hOllamaHb: 'The app calls {address}/api/chat. Change this if Ollama runs on another computer.', hOllamaHm: 'Once connected, the field lists the models installed in Ollama.', hOllamaThink: 'Reasoning effort (gpt-oss supports low / medium / high)',
    hOpenaiBase: 'API address', hOpenaiHb: 'The app calls {address}/chat/completions; the address usually ends in /v1.', hOpenaiHm: 'Use the model name from the provider’s documentation; if the service has a model list, the field lists it once connected.', hOpenaiThink: 'Reasoning effort (reasoning models only)',
    hAnthBase: 'API address', hAnthHb: 'Usually no need to change. The app calls {address}/v1/messages.', hAnthHm: 'Use a model name from Anthropic’s documentation; once connected, the field lists the available models.',
    keySaved: 'Saved (hidden); leave empty to keep it', keyPaste: 'Paste the API key',
    connectedDot: 'Connected.', saveFailed: 'Saving failed: ', savingTesting: 'Saving and testing the connection…', modelsAvail: 'Available models ({n}): ',
    savedOk: '✓ Saved, the connection works.', savedMock: 'Saved. Demo mode is on.', savedNotReady: 'Saved, but not usable yet:', savedNoConn: 'Saved, but not connected:', testing: 'Testing the connection…',
    listSep: ', ', q1: '“', q2: '”', colon: ': ',
    noJson: 'The model did not return valid JSON', timeoutMsg: 'The model did not answer in time. Try a lower reasoning effort in the settings, or a faster model.',
    noServerNet: 'Not connected to server.py ({e}). Check that the black window opened by run.bat is still running.', netErr: 'network error', serverErr: 'The server returned error {s}',
    noSentence: 'The model did not produce a sentence', untitled: 'Untitled session',
    wrongSrcLang: 'The model wrote the sentences in {L} instead of {E}, so they were dropped. Try again; if it keeps happening, try a larger model.',
    mockNote: 'Demo mode (chosen in the settings): corrections and replies are canned demo data.', noServerShort: 'server.py not reachable',
    noServerNote: 'Not connected to server.py, so no model can be reached and settings cannot be saved.\nStart the app by double-clicking run.bat in its folder (not index.html), then reload this page.',
    statusMock: 'Demo mode', notConnected: 'Not connected', bannerOff: 'No model connected ({s}): what you send now is not checked. Click the top right for details.',
    bannerMock: 'Demo mode: the corrections and replies below are canned demo data, not real checks.', clickSettings: 'Click to open the settings',
    saveHistErr: 'Error saving the history: ', dbMock: 'Demo mode: the history is not saved.', dbNoServer: 'Not connected to server.py: the history and settings are not saved and no model can be reached. Start the app with run.bat.', dbPath: 'The history is saved on this computer in: ',
    generating: 'Generating', generatingDots: 'Generating…',
    rtFixedOff: 'Reference translation', rtFixed: 'My sentence (corrected)', rtBetter: 'More natural version', rtAria: 'What to type', rtInput: 'Type it out', rtPh: 'Type it yourself, Enter checks (no pasting)',
    rtR1: 'Round 1 · copy the answer, letter by letter', rtR2: 'Round 2 · the answer is hidden: type it from memory (click the answer to peek; typing hides it again)',
    rtAllRight: '✓ All correct.', rtAgain: ' Hide the answer and write it once more from memory — it sticks better.', rtHide: 'Hide and type again', rtDone2: '✓ Right from memory — this one is done.', rtEnterNext: ' Press Enter for the next sentence.', rtNotYet: 'Not finished yet.',
    rtYouTyped: 'You typed', rtShould: 'Should be', rtNoPaste: 'Type it yourself — pasting is off.',
    fbOff: 'The meaning differs from the original{brief}. Below is a reference translation.', fbOk: 'No mistakes found', fbOrig: 'You wrote', fbRef: 'Reference', fbFixed: 'Correct', fbHint: 'Comment', fbBetter: 'More natural', fbPinyin: 'Pinyin',
    explainBtn: 'Explain', explainHide: 'Hide explanation', retyped: 'Typed out {n}×', retypeBtn: 'Type it out', retypeHeavy: 'Type it out (recommended: several mistakes)', retypeGiveUp: 'Type it out (recommended)', next: 'Next sentence',
    notAnswered: 'Not answered', waiting: 'Your turn', answered: 'Answered', skipped: 'Skipped', promptLbl: 'Translate into {L}',
    oldServer: 'The server (server.py) is still the old version: close the black window and double-click run.bat again.',
    giveUp: 'I don’t know', fbNote: 'Note', noAnswer: 'The model gave no answer. Please try again.',
    reportBtn: 'Problem with this sentence', reportAsk: 'What’s wrong?', r_unnatural: 'Sounds unnatural', r_wrong: 'Has a mistake', r_level: 'Wrong level', r_other: 'Other', reported: 'Reported', reportNext: 'Noted. Here is another one.', reportThanks: 'Noted.', reportFail: 'Could not save the report: ', cancel: 'Cancel',
    k_translate: 'Translation', k_chat: 'Chat', k_ask: 'Question', recognized: 'Recognised as: ',
    emptyH: 'Start today’s practice', emptyP: 'Get a sentence to translate, or just chat in {L}. Every sentence is corrected within your own wording first.', emptyPSame: 'Just chat in {L}. Every sentence is corrected within your own wording first.',
    legend1: '· Writing in {L}: a “translation” while a sentence is waiting, otherwise “chat”', legend1Same: '· Writing in {L}: “chat”',
    legend2: '· Writing in another language: a “question”, e.g. {ex}', legend2Same: '· “How do you say …?” / “What does … mean?”: a “question”',
    askEx: '“How do you say ‘deposit’ in {L}?”',
    legend3: '· “Correct” only fixes the mistakes in your own sentence; a “More natural” line appears only when there is a clearly better way to say it', legend4: '· The grammar explanation is made only when you click “Explain”; after that it opens instantly',
    legendPy: '· For Chinese, corrected sentences and the AI’s replies are split into words, with pinyin above each word',
    loadingHint: 'The model is thinking; the first call has to load it, which can take half a minute…', retry: 'Retry', openSettings: 'Open settings', pendingBar: 'To translate: ',
    idleEnded: 'More than 30 minutes since your last action: the previous session was ended automatically.', emptySession: 'This session is still empty', sessionEnded: 'Session ended; creating its title and summary',
    chipTr: 'Translations {n}', chipChat: 'Chat {n}', chipAsk: 'Questions {n}', langChip: '{L} · explained in {E}',
    titleGen: 'Creating title', summaryGen: 'Creating summary', liveSession: 'Session in progress', liveSummary: 'The title and summary are created when the session ends.',
    histFail: 'Could not read the history: ', found: '{n} {sessN} found', total: '{n} {sessN}', noMatch: 'No matching sessions',
    noHistory: 'No sessions yet. Practise a few sentences and click “New session”; they will show up here.', live: 'In progress', metaLive: ' (in progress)', msgs: '{n} {msgN}',
    deleted: 'Session deleted', delFail: 'Delete failed: ',
    todayDone: 'Today: {n} {sentN} · {w} {unit}', noToday: 'No practice yet today', totalS: 'Total {n} {sentN}', statsFail: 'Could not read the statistics: ',
    fbTypes: 'Error types', reviewTag: 'Review', reviewPass: 'Review passed ✓ It comes back after a longer break.', reviewDone: 'Mastered ✓ This one won’t come back.',
    reviewAgain: 'Not quite yet: this one comes back tomorrow.', reviewAdded: 'Sentences you translate wrongly come back for review, starting tomorrow.', reviewRemove: 'Remove from review', reviewRemoved: 'Removed from review',
    errH: 'Common mistakes (last 30 days)', errNone: 'No error types recorded in the last 30 days (recorded from this version on).', errSub: '{x} of {c} checked sentences had mistakes', errTimes: '{n}×',
    revH: 'Review', revLine: 'Due now: {d} · later: {w} · mastered: {m}',
    focH: '{L} grammar points ({lv})', focLine: 'Practised {p} of {t} · right the last time: {g}', focHint: 'Green = right the last time, orange = wrong the last time, grey = not practised yet. About one exercise in five revises the level below; C1 and C2 share one list.', focTip: '{n}×, right {ok}×',
    revHint: 'Sentences you translate wrongly come back after 1, 3 and 7 days (mixed into new exercises, not while a topic is set); right three times in a row = mastered.',
    rangeHalf: 'Last 6 months: {d} {dayN} · {s} {sentN} · {w} {unit}', rangeYear: 'Last 12 months: {d} {dayN} · {s} {sentN} · {w} {unit}',
    perDay: 'per day {x} sentences', dayAria: '{date}: {n} {sentN}', todayMark: ' (today)', unitWords: 'words', unitChars: 'characters',
    tSent: 'Sentences', tSentSub: 'translations {a} · chat {b}', tWords: 'Words', tChars: 'Characters', tWordsSub: 'you wrote in {L}', tWordsAll: 'all languages', tOk: 'Right first time', tRetyped: 'Typed out', tAsk: 'Questions', tSessions: 'Sessions',
    noPractice: 'No practice on this day.',
    toastNoServer: 'Not connected to server.py: settings and history are not saved. Start the app with run.bat.', toastNoModel: 'No model connected ({s}): sentences are not checked now. Click the top right for details.',
    sentN: 'sentences', sentN1: 'sentence', dayN: 'days', dayN1: 'day', sessN: 'sessions', sessN1: 'session', msgN: 'messages', msgN1: 'message', unitWords1: 'word', unitChars1: 'character',
  },
  de: {
    coach: 'Schreibtrainer {L}', tabPractice: 'Üben', tabHistory: 'Verlauf', navPages: 'Seiten', connecting: 'Verbinde…',
    learnLbl: 'Lernen', explainLbl: 'Erklärt auf', levelLbl: 'Niveau', langAria: 'Sprachen und Niveau',
    langSwitched: 'Umgestellt: {L} lernen, Erklärungen auf {E}. Die vorige Sitzung wurde beendet.', langSame: '{L} lernen mit Erklärungen auf {L}: nur Gespräch und Fragen, keine Übersetzungsaufgaben.',
    topicLbl: 'Thema', topicPh: 'optional, z. B. Essen bestellen, Wohnungssuche, Wetter',
    trName: '{S} → {T}', btnPrompt: 'Satz zum Übersetzen', btnOpen: 'KI fängt an', btnNew: 'Neue Sitzung', skip: 'Überspringen', send: 'Senden',
    inputPh: 'Schreib einen Satz auf {L} – oder frag auf {E}: „Wie sagt man … auf {L}?“', inputPhSame: 'Schreib einen Satz auf {L} – oder frag: „Wie sagt man …?“ / „Was bedeutet …?“',
    hint: 'Enter sendet, Umschalt+Enter neue Zeile · Enter bei leerem Feld = Knopf mit ↵ · {L} = Übersetzung / Gespräch, andere Sprachen = Frage',
    hintSame: 'Enter sendet, Umschalt+Enter neue Zeile · {L} = Gespräch; „Wie sagt man / Was bedeutet …“ = Frage',
    inputAria: 'Eingabe',
    btnStats: 'Statistik', qPh: 'Titel, Zusammenfassungen oder Nachrichten durchsuchen', qAria: 'Verlauf durchsuchen', allLangs: 'Alle Sprachen', histLangAria: 'Nach Lernsprache filtern',
    backList: '← Zurück zur Liste', statsH: 'Übungsstatistik',
    statsP: 'Ein Kästchen pro Tag: farbig, wenn du geübt hast, je dunkler desto mehr. Fahr mit der Maus darüber oder tippe darauf, um die Zahlen des Tages zu sehen. Kästchen mit hellem Rand sind jeweils der 1. des Monats.',
    rangeAria: 'Zeitraum', half: 'Letzte 6 Monate', year: 'Letzte 12 Monate', less: 'Weniger', more: 'Mehr',
    delSession: 'Sitzung löschen', delConfirm: 'Zum Löschen nochmal klicken',
    dlgTitle: 'Modell-Einstellungen',
    noServerDlg: 'Keine Verbindung zu server.py: Die Einstellungen können nicht gespeichert und kein Modell erreicht werden. Starte die App mit run.bat im Ordner und lade die Seite neu.',
    provLbl: 'Schnittstelle', provOllama: 'Ollama (Modell auf diesem Computer)', provOpenai: 'OpenAI-kompatibel (OpenAI / Qwen / OpenRouter / Gemini …)', provAnthropic: 'Anthropic (Claude)',
    provDeepseek: 'DeepSeek',
    hDsBase: 'API-Adresse', hDsHb: 'Muss meist nicht geändert werden. Die App ruft {Adresse}/chat/completions auf. Den API-Key gibt es auf platform.deepseek.com.',
    hDsHm: 'Empfohlen: deepseek-flash (günstig, schnell); stärker ist deepseek-v4-pro. Nach dem Verbinden listet das Feld die verfügbaren Modelle.', hDsThink: 'Denkmodus',
    thinkOffDs: 'aus (empfohlen: schnell und günstig)', thinkLowDs: 'low (Denken an)', thinkHintDs: 'DeepSeek „denkt“ standardmäßig vor der Antwort. Für kurze Aufgaben wie Korrekturen ist „aus“ schneller und günstiger; „an“ kann gründlicher sein, dauert aber ein paar Sekunden länger.',
    presetLbl: 'Häufige Dienste', presetHint: 'Füllt nur die Adresse unten aus; maßgeblich ist die Dokumentation des Anbieters',
    presetQwen: 'Alibaba Cloud Model Studio (Qwen)', presetLms: 'LM Studio (dieser Computer)', presetCustom: 'Eigene Adresse',
    keyHint: 'Wird nur in settings.json auf diesem Computer gespeichert; die Seite zeigt ihn nie wieder an. Schick diese Datei niemandem.', clear: 'Löschen',
    modelLbl: 'Modell', modelPh: 'Modellname', thinkLbl: 'Denkstufe', thinkLow: 'low (empfohlen, am schnellsten)', thinkHigh: 'high (am langsamsten)', thinkOff: 'nicht senden (im Zweifel diese Option)',
    thinkHint: 'Nur für Modelle mit einstellbarer Denkstufe; lehnt der Dienst den Parameter ab, versucht es die App ohne ihn.',
    srcLbl: 'Datenquelle', srcAuto: 'Das oben eingestellte Modell verwenden (ist es nicht erreichbar, siehst du das deutlich)', srcMock: 'Nur Demodaten (zum Ausprobieren der Oberfläche; Korrekturen sind nicht echt)',
    dedupeLbl: 'Wiederholte Aufgaben vermeiden', dedupeLocal: 'Lokaler Wortvergleich (spart Tokens, deckt die letzten 30 Sätze ab)', dedupeSummary: 'Die letzten 10 Sitzungszusammenfassungen ans Modell schicken (alte Methode)',
    dedupeHint: 'Lokal werden neue Sätze auf diesem Computer mit den letzten verglichen; Sätze mit einem wiederholten Themenwort fallen weg. Die alte Methode bleibt als Reserve.',
    autosave: 'Änderungen werden automatisch gespeichert', testConn: 'Verbindung testen', done: 'Fertig',
    hOllamaBase: 'Ollama-Adresse', hOllamaHb: 'Die App ruft {Adresse}/api/chat auf. Ändern, wenn Ollama auf einem anderen Computer läuft.', hOllamaHm: 'Nach dem Verbinden listet das Feld die in Ollama installierten Modelle.', hOllamaThink: 'Denkstufe (gpt-oss kennt low / medium / high)',
    hOpenaiBase: 'API-Adresse', hOpenaiHb: 'Die App ruft {Adresse}/chat/completions auf; die Adresse endet meist auf /v1.', hOpenaiHm: 'Modellname laut Dokumentation des Anbieters; hat der Dienst eine Modellliste, zeigt das Feld sie nach dem Verbinden.', hOpenaiThink: 'Denkstufe (nur Reasoning-Modelle)',
    hAnthBase: 'API-Adresse', hAnthHb: 'Muss meist nicht geändert werden. Die App ruft {Adresse}/v1/messages auf.', hAnthHm: 'Modellname laut Anthropic-Dokumentation; nach dem Verbinden listet das Feld die verfügbaren Modelle.',
    keySaved: 'Gespeichert (verborgen); leer lassen, um ihn zu behalten', keyPaste: 'API-Key einfügen',
    connectedDot: 'Verbunden.', saveFailed: 'Speichern fehlgeschlagen: ', savingTesting: 'Speichere und teste die Verbindung…', modelsAvail: 'Verfügbare Modelle ({n}): ',
    savedOk: '✓ Gespeichert, die Verbindung funktioniert.', savedMock: 'Gespeichert. Der Demomodus ist an.', savedNotReady: 'Gespeichert, aber noch nicht nutzbar:', savedNoConn: 'Gespeichert, aber keine Verbindung:', testing: 'Teste die Verbindung…',
    listSep: ', ', q1: '„', q2: '“', colon: ': ',
    noJson: 'Das Modell hat kein gültiges JSON geliefert', timeoutMsg: 'Das Modell hat nicht rechtzeitig geantwortet. Stell in den Einstellungen eine niedrigere Denkstufe ein oder nimm ein schnelleres Modell.',
    noServerNet: 'Keine Verbindung zu server.py ({e}). Prüfe, ob das schwarze Fenster von run.bat noch läuft.', netErr: 'Netzwerkfehler', serverErr: 'Der Server meldet Fehler {s}',
    noSentence: 'Das Modell hat keinen Satz erzeugt', untitled: 'Sitzung ohne Titel',
    wrongSrcLang: 'Das Modell hat die Sätze auf {L} statt auf {E} geschrieben, sie wurden verworfen. Versuch es nochmal; passiert das öfter, nimm ein größeres Modell.',
    mockNote: 'Demomodus (in den Einstellungen gewählt): Korrekturen und Antworten sind vorgefertigte Demodaten.', noServerShort: 'server.py nicht erreichbar',
    noServerNote: 'Keine Verbindung zu server.py – daher kein Modell und keine gespeicherten Einstellungen.\nStarte die App per Doppelklick auf run.bat im Ordner (nicht auf index.html) und lade dann die Seite neu.',
    statusMock: 'Demomodus', notConnected: 'Nicht verbunden', bannerOff: 'Kein Modell verbunden ({s}): Was du jetzt schickst, wird nicht geprüft. Details oben rechts.',
    bannerMock: 'Demomodus: Die Korrekturen und Antworten unten sind vorgefertigte Demodaten, keine echte Prüfung.', clickSettings: 'Klicken, um die Einstellungen zu öffnen',
    saveHistErr: 'Fehler beim Speichern des Verlaufs: ', dbMock: 'Demomodus: Der Verlauf wird nicht gespeichert.', dbNoServer: 'Keine Verbindung zu server.py: Verlauf und Einstellungen werden nicht gespeichert, kein Modell erreichbar. Starte die App mit run.bat.', dbPath: 'Der Verlauf wird auf diesem Computer gespeichert in: ',
    generating: 'Wird erstellt', generatingDots: 'Wird erstellt…',
    rtFixedOff: 'Referenzübersetzung', rtFixed: 'Mein Satz (korrigiert)', rtBetter: 'Natürlichere Version', rtAria: 'Was abtippen', rtInput: 'Abtippen', rtPh: 'Selbst tippen, Enter prüft (kein Einfügen)',
    rtR1: 'Runde 1 · Antwort Buchstabe für Buchstabe abtippen', rtR2: 'Runde 2 · Die Antwort ist verdeckt: aus dem Gedächtnis tippen (auf die Antwort klicken zum Spicken; beim Weitertippen wird sie wieder verdeckt)',
    rtAllRight: '✓ Alles richtig.', rtAgain: ' Antwort verdecken und noch einmal aus dem Gedächtnis schreiben – so bleibt es besser hängen.', rtHide: 'Verdecken und nochmal tippen', rtDone2: '✓ Aus dem Gedächtnis richtig – dieser Satz ist geschafft.', rtEnterNext: ' Enter drücken für den nächsten Satz.', rtNotYet: 'Noch nicht fertig.',
    rtYouTyped: 'Du hast getippt', rtShould: 'Richtig wäre', rtNoPaste: 'Selbst tippen – Einfügen ist aus.',
    fbOff: 'Die Bedeutung weicht vom Original ab{brief}. Unten steht eine Referenzübersetzung.', fbOk: 'Keine Fehler gefunden', fbOrig: 'Dein Text', fbRef: 'Referenz', fbFixed: 'Korrekt', fbHint: 'Hinweis', fbBetter: 'Natürlicher', fbPinyin: 'Pinyin',
    explainBtn: 'Erklären', explainHide: 'Erklärung ausblenden', retyped: '{n}× abgetippt', retypeBtn: 'Abtippen', retypeHeavy: 'Abtippen (empfohlen: mehrere Fehler)', retypeGiveUp: 'Abtippen (empfohlen)', next: 'Nächster Satz',
    notAnswered: 'Nicht beantwortet', waiting: 'Du bist dran', answered: 'Beantwortet', skipped: 'Übersprungen', promptLbl: 'Auf {L} übersetzen',
    oldServer: 'Der Server (server.py) läuft noch in der alten Version: Schließe das schwarze Fenster und starte run.bat neu.',
    giveUp: 'Weiß ich nicht', fbNote: 'Hinweis', noAnswer: 'Das Modell hat keine Antwort gegeben. Bitte versuch es noch einmal.',
    reportBtn: 'Problem mit dem Satz', reportAsk: 'Was stimmt nicht?', r_unnatural: 'Klingt unnatürlich', r_wrong: 'Enthält einen Fehler', r_level: 'Falsches Niveau', r_other: 'Anderes', reported: 'Gemeldet', reportNext: 'Notiert. Hier kommt ein anderer Satz.', reportThanks: 'Notiert.', reportFail: 'Meldung konnte nicht gespeichert werden: ', cancel: 'Abbrechen',
    k_translate: 'Übersetzung', k_chat: 'Gespräch', k_ask: 'Frage', recognized: 'Erkannt als: ',
    emptyH: 'Los geht’s mit dem Üben', emptyP: 'Lass dir einen Satz zum Übersetzen geben oder schreib einfach auf {L} drauflos. Jeder Satz wird zuerst in deiner eigenen Formulierung korrigiert.', emptyPSame: 'Schreib einfach auf {L} drauflos. Jeder Satz wird zuerst in deiner eigenen Formulierung korrigiert.',
    legend1: '· Text auf {L}: „Übersetzung“, solange ein Satz wartet, sonst „Gespräch“', legend1Same: '· Text auf {L}: „Gespräch“',
    legend2: '· Text in einer anderen Sprache: „Frage“, z. B. {ex}', legend2Same: '· „Wie sagt man …?“ / „Was bedeutet …?“: „Frage“',
    askEx: '„Wie sagt man ‚deposit‘ auf {L}?“',
    legend3: '· „Korrekt“ verbessert nur die Fehler in deinem eigenen Satz; „Natürlicher“ erscheint nur, wenn es deutlich idiomatischer geht', legend4: '· Die Grammatikerklärung entsteht erst beim Klick auf „Erklären“; danach öffnet sie sich sofort',
    legendPy: '· Bei Chinesisch werden korrigierte Sätze und die Antworten der KI in Wörter getrennt, mit Pinyin über jedem Wort',
    loadingHint: 'Das Modell denkt nach; beim ersten Aufruf muss es erst geladen werden, das kann eine halbe Minute dauern…', retry: 'Nochmal', openSettings: 'Einstellungen öffnen', pendingBar: 'Zu übersetzen: ',
    idleEnded: 'Seit über 30 Minuten keine Aktion: Die vorige Sitzung wurde automatisch beendet.', emptySession: 'Diese Sitzung ist noch leer', sessionEnded: 'Sitzung beendet; Titel und Zusammenfassung werden erstellt',
    chipTr: 'Übersetzungen {n}', chipChat: 'Gespräch {n}', chipAsk: 'Fragen {n}', langChip: '{L} · Erklärung auf {E}',
    titleGen: 'Titel wird erstellt', summaryGen: 'Zusammenfassung wird erstellt', liveSession: 'Laufende Sitzung', liveSummary: 'Titel und Zusammenfassung entstehen, wenn die Sitzung endet.',
    histFail: 'Verlauf konnte nicht gelesen werden: ', found: '{n} {sessN} gefunden', total: '{n} {sessN}', noMatch: 'Keine passenden Sitzungen',
    noHistory: 'Noch keine Sitzungen. Übe ein paar Sätze und klicke auf „Neue Sitzung“ – dann erscheinen sie hier.', live: 'Läuft', metaLive: ' (läuft)', msgs: '{n} {msgN}',
    deleted: 'Sitzung gelöscht', delFail: 'Löschen fehlgeschlagen: ',
    todayDone: 'Heute: {n} {sentN} · {w} {unit}', noToday: 'Heute noch nicht geübt', totalS: 'Insgesamt {n} {sentN}', statsFail: 'Statistik konnte nicht gelesen werden: ',
    fbTypes: 'Fehlerarten', reviewTag: 'Wiederholung', reviewPass: 'Wiederholung geschafft ✓ Der Satz kommt nach einer längeren Pause wieder.', reviewDone: 'Gemeistert ✓ Dieser Satz kommt nicht mehr.',
    reviewAgain: 'Noch nicht ganz: morgen kommt der Satz wieder.', reviewAdded: 'Falsch übersetzte Sätze kommen ab morgen zur Wiederholung.', reviewRemove: 'Nicht mehr wiederholen', reviewRemoved: 'Aus der Wiederholung entfernt',
    errH: 'Häufige Fehler (letzte 30 Tage)', errNone: 'In den letzten 30 Tagen wurden keine Fehlerarten erfasst (erst ab dieser Version).', errSub: '{x} von {c} geprüften Sätzen hatten Fehler', errTimes: '{n}×',
    revH: 'Wiederholung', revLine: 'Jetzt fällig: {d} · später: {w} · gemeistert: {m}',
    focH: 'Grammatikthemen {L} ({lv})', focLine: 'Geübt: {p} von {t} · zuletzt richtig: {g}', focHint: 'Grün = zuletzt richtig, orange = zuletzt falsch, grau = noch nicht geübt. Etwa jede fünfte Übung wiederholt die Stufe darunter; C1 und C2 teilen sich eine Liste.', focTip: '{n}×, davon {ok}× richtig',
    revHint: 'Falsch übersetzte Sätze kommen nach 1, 3 und 7 Tagen wieder (zwischen neuen Übungen, nicht solange ein Thema gesetzt ist); dreimal hintereinander richtig = gemeistert.',
    rangeHalf: 'Letzte 6 Monate: {d} {dayN} · {s} {sentN} · {w} {unit}', rangeYear: 'Letzte 12 Monate: {d} {dayN} · {s} {sentN} · {w} {unit}',
    perDay: 'pro Tag {x} Sätze', dayAria: '{date}: {n} {sentN}', todayMark: ' (heute)', unitWords: 'Wörter', unitChars: 'Zeichen',
    tSent: 'Sätze', tSentSub: 'Übersetzungen {a} · Gespräch {b}', tWords: 'Wörter', tChars: 'Zeichen', tWordsSub: 'auf {L} geschrieben', tWordsAll: 'alle Sprachen', tOk: 'Auf Anhieb richtig', tRetyped: 'Abgetippt', tAsk: 'Fragen', tSessions: 'Sitzungen',
    noPractice: 'An diesem Tag nicht geübt.',
    toastNoServer: 'Keine Verbindung zu server.py: Einstellungen und Verlauf werden nicht gespeichert. Starte die App mit run.bat.', toastNoModel: 'Kein Modell verbunden ({s}): Sätze werden gerade nicht geprüft. Details oben rechts.',
    sentN: 'Sätze', sentN1: 'Satz', dayN: 'Tage', dayN1: 'Tag', sessN: 'Sitzungen', sessN1: 'Sitzung', msgN: 'Nachrichten', msgN1: 'Nachricht', unitWords1: 'Wort', unitChars1: 'Zeichen',
  },
};
export const ui = () => LANG.explain;
export function t(key, vars) {
  const s = (I18N[ui()] && I18N[ui()][key]) ?? I18N.zh[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}
/* 模板里的 {x} 换成加粗的值，返回可以直接 append 的节点数组 */
/* 单复数（英语 / 德语）：pl(n, 'sentN') → sentence / sentences；中文没有单复数 */
export const pl = (n, key) => t(n === 1 && I18N[ui()][key + '1'] ? key + '1' : key);
export function tb(key, vars) {
  return t(key).split(/(\{\w+\})/).filter(Boolean).map(p => {
    const m = p.match(/^\{(\w+)\}$/);
    if (!m || !(m[1] in vars)) return p;
    return typeof vars[m[1]] === 'number' ? h('b', { text: String(vars[m[1]]) }) : String(vars[m[1]]);   // 数字加粗，单位 / 名词不加粗
  });
}
export const lname = (code, inUi = ui()) => NAMES[inUi][code];
export const same = () => LANG.learn === LANG.explain;
export const trName = (learn = LANG.learn, explain = LANG.explain) =>
  t('trName', { S: ui() === 'zh' ? ABBR[explain] : lname(explain), T: ui() === 'zh' ? ABBR[learn] : lname(learn) });
export const quote = s => t('q1') + s + t('q2');
export const isNoSpace = code => code === 'zh';            // 不用空格分词的语言：高亮按字对比，统计按字算

/* 页面上写死的文字：data-i18n（文字）、data-i18n-ph（placeholder）、data-i18n-aria（aria-label）、data-i18n-title */
export function applyStaticText() {
  document.documentElement.lang = LOCALE[ui()];
  document.documentElement.style.setProperty('--fbk', ui() === 'zh' ? '64px' : '96px');   // 纠错卡片左边标签列的宽度
  document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = t(n.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  const L = lname(LANG.learn), E = lname(LANG.explain);
  document.title = 'Schreibwerkstatt · ' + t('coach', { L });
  $('#brandSub').textContent = t('coach', { L });
  $('#logo').textContent = LOGO[LANG.learn];
  $('#btnPrompt').textContent = t('btnPrompt', { tr: trName() });
  $('#btnPrompt').hidden = same();
  $('#input').placeholder = t(same() ? 'inputPhSame' : 'inputPh', { L, E });
  $('#input').lang = LOCALE[LANG.learn];
  $('#composeHint').textContent = t(same() ? 'hintSame' : 'hint', { L });
  for (const [sel, list] of [['#selLearn', LEARN_LANGS], ['#selExplain', LANGS]])
    $(sel).replaceChildren(...list.map(c => h('option', { value: c, text: lname(c) })));
  $('#selLearn').value = LANG.learn; $('#selExplain').value = LANG.explain; $('#selLevel').value = LANG.level;
  const hl = $('#histLang'), keep = hl.value;
  hl.replaceChildren(h('option', { value: '', text: t('allLangs') }), ...LEARN_LANGS.map(c => h('option', { value: c, text: lname(c) })));
  hl.value = keep;
  $('#cfgPreset').replaceChildren(...PRESETS.map(([v, n, , k]) => h('option', { value: v, text: k ? t(k) : n })));
}

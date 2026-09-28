/* Settings as stored in data/settings.json (SET) and the active model profile (CFG) */
import { LANG, LANGS, LEARN_LANGS, LEVEL_LIST } from './i18n.js';

/* =====================================================================
 * 设置：保存在服务器端（data 文件夹里的 settings.json，API Key 也在那里，页面拿不到）
 *   SET = 服务器上的完整设置；CFG = 当前生效的那一套（active 接口的参数）
 * ===================================================================== */
export const PRESETS = [   // OpenAI 兼容服务的常见地址，只是帮忙填写；以服务商官方文档为准
  ['openai', 'OpenAI', 'https://api.openai.com/v1'],
  ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
  ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  ['qwen', '', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'presetQwen'],
  ['lmstudio', '', 'http://localhost:1234/v1', 'presetLms'],
  ['custom', '', '', 'presetCustom'],
];
export const SET = {
  active: 'ollama', source: 'auto', topicDedupe: 'local', file: '',
  labels: { ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek' },
  profiles: {
    ollama: { base: 'http://localhost:11434', model: 'gpt-oss:20b', think: 'low' },
    openai: { base: 'https://api.openai.com/v1', model: '', think: 'off', preset: 'openai', has_key: false },
    anthropic: { base: 'https://api.anthropic.com', model: '', think: 'off', has_key: false },
    deepseek: { base: 'https://api.deepseek.com', model: 'deepseek-flash', think: 'off', has_key: false },
  },
};
export const CFG = { provider: 'ollama', base: '', model: '', think: 'low', source: 'auto', topicDedupe: 'local', hasKey: false };
export function syncCfg() {
  const p = SET.profiles[SET.active];
  Object.assign(CFG, { provider: SET.active, base: p.base, model: p.model, think: p.think, source: SET.source, topicDedupe: SET.topicDedupe, hasKey: !!p.has_key });
}

export const MIRROR_KEY = 'schreibwerkstatt.cfg.v2', OLD_KEY = 'schreibwerkstatt.cfg.v1';
export function mirror() { try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ source: SET.source, lang: LANG })); } catch { /* 忽略 */ } }
export function applySettings(x) {
  SET.active = x.active; SET.source = x.source; SET.topicDedupe = x.topic_dedupe === 'summary' ? 'summary' : 'local'; SET.file = x.file || ''; if (x.labels) SET.labels = x.labels;
  if (LEARN_LANGS.includes(x.learn_lang)) LANG.learn = x.learn_lang;
  if (LANGS.includes(x.explain_lang)) LANG.explain = x.explain_lang;
  if (LEVEL_LIST.includes(x.level)) LANG.level = x.level;
  for (const k of Object.keys(x.profiles)) SET.profiles[k] = x.profiles[k];
  syncCfg(); mirror();
}


/* Wiring that ran when the page loaded (event listeners …); called once by main.js */
export function init_config() {
  syncCfg();
}

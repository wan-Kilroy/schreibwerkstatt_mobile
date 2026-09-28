/* Talking to the model through server.py: llmChat(), llmJSON(), connection state */
import { t, ui } from './i18n.js';

/* =====================================================================
 * 模型客户端：页面只和 server.py 说话（POST /api/llm/chat），由它按设置去调
 * Ollama / OpenAI 兼容服务 / Anthropic。API Key 只存在服务器那边。
 * ===================================================================== */
export const conn = { mode: 'offline', models: [], note: '', short: '', label: '', code: '' };   // mode: 'online'（已连接）| 'offline'（没连上）| 'mock'（用户主动选择的演示模式）
export const NO_RETRY = new Set(['network', 'timeout', 'auth', 'rate', 'config', 'notfound']);   // 这些错误换个请求方式也没用

export function netError(e) {
  const timeout = e && e.name === 'AbortError';
  const err = new Error(timeout ? t('timeoutMsg') : t('noServerNet', { e: (e && e.message) || t('netErr') }));
  err.net = true; err.kind = timeout ? 'timeout' : 'network'; return err;
}

export async function llmChat(messages, opts = {}) {
  const { schema = null, temperature = 0.2, timeoutMs = 180000, tag = '' } = opts;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs + 15000);
  let r;
  try {
    r = await fetch('/api/llm/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UI-Lang': ui() },
      body: JSON.stringify({ messages, temperature, schema, tag, timeout: Math.round(timeoutMs / 1000) }), signal: ctl.signal,
    });
  } catch (e) { throw netError(e); }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || t('serverErr', { s: r.status }));
    err.kind = j.kind || 'http'; err.net = err.kind === 'network' || err.kind === 'timeout'; throw err;
  }
  return j.content || '';
}

export function parseJSON(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch { /* 继续尝试截取 */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error(t('noJson'));
}
/* 先带 JSON Schema 约束请求；解析失败就去掉约束再试一次（部分模型的结构化输出不稳定；OpenAI 兼容服务会改用 json_object 模式） */
export async function llmJSON(system, user, schema, opts = {}) {
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
  let last;
  for (const useSchema of [true, false]) {
    try { return parseJSON(await llmChat(msgs, { ...opts, schema: useSchema ? schema : null })); }
    catch (e) { last = e; if (e.kind && NO_RETRY.has(e.kind)) throw e; }
  }
  throw last;
}

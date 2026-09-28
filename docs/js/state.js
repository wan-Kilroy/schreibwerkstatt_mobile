/* The page state: current session, pending exercise, open view */
import { uid } from './dom.js';
import { LANG } from './i18n.js';

/* =====================================================================
 * 状态
 * ===================================================================== */
export const newSessionObj = () => ({ id: uid(), dbId: null, title: '', summary: '', createdAt: new Date(), endedAt: null, messages: [],
  lang: LANG.learn, explainLang: LANG.explain, level: LANG.level });            // 一个会话的语言固定不变；换语言 = 新会话
export const state = { view: 'practice', session: newSessionObj(), pending: null, busy: false, history: [], openId: null, statsOpen: false, lastActivity: Date.now() };
export const nodes = new Map();      // message id -> DOM node（当前会话）

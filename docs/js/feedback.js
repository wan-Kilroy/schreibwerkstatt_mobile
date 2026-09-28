/* Rendering messages: correction card, detailed explanation, retype (跟着敲) */
import { $, h, normEnd, squash } from './dom.js';
import { LANG, LOCALE, lname, t, trName } from './i18n.js';
import { diffTokens } from './diff.js';
import { charFlags, cleanWords, pyLine, renderWords, segmentPlain } from './zh.js';
import { api } from './api.js';
import { state } from './state.js';
import { db } from './db.js';
import { giveUp, input, newPrompt, removeReview, reportPrompt, skipPrompt, updateEnterHint } from './practice.js';
import { errLabel } from './errors.js';

export function typingDots() { return h('span', { class: 'typing', 'aria-label': t('generating') }, h('i'), h('i'), h('i')); }

export function renderRich(text) {
  const box = h('div', { class: 'rich' });
  text.split('\n').forEach(line => {
    if (!line.trim()) box.append(h('div', { class: 'gap' }));
    else if (line.startsWith('» ')) box.append(h('div', { class: 'de-line', text: line.slice(2) }));
    else if (/^\s*PY\s*[:：]/i.test(line)) box.append(h('div', { class: 'py', text: line.replace(/^\s*PY\s*[:：]\s*/i, '') }));   // 学中文：AI 回复的拼音
    else box.append(h('div', { text: line }));
  });
  return box;
}
export function renderMarked(tokens, cls) {
  const w = h('span'); let mk = null;          // 连续的改动词合并成一个高亮块，避免标点前出现空隙
  tokens.forEach(k => {
    if (k.x) {
      if (!mk) { if (k.lead) w.append(k.lead); mk = h('mark', { class: cls }); w.append(mk); mk.append(k.t); }
      else mk.append((k.lead || '') + k.t);
    } else {
      mk = null;
      if (k.lead) w.append(k.lead);
      w.append(k.t);
    }
  });
  return w;
}
export const row = (k, v, extra) => h('div', { class: 'fb-row ' + (extra || '') }, h('div', { class: 'k', text: k }), h('div', { class: 'v' }, v));

/* 这句改了多少：0~1。译文意思偏了算 1；改动的词占整句 30% 以上、或有 3 处以上改动，就算"错得比较多" */
export function errorLoad(m) {
  if (m.meaning === 'off') return 1;
  if (!m.diff) return 0;
  const chg = Math.max(m.diff.orig.filter(t => t.x).length, m.diff.fixed.filter(t => t.x).length);
  return chg / Math.max(1, m.diff.orig.length, m.diff.fixed.length);
}
export const isHeavy = m => m.gaveUp || m.meaning === 'off' || !!(m.diff && (m.diff.changes.length >= 3 || errorLoad(m) >= 0.3));

/* 跟着敲：第 1 遍看着答案敲，第 2 遍遮住答案（这里和上面对话里的「正确写法 / 更地道」都会模糊）凭记忆敲。
   全程在本地逐字比对，不调用模型，也不能粘贴。有「更地道」时可以选敲哪一个。
   返回要放进面板的节点；onCount 每完成一遍调用一次，onClose 点「完成」时调用。 */
/* onNext：翻译题才有；第 2 遍默写正确后，默认按钮（按 Enter）就是「下一句」 */
export function buildRetype(m, onCount, onClose, onNext) {
  const opts = [{ key: 'fixed', label: t(m.meaning === 'off' ? 'rtFixedOff' : 'rtFixed'), text: squash(m.corrected), py: m.words ? '' : m.pinyin || '', words: m.words }];
  if (m.better) opts.push({ key: 'better', label: t('rtBetter'), text: squash(m.better), py: m.betterWords ? '' : m.betterPinyin || '', words: m.betterWords });
  const showTarget = o => { if (o.words) tg.replaceChildren(renderWords(o.words)); else tg.textContent = o.text; };   // 学中文：答案按词排开，拼音在上
  let target = opts[0].text;
  const head = h('div', { class: 'rt-head' });
  const seg = h('div', { class: 'rt-seg', role: 'group', 'aria-label': t('rtAria'), hidden: opts.length < 2 });
  const tg = h('div', { class: 'rt-target', lang: LOCALE[LANG.learn] });
  const tpy = h('div', { class: 'rt-py', text: opts[0].py, hidden: !opts[0].py });           // 学中文：答案下面的拼音（第 2 遍一起遮住）
  const inp = h('textarea', { class: 'rt-input', rows: '1', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', lang: LOCALE[LANG.learn], 'aria-label': t('rtInput'), placeholder: t('rtPh') });
  const msg = h('div', { class: 'rt-msg', 'aria-live': 'polite' });
  const acts = h('div', { class: 'rt-row' });
  let round = 1;
  const card = () => inp.closest('.fb');
  const setVeil = on => { tg.classList.toggle('veiled', on); tpy.classList.toggle('veiled', on); const c = card(); if (c) c.classList.toggle('veiled', on); };
  const grow = () => {                                        // 句子长就自动换行加高，不会有看不到的部分
    if (!inp.offsetParent) return;                            // 还没放进页面（或面板收起）时量不出高度，等显示出来再算，不然会被量成 0
    inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 2 + 'px';
  };
  const onResize = () => { if (inp.isConnected) grow(); else window.removeEventListener('resize', onResize); };
  window.addEventListener('resize', onResize);
  const show = () => requestAnimationFrame(() => inp.closest('.rt') && inp.closest('.rt').scrollIntoView({ block: 'nearest', behavior: 'smooth' }));   // 手机上别让面板被输入栏挡住
  /* m.rtStage：跟着敲走到哪一步了（输入框空回车按它决定下一步）：r1 第 1 遍 → r1done → r2 第 2 遍 → done */
  const stage = st => { m.rtStage = st; queueMicrotask(updateEnterHint); };
  const begin = r => {
    stage(r === 1 ? 'r1' : 'r2');
    round = r; acts.replaceChildren(); msg.textContent = ''; inp.value = ''; grow(); inp.disabled = false; inp.classList.remove('bad');
    head.textContent = t(r === 1 ? 'rtR1' : 'rtR2');
    setVeil(r === 2); inp.focus(); show();
  };
  seg.append(...opts.map(o => h('button', {
    class: 'btn sm', type: 'button', 'data-key': o.key, text: o.label, 'aria-pressed': String(o.text === target),
    onclick: () => { target = o.text; showTarget(o); tpy.textContent = o.py; tpy.hidden = !o.py; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === o.key))); begin(1); },
  })));
  const done = () => {
    m.retyped = (m.retyped || 0) + 1; db.updateMessage(m, { retyped: m.retyped }); onCount(m.retyped);
    inp.disabled = true; acts.replaceChildren();
    if (round === 1) {
      stage('r1done');
      msg.replaceChildren(h('span', { class: 'ok', text: t('rtAllRight') }), t('rtAgain'));
      acts.append(h('button', { class: 'btn sm primary', type: 'button', 'data-act': 'rt-hide', text: t('rtHide'), onclick: () => begin(2) }),
        h('button', { class: 'btn sm', type: 'button', text: t('done'), onclick: () => { setVeil(false); stage('done'); onClose(); } }));
    } else {
      stage('done');
      setVeil(false);
      msg.replaceChildren(h('span', { class: 'ok', text: t('rtDone2') }), onNext ? t('rtEnterNext') : '');
      if (onNext) acts.append(h('button', { class: 'btn sm primary', type: 'button', 'data-act': 'rt-next', text: t('next'), onclick: () => onNext() }));
      acts.append(h('button', { class: 'btn sm', type: 'button', text: t('done'), onclick: () => onClose() }));
    }
    acts.firstChild && acts.firstChild.focus(); show();
  };
  const check = () => {
    const v = squash(inp.value);
    if (!v) return;
    if (v === target) { inp.classList.remove('bad'); done(); return; }
    if (target.startsWith(v)) { msg.textContent = t('rtNotYet'); return; }
    const d = diffTokens(v, target);
    msg.replaceChildren(h('div', { class: 'line' }, h('b', { text: t('rtYouTyped') }), renderMarked(d.orig, 'del')), h('div', { class: 'line' }, h('b', { text: t('rtShould') }), renderMarked(d.fixed, 'ins')));
    show();
  };
  /* 输入法（拼音）选词过程中，输入框里是还没上屏的拼音字母，不能拿来比对，等上屏（compositionend）再比 */
  let composing = false;
  const compare = () => { const v = inp.value; inp.classList.toggle('bad', v.length > 0 && !target.startsWith(v)); if (!inp.classList.contains('bad')) msg.textContent = ''; };
  inp.addEventListener('compositionstart', () => { composing = true; });
  inp.addEventListener('compositionend', () => { composing = false; compare(); });
  inp.addEventListener('input', e => { if (round === 2 && tg.classList.contains('veiled') === false) setVeil(true); grow(); if (!composing && !e.isComposing) compare(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && !composing) { e.preventDefault(); check(); } });
  inp.addEventListener('paste', e => { e.preventDefault(); msg.textContent = t('rtNoPaste'); });
  const peek = () => { if (round === 2 && !inp.disabled) setVeil(!tg.classList.contains('veiled')); };
  tg.addEventListener('click', peek); tpy.addEventListener('click', peek);
  queueMicrotask(() => { const c = card(); if (c) c.addEventListener('click', e => { if (e.target.closest('.fb-row.fb-fixed .v, .fb-row.fb-better .v, .fb-row.fb-hint .v, .explain')) peek(); }); });
  showTarget(opts[0]);
  begin(1);
  const nodes = [h('div', { class: 'rt-top' }, head, seg), tg, tpy, inp, msg, acts];
  nodes.sync = visible => { setVeil(visible && round === 2 && !inp.disabled); if (visible) grow(); };      // 面板收起时取消对上面答案的遮挡，再打开时恢复
  return nodes;
}

export function renderFeedback(m, ro) {
  const card = h('div', { class: 'fb' });
  if (m.gaveUp) {                                 // 我不会：参考译文 + 说明，没有「你的原文」
    card.append(row(t('fbRef'), m.words ? renderWords(m.words) : h('div', {}, h('span', { text: m.corrected }), pyLine(m.pinyin)), 'fb-fixed'));
    if (m.brief) card.append(row(t('fbNote'), h('span', { text: m.brief }), 'fb-hint'));
  } else {
  if (m.meaning === 'off') card.append(h('div', { class: 'fb-warn', text: t('fbOff', { brief: m.brief ? t('colon') + normEnd(m.brief) : '' }) }));
  if (m.isCorrect) {
    card.append(h('div', { class: 'fb-ok' }, h('span', { class: 'check', text: '✓' }), t('fbOk')));
    if (m.words) card.append(row(t('fbPinyin'), renderWords(m.words)));          // 学中文：写对了也给出拼音
  } else {
    const sw = m.words || m.studentWords ? segmentPlain(m.content, m.studentWords) : null;          // 学中文：你的原文也按词分开（不标拼音）
    card.append(row(t('fbOrig'), sw ? renderWords(sw, { flags: charFlags(m.diff.orig), cls: 'del', withPy: false }) : renderMarked(m.diff.orig, 'del')));
    card.append(row(t(m.meaning === 'off' ? 'fbRef' : 'fbFixed'), m.words ? renderWords(m.words, { flags: charFlags(m.diff.fixed), cls: 'ins' })
      : h('div', {}, renderMarked(m.diff.fixed, 'ins'), pyLine(m.pinyin)), 'fb-fixed'));
    if (m.kind === 'chat' && m.brief) card.append(row(t('fbHint'), h('span', { text: m.brief }), 'fb-hint'));   // 译文不显示点评，点「详细解释」再看
  }
  }
  if (!m.gaveUp && m.errors && m.errors.length) card.append(row(t('fbTypes'), h('div', { class: 'etags' }, ...m.errors.map(k => h('span', { class: 'etag', 'data-k': k, text: errLabel(k) }))), 'fb-types'));
  if (m.better) card.append(row(t('fbBetter'), h('div', {}, m.betterWords ? renderWords(m.betterWords) : h('span', { text: m.better }),
    m.betterWords ? null : pyLine(m.betterPinyin), m.betterNote ? h('div', { class: 'note', text: m.betterNote }) : null), 'fb-better'));

  const panel = h('div', { class: 'explain', hidden: true });
  if (m.explanation) { panel.textContent = m.explanation; panel.hidden = !ro; }

  const actions = h('div', { class: 'fb-actions' });
  if ((!m.isCorrect || m.better) && !ro) {
    const btn = h('button', { class: 'btn sm', type: 'button', text: t('explainBtn') });
    btn.addEventListener('click', async () => {
      if (m.explanation) {                       // 已有结果：只切换显示，不重复调用模型
        panel.hidden = !panel.hidden;
        btn.textContent = t(panel.hidden ? 'explainBtn' : 'explainHide');
        return;
      }
      btn.disabled = true; btn.textContent = t('generatingDots');
      panel.hidden = false; panel.replaceChildren(typingDots());
      try {
        m.explanation = await api.explain(m);
        db.updateMessage(m, { explanation: m.explanation });
        panel.textContent = m.explanation; btn.textContent = t('explainHide');
      } catch (e) {
        panel.textContent = e.message; btn.textContent = t('explainBtn');
      }
      btn.disabled = false;
    });
    actions.append(btn);
  }
  const rp = h('div', { class: 'rt', hidden: true });
  if (!m.isCorrect && m.corrected) {
    const badge = h('span', { class: 'pill', hidden: !m.retyped, text: t('retyped', { n: m.retyped || 0 }) });
    if (!ro) {
      const heavy = isHeavy(m);
      const rb = h('button', { class: 'btn sm' + (heavy ? ' primary' : ''), type: 'button', 'data-act': 'retype', text: t(m.gaveUp ? 'retypeGiveUp' : heavy ? 'retypeHeavy' : 'retypeBtn') });
      let sync = null;
      rb.addEventListener('click', () => {
        if (!sync) {
          const nodes = buildRetype(m, n => { badge.hidden = false; badge.textContent = t('retyped', { n }); }, () => { rp.hidden = true; input.focus(); updateEnterHint(); },
            m.kind === 'translate' ? () => { rp.hidden = true; newPrompt(); } : null);
          rp.append(...nodes); sync = nodes.sync;
        }
        rp.hidden = !rp.hidden;
        sync(!rp.hidden); updateEnterHint();
        if (!rp.hidden) { const i = $('.rt-input', rp); i.focus(); rp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
      actions.append(rb);
    }
    actions.append(badge);
  }
  if (m.kind === 'translate' && !ro) actions.append(h('button', { class: 'btn sm', type: 'button', 'data-act': 'next', text: t('next'), onclick: () => newPrompt() }));
  if ([...actions.children].some(c => !c.hidden)) card.append(actions);
  card.append(rp);
  card.append(panel);
  return card;
}

/* v0.6「题目有问题」：点一下展开原因（不自然 / 有错 / 难度不对 / 其他），选了就记下来；还没答的题直接换一句 */
export function reportControl(m) {
  const box = h('span', { class: 'report' });
  const open = () => box.replaceChildren(h('span', { class: 'rp-ask', text: t('reportAsk') }),
    ...['unnatural', 'wrong', 'level', 'other'].map(r => h('button', { class: 'btn sm', type: 'button', 'data-r': r, text: t('r_' + r), onclick: () => reportPrompt(m, r) })),
    h('button', { class: 'btn sm ghost', type: 'button', text: '×', 'aria-label': t('cancel'), onclick: close }));
  const close = () => box.replaceChildren(h('button', { class: 'btn sm ghost', type: 'button', text: t('reportBtn'), onclick: open }));
  close();
  return box;
}

/* ctx：这条消息所在会话的语言（看历史时可能和现在选的不一样） */
export function renderMessage(m, ro = false, ctx = state.session) {
  const wrap = h('div', { class: 'msg ' + (m.role === 'user' ? 'user' : 'ai'), 'data-id': m.id });
  const learn = ctx.lang || 'de', explain = ctx.explainLang || 'zh';

  if (m.role === 'assistant' && m.kind === 'prompt') {
    const st = m.status || 'pending';
    const foot = h('div', { class: 'prompt-foot' },
      st === 'pending' ? h('span', { class: 'pill wait', text: t(ro ? 'notAnswered' : 'waiting') })
      : h('span', { class: 'pill', text: t(st === 'answered' ? 'answered' : st === 'bad' ? 'reported' : 'skipped') }));
    if (st === 'pending' && !ro) foot.append(h('button', { class: 'btn sm', type: 'button', 'data-act': 'giveup', text: t('giveUp'), onclick: () => giveUp() }),
      h('button', { class: 'btn sm', type: 'button', text: t('skip'), onclick: () => skipPrompt() }));
    if (m.reported && st !== 'bad') foot.append(h('span', { class: 'pill', text: t('reported') }));
    if (!ro && !m.reported && st !== 'bad' && st !== 'skipped') foot.append(reportControl(m));
    if (m.review && st === 'pending' && !ro) foot.append(h('button', { class: 'btn sm', type: 'button', text: t('reviewRemove'), onclick: () => removeReview(m) }));
    wrap.append(h('div', { class: 'bubble ai prompt' + (st === 'pending' ? '' : ' done') + (m.review ? ' review' : '') },
      h('div', { class: 'lbl' }, m.review ? h('span', { class: 'pill rv', text: t('reviewTag') }) : null, t('promptLbl', { tr: trName(learn, explain), L: lname(learn) })), h('div', { class: 'zh', lang: LOCALE[explain], text: m.content }), foot));
  } else if (m.role === 'assistant') {
    const words = m.kind === 'reply' && m.words && cleanWords(m.words, m.content);        // 学中文：AI 回复按词排开，拼音在上
    wrap.append(h('div', { class: 'bubble ai', lang: m.kind === 'reply' ? LOCALE[learn] : null }, words ? renderWords(words) : renderRich(m.content)));
  } else {
    if (m.gaveUp) wrap.append(h('div', { class: 'bubble me giveup', text: t('giveUp') }));
    else {
      wrap.append(h('div', { class: 'tag' }, t('recognized'), h('b', { text: t('k_' + m.kind) })));
      wrap.append(h('div', { class: 'bubble me', lang: m.kind === 'ask' ? null : LOCALE[learn], text: m.content }));
    }
    if (m.kind !== 'ask' && m.diff !== undefined) wrap.append(renderFeedback(m, ro));
  }
  return wrap;
}

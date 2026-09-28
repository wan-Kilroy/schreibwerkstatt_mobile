/* Small DOM / text helpers: $(), h(), squash(), toast() … */
/* =====================================================================
 * 小工具
 * ===================================================================== */
export const $ = (s, r = document) => r.querySelector(s);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const rnd = (a, b) => a + Math.random() * (b - a);
export let seq = 1000;
export const uid = () => ++seq;

export function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
export const pad = n => String(n).padStart(2, '0');

export const daysAgo = (n, hh, mm) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hh, mm, 0, 0); return d; };
export const squash = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export const END_PUNCT = /[.!?…。！？]+$/;
export const normEnd = s => squash(s).replace(END_PUNCT, '');

export let toastTimer;
export function toast(t, ms = 2600) {
  $('.toast')?.remove();
  document.body.append(h('div', { class: 'toast', role: 'status', text: t }));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('.toast')?.remove(), ms);
}

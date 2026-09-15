export const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const cash = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function div(html, className = '') {
  const d = document.createElement('div');
  if (className) d.className = className;
  d.innerHTML = html;
  return d;
}

export function secsLeft(until, serverNow) {
  return Math.max(0, (until - serverNow) / 1000);
}

/** Fills a .phase-bar with the fraction of `total` still remaining. */
export function setBar(el, left, total) {
  if (el) el.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
}

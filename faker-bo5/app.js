const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const wins = seq => seq.split('W').length - 1;
const diffAt = (seq, k) => { let d = 0; for (let j = 0; j < k; j++) d += seq[j] === 'W' ? 1 : -1; return d; };
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const squares = seq => `<span class="sq">${[...seq].map(c => `<i class="${c === 'W' ? 'w' : 'l'}"></i>`).join('')}</span>`;
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';

const ALL = SERIES.map(([date, event, round, opp, seq, partial, kind], i) =>
  ({ i, date, event, round, opp, seq, partial: !!partial, kind, won: wins(seq) === 3 }));

const FILTERS = [['all', 'All'], ['kr', 'LCK & Korea'], ['worlds', 'Worlds'], ['msi', 'MSI'], ['intl', 'Other international']];

// All 20 endings, grouped by final score.
const ENDINGS = [];
(function gen(s) {
  const w = wins(s), l = s.length - w;
  if (w === 3 || l === 3) { ENDINGS.push(s); return; }
  gen(s + 'W'); gen(s + 'L');
})('');
const BUCKETS = [
  ['won', 'Won', [[3, 0], [3, 1], [3, 2]]],
  ['lost', 'Lost', [[2, 3], [1, 3], [0, 3]]],
];

let filter = 'all', data = ALL, pin = null, hover = null;
let labels = []; // chart scoreline labels: [text element, node key, series through that node]

// ---------- selection ----------

function matcher(sel) {
  if (!sel) return null;
  const [t, a, b] = sel.split(':');
  if (t === 'node') { const k = +a, d = +b; return s => s.seq.length >= k && diffAt(s.seq, k) === d; }
  if (t === 'seq') return s => s.seq === a;
  if (t === 'year') return s => s.date.startsWith(a);
  if (t === 'series') return s => s.i === +a;
  return null;
}

function highlight(sel) {
  const m = matcher(sel);
  document.body.classList.toggle('hl', !!m);
  // With a scoreline or year selected, the later scorelines also show what share of that selection
  // passed through them, e.g. how the series that were 2–1 went on to end.
  const [st, sk] = (sel || '').split(':');
  const after = st === 'node' ? +sk : st === 'year' ? 0 : Infinity;
  const total = after < Infinity ? data.filter(m).length : 0;
  for (const [t, key, list] of labels) {
    const hit = m ? list.filter(m).length : 0;
    t.classList.toggle('off', !!m && !hit);
    t.querySelector('.sh').textContent = hit && +key.split(':')[0] > after ? ' ' + pct(hit, total) : '';
  }
  document.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', !!m && m(ALL[+el.dataset.i])));
  document.querySelectorAll('.col').forEach(el => el.classList.toggle('pin', pin === 'series:' + el.dataset.i));
  document.querySelectorAll('.ending').forEach(el => {
    const seq = el.dataset.sel.slice(4);
    const total = data.filter(s => s.seq === seq).length;
    const hit = m ? data.filter(s => s.seq === seq && m(s)).length : total;
    el.classList.toggle('on', !!m && hit > 0);
    el.querySelector('b').style.width = (100 * hit / maxEnding()) + '%';
    el.querySelector('.c').innerHTML = m && hit && hit !== total ? `${hit}<em>/${total}</em>` : String(total);
  });
}

function setHover(sel) { if (phone.matches) return; hover = sel; refresh(); }
// On phones there is no hover, and the panel under the chart is usually off-screen by the time
// you tap an ending or a year, so the series list opens right under what you tapped instead.
const phone = matchMedia('(hover: none)');
const detail = $('#detail');
function placeDetail(anchor) {
  (anchor || $('#lattice')).after(detail);
  detail.classList.toggle('away', !!anchor);
}
function setPin(sel, from) {
  pin = pin === sel ? null : sel;
  if (!phone.matches || !from) { placeDetail(null); refresh(); return; }
  // Keep whatever was tapped in the same spot on screen while the panel moves.
  const top = from.getBoundingClientRect().top;
  placeDetail(pin && (from.closest('.ending') || from.closest('.yr')));
  refresh();
  window.scrollBy(0, from.getBoundingClientRect().top - top);
}
function refresh() { highlight(hover || pin); renderDetail(pin || hover); }

function caption(sel, list) {
  const [t, a, b] = sel.split(':');
  const n = list.length, w = list.filter(s => s.won).length;
  if (t === 'node') {
    const k = +a, d = +b, W = (k + d) / 2, L = (k - d) / 2;
    if (k === 0) return `All <b>${n}</b> series: won ${w}, lost ${n - w}.`;
    if (W === 3 || L === 3) return `Ended <b>${W}–${L}</b> in ${n} series.`;
    return `Faker's team was <b>${W}–${L}</b> in ${n} series and went on to win ${w} of them (${pct(w, n)}).`;
  }
  if (t === 'seq') return n ? `${squares(a)} &nbsp;<b>${a}</b>, ${n} series.` : `${squares(a)} &nbsp;<b>${a}</b> has never happened${filter === 'all' ? '' : ' in these events'}.`;
  if (t === 'year') return `<b>${a}</b>: ${n} series, won ${w}.`;
  return '';
}

function renderDetail(sel) {
  const el = $('#detail');
  if (!sel) {
    el.innerHTML = `<p class="hint">Hover or tap anything to see its series.</p>`;
    return;
  }
  const m = matcher(sel);
  const list = data.filter(m).slice().reverse();
  if (sel.startsWith('series:')) {
    const s = ALL[+sel.slice(7)];
    el.innerHTML = `<p class="cap">${squares(s.seq)} &nbsp;<b>${s.won ? 'Won' : 'Lost'} ${wins(s.seq)}–${s.seq.length - wins(s.seq)}</b> vs ${esc(s.opp)}, ${esc(s.event)}${s.round ? ' ' + esc(s.round) : ''}, ${s.date}${s.partial ? '<span class="dag">† played part</span>' : ''}</p>`;
    return;
  }
  el.innerHTML = `<p class="cap">${caption(sel, list)}</p>` + (list.length ? `<div class="list">${list.map(s =>
    `<div data-row="${s.i}"><span class="d">${s.date}</span><span class="ev">${esc(s.event)}${s.round ? ' · ' + esc(s.round) : ''}</span><span class="op">${esc(s.opp)}${s.partial ? '<span class="dag">†</span>' : ''}</span>${squares(s.seq)}</div>`).join('')}</div>` : '');
}

// Rows in the detail list highlight their series without replacing the list.
$('#detail').addEventListener('pointerover', e => {
  const r = e.target.closest('[data-row]');
  highlight(r ? 'series:' + r.dataset.row : hover || pin);
});
$('#detail').addEventListener('pointerleave', () => highlight(hover || pin));

// ---------- tooltip ----------

const tip = $('#tip');
function showTip(e, s) {
  if (phone.matches) return;
  tip.innerHTML = `<div class="d">${s.date}</div><b>${esc(s.event)}</b>${s.round ? ' ' + esc(s.round) : ''}<br>vs ${esc(s.opp)} &nbsp;${squares(s.seq)}${s.partial ? '<span class="dag">†</span>' : ''}`;
  tip.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { tip.hidden = true; }

// ---------- lattice ----------

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function drawLattice() {
  const box = $('#lattice');
  const W = box.clientWidth, narrow = W < 560;
  const u = Math.max(44, Math.min(70, W / 13));     // vertical step for one game of margin
  const mL = narrow ? 14 : 26, mR = narrow ? 76 : 150;
  const colW = (W - mL - mR) / 5;
  const X = k => mL + k * colW, Y = d => -d * u;
  const g = Math.min(2.6, (4 * u - 40) / Math.max(1, data.length)); // spacing between threads

  // Threads ordered so the ones about to win a game sit on top at every node: no crossings.
  const key = s => s.seq.replace(/W/g, 'a').replace(/L/g, 'c');
  const order = data.slice().sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.date < b.date ? -1 : 1);
  const nodes = new Map();
  labels = [];
  for (let k = 0; k <= 5; k++) for (let d = -k; d <= k; d += 2) {
    const w = (k + d) / 2, l = (k - d) / 2;
    if (w <= 3 && l <= 3 && !(w === 3 && l === 3)) nodes.set(k + ':' + d, { k, d, w, l, end: w === 3 || l === 3, list: [] });
  }
  for (const s of order) for (let k = 0; k <= s.seq.length; k++) nodes.get(k + ':' + diffAt(s.seq, k)).list.push(s);
  const off = new Map(); // `${i}:${k}` -> y offset at that node
  for (const n of nodes.values()) n.list.forEach((s, j) => off.set(s.i + ':' + n.k, (j - (n.list.length - 1) / 2) * g));
  const halfOf = n => Math.max(3, n.list.length * g / 2);

  let top = Infinity, bot = -Infinity;
  for (const n of nodes.values()) { top = Math.min(top, Y(n.d) - halfOf(n) - 22); bot = Math.max(bot, Y(n.d) + halfOf(n) + 8); }
  const H = bot - top;

  box.innerHTML = '';
  const svg = el('svg', { width: W, height: H, viewBox: `0 ${top} ${W} ${H}`, role: 'img', 'aria-label': 'Every series as a thread through the scorelines' }, box);
  const gS = el('g', {}, svg), gH = el('g', {}, svg), gN = el('g', {}, svg), gL = el('g', {}, svg);

  for (const s of order) {
    const pts = [];
    for (let k = 0; k <= s.seq.length; k++) pts.push([X(k), Y(diffAt(s.seq, k)) + off.get(s.i + ':' + k)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], c = colW * .5;
      d += `C${x0 + c},${y0} ${x1 - c},${y1} ${x1},${y1}`;
    }
    el('path', { d, class: 'st ' + (s.won ? 'w' : 'l'), 'stroke-width': Math.max(.8, g * .72), 'data-i': s.i }, gS);
    const h = el('path', { d, class: 'hit', 'stroke-width': Math.max(4, g * 1.6), 'data-sel': 'series:' + s.i }, gH);
    h.addEventListener('pointerenter', e => { showTip(e, s); setHover('series:' + s.i); });
    h.addEventListener('pointermove', moveTip);
    h.addEventListener('pointerleave', () => { hideTip(); setHover(null); });
  }

  for (const n of nodes.values()) {
    const x = X(n.k), y = Y(n.d), half = halfOf(n), cnt = n.list.length, sel = `node:${n.k}:${n.d}`;
    if (!cnt) el('circle', { cx: x, cy: y, r: 2.5, class: 'dot' }, gN);
    const r = el('rect', { x: x - 12, y: y - half - 6, width: 24, height: 2 * half + 12, rx: 6, class: 'node', 'data-sel': sel }, gN);
    r.addEventListener('pointerenter', () => setHover(sel));
    r.addEventListener('pointerleave', () => setHover(null));
    if (n.end) {
      const t = el('text', { x: x + 12, y: y + 4, class: 'nl end' }, gL);
      t.innerHTML = `${n.w}–${n.l} <tspan class="n">${cnt}</tspan>` + (narrow ? '' : ` <tspan class="pct">${pct(cnt, data.length)}</tspan>`) + '<tspan class="sh"></tspan>';
      labels.push([t, n.k + ':' + n.d, n.list]);
    } else {
      const t = el('text', { x, y: y - half - 8, 'text-anchor': 'middle', class: 'nl' }, gL);
      t.innerHTML = `${n.w}–${n.l} <tspan class="n">${cnt}</tspan><tspan class="sh"></tspan>`;
      labels.push([t, n.k + ':' + n.d, n.list]);
    }
  }

  $('#colheads').innerHTML = ['Start', 'Game 1', 'Game 2', 'Game 3', 'Game 4', 'Game 5']
    .map((t, k) => `<span style="left:${X(k)}px">${narrow && k ? 'G' + k : t}</span>`).join('');
}

// ---------- endings ----------

function maxEnding() { return Math.max(1, ...ENDINGS.map(e => data.filter(s => s.seq === e).length)); }

function drawEndings() {
  $('#endings').innerHTML = BUCKETS.map(([cls, title, scores]) => {
    const n = data.filter(s => s.won === (cls === 'won')).length;
    return `<div class="grp ${cls}"><h3><span>${title}</span><span>${n} series</span></h3>` + scores.map(([w, l]) => {
      const seqs = ENDINGS.filter(e => wins(e) === w && e.length - wins(e) === l).sort();
      const total = data.filter(s => seqs.includes(s.seq)).length;
      return `<div class="bucket"><div class="bh">${w}–${l} · ${total}</div>` + seqs.map(e => {
        const c = data.filter(s => s.seq === e).length;
        const back = data.filter(s => s.seq.startsWith('LLWW')).length;
        const never = e === 'LLWWL' && !c && back > 0;
        return `<button class="ending ${w === 3 ? 'w' : 'l'}${c ? '' : ' zero'}${never ? ' never' : ''}" data-sel="seq:${e}">${squares(e)}<span class="bar"><i style="width:${100 * c / maxEnding()}%"></i><b></b></span><span class="c">${c}</span></button>` +
          (never ? `<div class="callout"><b>Never happened.</b> Faker's teams have come back from 0–2 to 2–2 ${back === 1 ? 'once' : back + ' times'}, and won game five every time.</div>` : '');
      }).join('') + '</div>';
    }).join('') + '</div>';
  }).join('');
}

// ---------- years ----------

function drawYears() {
  const years = [...new Set(ALL.map(s => s.date.slice(0, 4)))];
  $('#years').innerHTML = years.map(y => {
    const list = data.filter(s => s.date.startsWith(y));
    const w = list.filter(s => s.won).length;
    return `<div class="yr${list.length ? '' : ' empty'}"><div class="yl" data-sel="year:${y}"><b>${y}</b><span>${w}–${list.length - w}</span></div><div class="cs">${list.map(s =>
      `<div class="col${s.partial ? ' part' : ''}" data-i="${s.i}" data-sel="series:${s.i}">${[...s.seq].map(c => `<i class="${c === 'W' ? 'w' : 'l'}"></i>`).join('')}</div>`).join('')}</div></div>`;
  }).join('');
}

// ---------- shared hover / click wiring for HTML elements ----------

document.addEventListener('pointerover', e => {
  const t = e.target.closest('.ending,.yl,.col');
  if (!t) return;
  if (t.classList.contains('col')) showTip(e, ALL[+t.dataset.i]);
  setHover(t.dataset.sel);
});
document.addEventListener('pointerout', e => {
  const t = e.target.closest('.ending,.yl,.col');
  if (!t || t.contains(e.relatedTarget)) return;
  hideTip(); setHover(null);
});
document.addEventListener('pointermove', e => { if (!tip.hidden && e.target.closest('.col')) moveTip(e); });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-sel]');
  if (t) { setPin(t.dataset.sel, t); return; }
  if (pin && !e.target.closest('#detail,button,a')) setPin(pin, e.target);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pin) setPin(pin);
});

// ---------- filters, theme, boot ----------

function drawFilters() {
  $('#filters').innerHTML = FILTERS.map(([k, t]) =>
    `<button data-f="${k}" aria-pressed="${k === filter}">${t}<em>${k === 'all' ? ALL.length : ALL.filter(s => s.kind === k).length}</em></button>`).join('');
}
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  e.stopPropagation();
  filter = b.dataset.f;
  data = filter === 'all' ? ALL : ALL.filter(s => s.kind === filter);
  pin = hover = null;
  render();
});

const themeBtn = $('#bTheme');
function syncTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  themeBtn.textContent = light ? 'Dark mode' : 'Light mode';
  themeBtn.setAttribute('aria-pressed', String(light));
}
themeBtn.onclick = () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('bo5-theme', light ? 'light' : 'dark'); } catch (e) {}
  syncTheme();
};
syncTheme();

function render() { placeDetail(null); drawFilters(); drawLattice(); drawEndings(); drawYears(); refresh(); }

let lastW = 0;
new ResizeObserver(() => {
  const w = $('#lattice').clientWidth;
  if (w !== lastW) { lastW = w; drawLattice(); refresh(); }
}).observe($('#lattice'));
render();

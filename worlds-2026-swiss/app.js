// UI for the Worlds 2026 Swiss stage counter.
// Relies on the engine globals (TEAMS, derive, canPair, ...) and LOL from lolesports.js.
(() => {
const T = TEAMS;
const EMPTY = () => ({ pi: null, rounds: [] });

// ---------- worker ----------
function makeWorker() {
  const inline = document.getElementById('worker-src');
  if (inline) {
    const src = document.getElementById('engine').textContent + '\nconst V3_INLINE=' + document.getElementById('v3-data').textContent + ';\n' + inline.textContent;
    return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  }
  return new Worker('worker.js' + (window.SWISS_V ? '?v=' + window.SWISS_V : ''));
}
let worker, reqId = 0, latest = null, busy = false, sharesPending = false;
function onWorker(e) {
  if (e.data.id !== reqId) return;
  if (e.data.error) { busy = sharesPending = false; setStatus('Counting failed: ' + e.data.error); render(); return; }
  const o = e.data.out;
  latest = { r: o.r, phase: o.phase, total: BigInt(o.total),
    pairShare: o.pairShare ? new Map(Object.entries(o.pairShare).map(([k, v]) => [k, BigInt(v)])) : null,
    winShare: o.winShare ? o.winShare.map(BigInt) : null,
    piShare: o.piShare ? Object.fromEntries(Object.entries(o.piShare).map(([k, v]) => [k, BigInt(v)])) : null };
  busy = false; sharesPending = !!o.partial;
  recordStep(latest.total);
  render();
}
function startWorker() { worker = makeWorker(); worker.onmessage = onWorker; }
startWorker();
function plain(s) { return { pi: s.pi, rounds: s.rounds.map(r => ({ pairs: r.pairs.map(p => p.slice()), win: r.win.slice() })) }; }
let sentKey = '';
function recount(force) {
  const key = JSON.stringify(plain(eff));
  if (!force && key === sentKey) return;
  sentKey = key;
  if (busy || sharesPending) { worker.terminate(); startWorker(); }
  reqId++; busy = true; sharesPending = true;
  worker.postMessage({ id: reqId, state: plain(eff) });
}

// ---------- state ----------
let locks = EMPTY();          // what really happened (from the API)
let liveOn = true, liveInfo = { state: 'loading' };
let user = EMPTY();           // the viewer's own picks
let eff = EMPTY();            // locks + picks merged
let selected = null, undoStack = [], steps = [], pendingLabel = 'Start';

const same = (p, q) => (p[0] === q[0] && p[1] === q[1]) || (p[0] === q[1] && p[1] === q[0]);

// Lay the viewer's picks over the real results. Real results always win.
function merge(L, U) {
  const out = { pi: L.pi || U.pi, rounds: [] }, problems = [];
  let conflict = 0;
  if (!out.pi) return { state: out, conflict, problems };
  if (L.pi && U.pi && U.pi !== L.pi) conflict = -1;
  setPlayIn(out.pi);
  for (let r = 1; r <= 5; r++) {
    const Lr = L.rounds[r - 1] || { pairs: [], win: [] };
    const Ur = (conflict === 0 && U.rounds[r - 1]) || { pairs: [], win: [] };
    const { w, l, adj, r: cr } = derive(out.rounds);
    const checkable = cr === r;
    const rd = { pairs: [], win: [], lock: [] }, used = new Set();
    Lr.pairs.forEach(([a, b], k) => {
      if (used.has(a) || used.has(b) || (checkable && !canPair(a, b, r, w, l, adj))) { problems.push(r); return; }
      used.add(a); used.add(b);
      const uk = Ur.pairs.findIndex(p => same(p, [a, b]));
      const uw = uk >= 0 ? Ur.win[uk] : -1, lw = Lr.win[k];
      if (lw >= 0 && uw >= 0 && uw !== lw) conflict = conflict || r;
      rd.pairs.push([a, b]); rd.win.push(lw >= 0 ? lw : uw); rd.lock.push(lw >= 0 ? 2 : 1);
    });
    if (checkable && conflict === 0) {
      const extra = [];
      for (let k = 0; k < Ur.pairs.length; k++) {
        const [a, b] = Ur.pairs[k];
        if (rd.pairs.some(p => same(p, [a, b]))) continue;
        if (used.has(a) || used.has(b) || !canPair(a, b, r, w, l, adj)) { conflict = r; break; }
        extra.push([a, b, Ur.win[k]]);
      }
      if (conflict === 0) for (const [a, b, x] of extra) { used.add(a); used.add(b); rd.pairs.push([a, b]); rd.win.push(x); rd.lock.push(0); }
    }
    if (!rd.pairs.length) break;
    out.rounds.push(rd);
  }
  return { state: out, conflict, problems };
}
function lockedFor(r) { return (eff.rounds[r - 1] && eff.rounds[r - 1].lock) || []; }
function activeLocks() { return liveOn ? locks : EMPTY(); }
function refresh(note) {
  const m = merge(activeLocks(), user);
  eff = m.state;
  if (m.conflict && note) setStatus(m.conflict === -1
    ? 'The real Play-In winner differs from your pick, so your Swiss picks were cleared.'
    : `Your Round ${m.conflict} picks didn't match what really happened. The real results replaced them and your later picks were cleared.`);
  if (m.conflict) user = plain(eff);
}
function cur() { setPlayIn(eff.pi); return derive(eff.rounds); }
function snapshot(label) { undoStack.push({ u: JSON.stringify(user), steps: steps.length }); pendingLabel = label; }
function recordStep(total) { if (pendingLabel === null) return; steps.push({ label: pendingLabel, total }); pendingLabel = null; }
function editable() { return plain(eff); }   // start edits from what's on screen

// ---------- formatting ----------
const NAMES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion'];
function log10(b) { if (b <= 0n) return -Infinity; const s = b.toString(); return s.length <= 15 ? Math.log10(Number(s)) : Math.log10(Number(s.slice(0, 15))) + s.length - 15; }
function commas(b) { return b.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function approx(b) {
  const lg = log10(b); if (lg < 3) return b.toString();
  const g = Math.min(Math.floor(lg / 3), NAMES.length - 1);
  return (10 ** (lg - 3 * g)).toPrecision(3) + ' ' + NAMES[g];
}
function pct(part, whole) {
  if (whole === 0n) return '0%';
  const p = Number(part * 100000n / whole) / 1000;
  return p >= 10 ? p.toFixed(0) + '%' : p >= 1 ? p.toFixed(1) + '%' : p > 0 ? '<1%' : '0%';
}
const START = (BigInt(154 + 196) * 256n * F_AFTER_R1);
function share(t) {
  const ratio = 10 ** (log10(START) - log10(t));
  return ratio < 100 ? (100 / ratio).toPrecision(2) + '%' : '1 in ' + approx(BigInt(Math.round(ratio)) > 0n && ratio < 1e15 ? BigInt(Math.round(ratio)) : START / t);
}
const name = (i) => T[i].id;
let notice = '';
function setStatus(s) { notice = s; document.getElementById('status').textContent = s; }
function showStatus() {
  document.getElementById('status').textContent = busy ? 'Counting every remaining draw and result…'
    : sharesPending ? 'Total is in. Working out how each possible pairing splits it…' : notice;
}
const LOCK_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

// ---------- rendering ----------
function renderCount() {
  const c = document.getElementById('count');
  c.classList.toggle('busy', busy);
  if (!latest) { c.textContent = 'Counting…'; return; }
  c.textContent = commas(latest.total);
  const frac = latest.total === START ? 'every possibility is still open'
    : latest.total === 1n ? 'one Swiss stage, fully decided'
    : latest.total === 0n ? 'no legal way to finish from here'
    : `≈ ${approx(latest.total)} · ${share(latest.total)} of the starting paths`;
  document.getElementById('approx').textContent = busy ? 'counting…' : frac;
  document.getElementById('meterfill').style.width = (100 * Math.max(0, log10(latest.total)) / log10(START)).toFixed(2) + '%';
}

function renderSpark() {
  const svg = document.getElementById('spark');
  const W = svg.clientWidth || 600, H = 46, top = log10(START);
  if (steps.length < 2) { svg.innerHTML = `<text x="0" y="28" fill="var(--muted)" font-family="Space Mono, monospace" font-size="12">Each pick adds a step to this trail.</text>`; return; }
  const n = steps.length - 1;
  const x = i => 4 + (W - 8) * i / n, y = v => 6 + (H - 12) * (1 - Math.max(0, log10(v)) / top);
  const d = steps.map((s, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.total).toFixed(1)).join(' ');
  const last = steps[steps.length - 1];
  svg.innerHTML = `<line x1="0" x2="${W}" y1="${H - 6}" y2="${H - 6}" stroke="var(--line)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linejoin="round"/>
    <circle cx="${x(n)}" cy="${y(last.total)}" r="3.5" fill="var(--accent)"/>`;
}

function renderLive() {
  const el = document.getElementById('live'), txt = document.getElementById('liveText');
  el.classList.toggle('on', liveOn && liveInfo.state === 'ok');
  el.classList.toggle('err', liveInfo.state === 'error');
  let s;
  if (liveInfo.state === 'off') { txt.innerHTML = '<span class="dot"></span>Real results lock in automatically on the <a href="https://nirmit.dev/worlds-2026-swiss/">nirmit.dev version</a> of this page.'; el.querySelector('label').hidden = true; return; }
  if (liveInfo.state === 'loading') s = 'Checking lolesports for real results…';
  else if (liveInfo.state === 'error') s = 'Couldn’t reach lolesports, so nothing is locked. ' + (liveInfo.msg || '');
  else {
    const L = locks, bits = [];
    bits.push(L.pi ? `${L.pi} won the Play-In` : L.seen.playin === 'inProgress' ? 'Play-In final in progress' : 'Play-In final not played yet');
    if (L.seen.pairs) bits.push(`${L.seen.pairs} Swiss match${L.seen.pairs === 1 ? '' : 'es'} drawn, ${L.seen.results} played`);
    else if (L.pi) bits.push('Swiss draw not out yet');
    s = (liveOn ? 'Real results locked: ' : 'Real results ignored: ') + bits.join(' · ') + ` · checked ${liveInfo.at}`;
  }
  txt.innerHTML = `<span class="dot"></span>${s}`;
}

function chip(i, cls, sub, act, disabled, subCls) {
  return `<button class="chip ${cls}" ${disabled ? 'disabled' : ''} data-act="${act || ''}" title="${T[i].name}">${name(i)}<small class="${subCls || ''}">${sub ?? T[i].region}</small></button>`;
}
function piChip(code, cls, act) {
  const p = PLAYIN[code];
  return `<button class="chip ${cls}" data-act="${act}" title="${p.name}">${code}<small>${p.region}</small></button>`;
}

function renderPlayIn() {
  const locked = !!activeLocks().pi, pi = eff.pi;
  const hint = locked ? 'Played. The winner takes the fourth tier 4 spot in the Swiss stage.'
    : 'Karmine Corp and MVK Esports play for the last Swiss spot. KC’s region (LEC) blocks two Round 1 opponents and MVK’s (LCP) blocks none, so an MVK win leaves more possible Swiss stages.';
  let html = `<section class="round" id="round-0"><h2>Play-In final <small>Bo5 · Oct 18</small></h2><p class="hint">${hint}</p><div class="pools"><div class="pool playin">`;
  html += `<div class="match ${locked ? 'real' : ''}">`;
  html += piChip('KC', pi === 'KC' ? 'win' : pi ? 'lose' : '', 'pi:KC') + '<span class="vs">v</span>' + piChip('MVK', pi === 'MVK' ? 'win' : pi ? 'lose' : '', 'pi:MVK');
  html += locked ? `<span class="lock" title="Real result">${LOCK_SVG}</span>` : '<span></span>';
  return html + '</div></div></div></section>';
}

function recordsBefore(r) { return derive(eff.rounds.slice(0, r - 1)); }
function poolsFor(r, st) {
  const act = activeList(st.w, st.l);
  if (r === 1) return [
    { name: 'Tier 1 v Tier 4', tiers: [1, 4], teams: act.filter(i => T[i].tier === 1 || T[i].tier === 4) },
    { name: 'Tier 2 v Tier 3', tiers: [2, 3], teams: act.filter(i => T[i].tier === 2 || T[i].tier === 3) }];
  const m = new Map();
  for (const i of act) { const k = st.w[i] + '–' + st.l[i]; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, t]) => ({ name: k + ' pool', teams: t }));
}

function renderRound(r, live) {
  if (!eff.pi) return `<section class="round future" id="round-${r}"><h2>Round ${r}</h2><p class="hint">${r === 1 ? 'Drawn once the Play-In final is decided.' : 'Drawn once the previous round is played.'}</p></section>`;
  const st = recordsBefore(r);
  const rd = eff.rounds[r - 1] || { pairs: [], win: [], lock: [] };
  const lock = rd.lock || [];
  const isCur = live.r === r, past = live.r > r;
  const need = activeList(st.w, st.l).length / 2;
  let hint;
  if (past) hint = lock.every(x => x === 2) ? 'Played.' : 'Played. Tap a different winner to rewrite this round. Later rounds will be cleared.';
  else if (isCur && rd.pairs.length < need) hint = r === 1
    ? 'Tap a team, then its opponent. Dashed teams are legal opponents, with the share of remaining paths that pairing keeps alive.'
    : 'Teams only meet others with the same record and never face a team they’ve already played. Tap a team, then its opponent.';
  else if (isCur) hint = 'Tap the winner of each match.';
  else hint = 'Drawn once the previous round is played.';
  let html = `<section class="round ${!isCur && !past ? 'future' : ''}" id="round-${r}"><h2>Round ${r} <small>${need} matches</small></h2><p class="hint">${hint}</p>`;
  if (!isCur && !past) return html + '</section>';
  const shares = !busy && isCur && latest && latest.r === r ? latest : null;
  const ready = shares && !sharesPending;
  const pools = poolsFor(r, st);
  html += '<div class="pools">';
  for (const P of pools) {
    const inPool = new Set(P.teams);
    const ms = rd.pairs.map((p, k) => [p, k]).filter(([p]) => inPool.has(p[0]));
    html += `<div class="pool"><h3><span>${P.name}</span><em>${P.teams.length} teams</em></h3>`;
    for (const [[a, b], k] of ms) {
      const wv = rd.win[k], lk = lock[k] || 0;
      const ca = wv === a ? 'win' : wv === b ? 'lose' : '', cb = wv === b ? 'win' : wv === a ? 'lose' : '';
      const canX = isCur && !lk && rd.win.every(x => x < 0);
      const tail = lk ? `<span class="lock" title="${lk === 2 ? 'Real result' : 'Real draw'}">${LOCK_SVG}</span>`
        : canX ? `<button class="x" aria-label="Undraw this match" data-act="unpair:${k}">×</button>` : '<span></span>';
      html += `<div class="match ${lk === 2 ? 'real' : ''}">${chip(a, ca, null, `win:${r}:${k}:${a}`)}<span class="vs">v</span>${chip(b, cb, null, `win:${r}:${k}:${b}`)}${tail}`;
      html += '</div>';
    }
    const used = new Set(rd.pairs.flat());
    const free = P.teams.filter(i => !used.has(i));
    if (isCur && free.length) {
      html += '<div class="waiting">';
      for (const g of (r === 1 ? P.tiers : [null])) {
        const list = g === null ? free : free.filter(i => T[i].tier === g);
        if (r === 1) html += `<div class="tier">Tier ${g}</div>`;
        for (const i of list) {
          let cls = '', sub = null, dis = false, subCls = '';
          if (selected === i) cls = 'sel';
          else if (selected !== null && ready && shares.pairShare) {
            const v = shares.pairShare.get(Math.min(i, selected) + '-' + Math.max(i, selected));
            if (v !== undefined && v > 0n) { cls = 'elig'; sub = pct(v, shares.total); subCls = 'share'; }
            else { cls = 'dim'; dis = true; }
          }
          html += chip(i, cls, sub, `pick:${i}`, dis, subCls);
        }
      }
      html += '</div>';
    }
    html += '</div>';
  }
  return html + '</div></section>';
}

function renderBoard() {
  const sec = document.getElementById('standings');
  if (!eff.pi) { sec.hidden = true; return; }
  sec.hidden = false;
  const st = cur();
  const recs = ['3–0', '3–1', '3–2', '2–0', '2–1', '2–2', '1–0', '1–1', '1–2', '0–0', '0–1', '0–2', '2–3', '1–3', '0–3'];
  const by = new Map();
  for (let i = 0; i < 16; i++) { const k = st.w[i] + '–' + st.l[i]; if (!by.has(k)) by.set(k, []); by.get(k).push(i); }
  document.getElementById('board').innerHTML = recs.filter(k => by.has(k)).map(k => {
    const [w, l] = k.split('–').map(Number);
    const cls = w === 3 ? 'adv' : l === 3 ? 'out' : '', lab = w === 3 ? 'Advanced' : l === 3 ? 'Eliminated' : '';
    return `<div class="rec ${cls}"><h4>${k}<em>${lab || by.get(k).length + ' teams'}</em></h4><div>${by.get(k).map(i => `<span class="tag" title="${T[i].name}">${name(i)}</span>`).join('')}</div></div>`;
  }).join('');
}


// ---------- bracket sidebar ----------
const POOL_INFO = { '0-0': [16, 'Bo1'], '1-0': [8, 'Bo1'], '0-1': [8, 'Bo1'], '2-0': [4, 'Bo3'], '1-1': [8, 'Bo1'], '0-2': [4, 'Bo3'],
  '2-1': [6, 'Bo3'], '1-2': [6, 'Bo3'], '2-2': [6, 'Bo3'] };
const END_INFO = { '3-0': 2, '3-1': 3, '3-2': 3, '0-3': 2, '1-3': 3, '2-3': 3 };
const BCOLS = [['pi', '0-0'], ['1-0', '0-1'], ['2-0', '1-1', '0-2'], ['3-0', '2-1', '1-2', '0-3'], ['3-1', '2-2', '1-3'], ['3-2', '2-3']];
const BHEADS = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5', 'Final'];
function bracketRecords() {
  // each team's record at the start of every round, counting only decided results
  const w = Array(16).fill(0), l = Array(16).fill(0), start = [];
  for (let r = 0; r < 5; r++) {
    start.push({ w: w.slice(), l: l.slice() });
    const rd = eff.rounds[r]; if (!rd) continue;
    rd.pairs.forEach(([a, b], k) => { const x = rd.win[k]; if (x < 0) return; w[x]++; l[x === a ? b : a]++; });
  }
  return { w, l, start };
}
const bName = (i) => (i === PI && !eff.pi) ? 'PI' : name(i);
const bCell = (top, bot, x) => `<div class="bx"><span class="${x === 1 ? 'w' : x === 2 ? 'l' : ''}">${top}</span><span class="${x === 2 ? 'w' : x === 1 ? 'l' : ''}">${bot}</span></div>`;
const bSlots = (teams, total) => `<div class="bslots">${teams.map(i => `<span class="bslot" title="${T[i].name}">${bName(i)}</span>`).join('')}${Array.from({ length: Math.max(0, total - teams.length) }, () => '<span class="bslot q">?</span>').join('')}</div>`;
function bPool(key, rec, curR) {
  if (key === 'pi') {
    const x = eff.pi === 'KC' ? 1 : eff.pi === 'MVK' ? 2 : 0;
    return `<a class="bpool ${curR === 0 ? 'now' : ''}" href="#round-0" data-rec="pi"><h5>Play-In</h5>${bCell('KC', 'MVK', x)}</a>`;
  }
  const [w, l] = key.split('-').map(Number);
  if (key in END_INFO) {
    const ts = [...Array(16).keys()].filter(i => rec.w[i] === w && rec.l[i] === l);
    return `<div class="bpool end ${w === 3 ? 'adv' : 'out'}" data-rec="${key}"><h5>${w}–${l}<em>${w === 3 ? 'in' : 'out'}</em></h5>${bSlots(ts, END_INFO[key])}</div>`;
  }
  const r = w + l + 1, [n, bo] = POOL_INFO[key], st = rec.start[r - 1];
  const rd = eff.rounds[r - 1] || { pairs: [], win: [] };
  const known = [...Array(16).keys()].filter(i => st.w[i] === w && st.l[i] === l && w + l === r - 1 && st.w[i] + st.l[i] === r - 1);
  const pairs = rd.pairs.map((p, k) => [p, rd.win[k]]).filter(([[a]]) => st.w[a] === w && st.l[a] === l);
  const used = new Set(pairs.flatMap(([p]) => p));
  const waiting = known.filter(i => !used.has(i));
  let body = pairs.map(([[a, b], x]) => bCell(bName(a), bName(b), x === a ? 1 : x === b ? 2 : 0)).join('');
  const open = n - 2 * pairs.length;
  if (open > 0) body += pairs.length || waiting.length ? bSlots(waiting, open) : Array.from({ length: open / 2 }, () => '<div class="bx tbd"><span>—</span><span>—</span></div>').join('');
  return `<a class="bpool ${curR === r ? 'now' : ''}" href="#round-${r}" data-rec="${key}"><h5>${w}–${l}<em>${bo}</em></h5>${body}</a>`;
}
function renderBracket(live) {
  const rec = bracketRecords(), curR = eff.pi ? live.r : 0;
  const heads = BHEADS.map((h, c) => `<span class="${curR === c + 1 ? 'now' : ''}">${h}</span>`).join('');
  const cols = BCOLS.map(keys => `<div class="bcol">${keys.map(k => bPool(k, rec, curR)).join('')}</div>`).join('');
  return `<div class="bheads">${heads}</div><div class="bgrid">${cols}</div><svg class="blines" aria-hidden="true"></svg>`;
}
function drawBracketLines() {
  const root = document.getElementById('bracket'), svg = root && root.querySelector('svg.blines');
  if (!svg) return;
  const R = root.getBoundingClientRect();
  const box = (k) => { const e = root.querySelector(`[data-rec="${k}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left - R.left, y: b.top - R.top, w: b.width, h: b.height }; };
  let up = '', down = '';
  for (const key of Object.keys(POOL_INFO)) {
    const [w, l] = key.split('-').map(Number), s = box(key); if (!s) continue;
    for (const [t, isWin] of [[`${w + 1}-${l}`, true], [`${w}-${l + 1}`, false]]) {
      const b = box(t); if (!b) continue;
      const x1 = s.x + s.w, y1 = s.y + s.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      const seg = `M${x1.toFixed(1)} ${y1.toFixed(1)}C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (isWin) up += seg; else down += seg;
    }
  }
  const p = box('pi'), z = box('0-0');
  if (p && z) up += `M${(p.x + p.w / 2).toFixed(1)} ${(p.y + p.h).toFixed(1)}L${(z.x + z.w / 2).toFixed(1)} ${z.y.toFixed(1)}`;
  svg.setAttribute('viewBox', `0 0 ${R.width.toFixed(1)} ${R.height.toFixed(1)}`);
  svg.innerHTML = `<path d="${up}" fill="none" stroke="var(--win)" stroke-opacity=".55" stroke-width="1.25"/><path d="${down}" fill="none" stroke="var(--loss)" stroke-opacity=".5" stroke-width="1.25"/>`;
}

function render() {
  renderCount(); renderSpark(); renderBoard(); renderLive();
  const live = eff.pi ? cur() : { r: 0 };
  document.getElementById('bracket').innerHTML = renderBracket(live);
  drawBracketLines();
  let html = renderPlayIn();
  for (let r = 1; r <= 5; r++) html += renderRound(r, live);
  if (live.r > 5) html += `<p class="done">The Swiss stage is fully decided. The eight teams in green go to the quarterfinal draw.</p>`;
  document.getElementById('rounds').innerHTML = html;
  const rd = eff.rounds[live.r - 1];
  const need = eff.pi && live.r <= 5 ? activeList(live.w, live.l).length / 2 : 0;
  document.getElementById('bDraw').disabled = !eff.pi || live.r > 5 || (rd && rd.pairs.length >= need);
  document.getElementById('bPlay').disabled = !eff.pi || live.r > 5 || !rd || rd.pairs.length < need;
  document.getElementById('bSim').disabled = live.r > 5;
  document.getElementById('bUndo').disabled = !undoStack.length;
  document.getElementById('bReset').disabled = !user.pi && !user.rounds.length;
  showStatus();
}
function commit(note) { refresh(note); selected = null; recount(); render(); }

// ---------- actions ----------
function act(a) {
  notice = '';
  const [kind, ...p] = a.split(':').map(x => isNaN(+x) ? x : +x);
  if (kind === 'pi') {
    if (activeLocks().pi) { setStatus('The Play-In final has been played, so its winner is locked.'); return; }
    snapshot(`${p[0]} wins Play-In`);
    user = { pi: user.pi === p[0] && eff.pi === p[0] ? null : p[0], rounds: [] };
    commit(); return;
  }
  const st = cur();
  if (kind === 'pick') {
    const i = p[0];
    if (selected === null || selected === i) { selected = selected === i ? null : i; render(); return; }
    if (busy || sharesPending || !latest || !latest.pairShare) { setStatus('Still working out which opponents are legal. Try again in a moment.'); return; }
    if (!(latest.pairShare.get(Math.min(i, selected) + '-' + Math.max(i, selected)) > 0n)) return;
    snapshot(`${name(selected)} v ${name(i)}`);
    user = editable();
    while (user.rounds.length < st.r) user.rounds.push({ pairs: [], win: [] });
    user.rounds[st.r - 1].pairs.push([selected, i]); user.rounds[st.r - 1].win.push(-1);
    commit(); return;
  }
  if (kind === 'unpair') {
    if (lockedFor(st.r)[p[0]]) return;
    snapshot('Undraw'); user = editable();
    user.rounds[st.r - 1].pairs.splice(p[0], 1); user.rounds[st.r - 1].win.splice(p[0], 1);
    commit(); return;
  }
  if (kind === 'win') {
    const [r, k, t] = p;
    const rd = eff.rounds[r - 1]; if (!rd) return;
    const before = recordsBefore(r);
    if (rd.pairs.length < activeList(before.w, before.l).length / 2) { setStatus('Finish this round’s draw first.'); return; }
    if (lockedFor(r)[k] === 2) { setStatus('That match has been played, so its result is locked.'); return; }
    const next = editable();
    if (r < st.r) next.rounds = next.rounds.slice(0, r);
    next.rounds[r - 1].win[k] = next.rounds[r - 1].win[k] === t ? -1 : t;
    const m = merge(activeLocks(), next);
    if (m.problems.length > merge(activeLocks(), EMPTY()).problems.length || m.conflict) {
      setStatus(`${name(t)} winning doesn't fit the real draw for the next round.`); return;
    }
    snapshot(`${name(t)} wins`); user = next; commit();
  }
}
document.getElementById('rounds').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || !b.dataset.act || b.disabled) return; act(b.dataset.act);
});
function drawRest(s) {
  setPlayIn(s.pi);
  const { r } = derive(s.rounds); const D = randomDraw(s.rounds); if (!D) return false;
  while (s.rounds.length < r) s.rounds.push({ pairs: [], win: [] });
  for (const pr of D) { s.rounds[r - 1].pairs.push(pr); s.rounds[r - 1].win.push(-1); }
  return true;
}
function playRest(s) {
  setPlayIn(s.pi);
  const { r } = derive(s.rounds); const rd = s.rounds[r - 1]; if (!rd) return;
  rd.win = rd.win.map((x, k) => x >= 0 ? x : rd.pairs[k][Math.random() < .5 ? 0 : 1]);
}
document.getElementById('bDraw').onclick = () => { notice = ''; snapshot('Random draw'); user = editable(); drawRest(user); commit(); };
document.getElementById('bPlay').onclick = () => { notice = ''; snapshot('Random results'); user = editable(); playRest(user); commit(); };
document.getElementById('bSim').onclick = () => { notice = '';
  snapshot('Simulated'); user = editable();
  if (!user.pi) user.pi = Math.random() < .5 ? 'KC' : 'MVK';
  for (let guard = 0; guard < 12; guard++) {
    setPlayIn(user.pi);
    const st = derive(user.rounds); if (st.r > 5) break;
    const rd = user.rounds[st.r - 1], need = activeList(st.w, st.l).length / 2;
    if (!rd || rd.pairs.length < need) { if (!drawRest(user)) break; } else playRest(user);
  }
  commit();
};
document.getElementById('bUndo').onclick = () => { notice = '';
  const s = undoStack.pop(); if (!s) return;
  user = JSON.parse(s.u); steps = steps.slice(0, s.steps); pendingLabel = null;
  refresh(); selected = null; recount(true); pendingLabel = null; render();
};
document.getElementById('bReset').onclick = () => { notice = ''; snapshot('Start over'); user = EMPTY(); commit(); };
document.getElementById('liveToggle').onchange = (e) => { liveOn = e.target.checked; pendingLabel = liveOn ? 'Real results on' : 'Real results off'; commit(true); };
window.addEventListener('resize', () => { renderSpark(); drawBracketLines(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBracketLines);
if (window.ResizeObserver) new ResizeObserver(() => drawBracketLines()).observe(document.getElementById('bracket'));

// ---------- live results ----------
async function poll() {
  if (window.SWISS_NO_LIVE) { liveInfo = { state: 'off' }; renderLive(); return; }
  try {
    const L = await LOL.fetchLocks();
    const changed = JSON.stringify(L) !== JSON.stringify(locks);
    locks = L;
    liveInfo = { state: 'ok', at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
    if (changed) { pendingLabel = pendingLabel ?? 'Real results'; commit(true); } else renderLive();
  } catch (err) {
    liveInfo = { state: 'error', msg: '' };
    if (latest === null) commit(); else renderLive();
  }
}
refresh(); recount(); render();
poll();
setInterval(() => { if (!document.hidden) poll(); }, 120000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();

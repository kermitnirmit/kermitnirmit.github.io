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
  runSims();
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
    : '';
  document.getElementById('approx').textContent = busy ? 'counting…' : frac;
  document.getElementById('mini').textContent = latest.total === 1n ? '1 Swiss stage left' : `≈ ${approx(latest.total)} Swiss stages left`;
  document.getElementById('meterfill').style.width = (100 * Math.max(0, log10(latest.total)) / log10(START)).toFixed(2) + '%';
}


function renderLive() {
  const el = document.getElementById('live'), txt = document.getElementById('liveText');
  el.classList.toggle('on', liveOn && liveInfo.state === 'ok');
  el.classList.toggle('err', liveInfo.state === 'error');
  let s;
  if (liveInfo.state === 'off') { txt.innerHTML = '<span class="dot"></span>Real results lock in automatically on the <a href="https://nirmit.dev/worlds-2026/">nirmit.dev version</a> of this page.'; el.querySelector('label').hidden = true; return; }
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

function recordsBefore(r) { return derive(eff.rounds.slice(0, r - 1)); }
// ---------- chances to advance ----------
// sim.js plays the rest of the stage SIM_RUNS times from what's on screen and sends back a running tally.
const SIM_RUNS = 20000;
let sim = null, simId = 0, simOut = null;
function startSim() {
  try { sim = new Worker('sim.js' + (window.SWISS_V ? '?v=' + window.SWISS_V : '')); } catch (e) { return; }
  sim.onmessage = (e) => { if (e.data.id === simId) { simOut = e.data; renderOdds(); } };
  sim.onerror = () => { sim = null; simOut = null; renderOdds(); };
}
startSim();
function runSims() {
  if (!sim) return;
  simId++;
  sim.postMessage({ id: simId, state: plain(eff), runs: SIM_RUNS, gpr: GPR.i });
  document.getElementById('oddsTable').classList.add('stale');
}
// Outcomes, in tally order: finish 3–0, 3–1, 3–2, 2–3, 1–3, 0–3, or lose the Play-In.
const OUTCOMES = ['3–0', '3–1', '3–2', '2–3', '1–3', '0–3', 'PI'];
const OUTCOME_TIPS = ['goes 3–0', 'goes 3–1', 'goes 3–2', 'is out at 2–3', 'is out at 1–3', 'is out at 0–3', 'loses the Play-In'];
// Whether outcome k can still happen for a team with record {w, l}; pi is 'pending' or 'lost' for a Play-In team.
function reachable(s, k) {
  if (s.pi === 'lost') return k === 6;
  if (k === 6) return s.pi === 'pending';
  if (k < 3) return s.w === 3 ? s.l === k : s.w < 3 && s.l <= k;
  return s.l === 3 ? s.w === 5 - k : s.w < 3 && s.w <= 5 - k;
}
function oddsCell(c, n, can, only) {
  if (!can) return '–';
  if (only) return '100%';
  const p = Math.round(100 * c / n);
  return c === 0 || p === 0 ? '<1%' : c === n || p === 100 ? '>99%' : p + '%';
}
function renderOdds() {
  const sec = document.getElementById('odds');
  if (!simOut || !simOut.n) { sec.hidden = true; return; }
  sec.hidden = false;
  const { tally, n, done, runs } = simOut;
  setPlayIn(eff.pi);
  // each team's record right now, to tell outcomes that can't happen any more (–) from ones that just didn't come up (<1%)
  const rec = bracketRecords(), now = {};
  for (let i = 0; i < 16; i++) if (i !== PI || eff.pi) now[name(i)] = { w: rec.w[i], l: rec.l[i] };
  for (const c of PLAYIN_CODES) if (!(c in now)) now[c] = eff.pi ? { pi: 'lost' } : { w: 0, l: 0, pi: 'pending' };
  const rows = Object.entries(tally).filter(([c]) => c in now).map(([c, t]) => {
    const can = OUTCOMES.map((_, k) => reachable(now[c], k));
    return { c, t, can, adv: t[0] + t[1] + t[2] };
  }).sort((a, b) => b.adv - a.adv || b.t[0] - a.t[0] || a.c.localeCompare(b.c));
  const exact = (v) => { const p = 100 * v / n; return p < 0.1 ? '<0.1%' : p > 99.9 && v < n ? '>99.9%' : p.toFixed(1) + '%'; };
  const seg = (c, k, v) => v ? `<i class="s${k}" style="width:${(100 * v / n).toFixed(2)}%" data-tip="${c} ${OUTCOME_TIPS[k]}: <b>${exact(v)}</b>"></i>` : '';
  // The bar holds the breakdown by final record (hover a segment for it); the column is the chance to advance.
  document.getElementById('oddsTable').classList.remove('stale');
  document.getElementById('oddsTable').innerHTML =
    `<div class="oh"><span>Team</span><span></span><span class="adv">Advance</span></div>` +
    rows.map(({ c, t, can, adv }) => {
      const canAdv = can[0] || can[1] || can[2], canOut = can[3] || can[4] || can[5] || can[6];
      // eliminated, for real or in the viewer's picks: nothing left to win
      return `<div class="or${canAdv ? '' : ' gone'}"><b>${c}${rg(c)}</b><span class="obar">${t.map((v, k) => seg(c, k, v)).join('')}</span>` +
        `<span class="adv">${oddsCell(adv, n, canAdv, !canOut)}</span></div>`;
    }).join('');
  document.getElementById('oddsSub').textContent = done < runs ? `simulating… ${done.toLocaleString()} of ${runs.toLocaleString()}` : `${n.toLocaleString()} simulations`;
  const picks = eff.rounds.reduce((s, rd) => s + rd.win.filter((x, k) => x >= 0 && (rd.lock || [])[k] !== 2).length, 0) + (eff.pi && !activeLocks().pi ? 1 : 0);
  document.getElementById('oddsNote').textContent = `Plays out from the bracket above` +
    (picks ? `, keeping the real results and your ${picks} pick${picks === 1 ? '' : 's'}` : `, keeping every real result`) +
    `. Draws are random among the legal ones; every game is won at its GPR chance.`;
}
// Hovering a bar segment shows its exact share of the simulations.
const oddsTip = document.getElementById('oddsTip');
function placeTip(e) {
  const r = oddsTip.getBoundingClientRect();
  let x = e.clientX + 12, y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
  if (y < 8) y = e.clientY + 16;
  oddsTip.style.left = Math.max(8, x) + 'px'; oddsTip.style.top = y + 'px';
}
const oddsBox = document.getElementById('oddsTable');
oddsBox.addEventListener('pointermove', (e) => {
  const seg = e.target.closest('[data-tip]');
  document.querySelectorAll('.obar i.hot').forEach(i => i !== seg && i.classList.remove('hot'));
  if (!seg) { oddsTip.hidden = true; return; }
  seg.classList.add('hot');
  oddsTip.innerHTML = seg.dataset.tip; oddsTip.hidden = false; placeTip(e);
});
oddsBox.addEventListener('pointerleave', () => { oddsTip.hidden = true; document.querySelectorAll('.obar i.hot').forEach(i => i.classList.remove('hot')); });

// ---------- regions ----------
const REGIONS = ['LCK', 'LPL', 'LEC', 'LCS', 'LCP', 'CBLOL'];
let rgPin = null, rgHover = null;
// every decided match on the bracket, Play-In final included: {when, a, b, ra, rb, x (winner code), real}
function decidedMatches() {
  const out = [];
  if (eff.pi) out.push({ when: 'Play-In', a: 'KC', b: 'MVK', ra: PLAYIN.KC.region, rb: PLAYIN.MVK.region, x: eff.pi, real: !!activeLocks().pi });
  eff.rounds.forEach((rd, r) => rd.pairs.forEach(([a, b], k) => {
    const x = rd.win[k]; if (x < 0) return;
    out.push({ when: 'Round ' + (r + 1), a: name(a), b: name(b), ra: T[a].region, rb: T[b].region, x: name(x), real: (rd.lock || [])[k] === 2 });
  }));
  return out.filter(m => m.ra && m.rb);
}
// [won, played] for region r, against region vs or every other region
function rgRecord(ms, r, vs) {
  let w = 0, n = 0;
  for (const m of ms) {
    if (m.ra === m.rb) continue;
    const mine = m.ra === r ? m.a : m.rb === r ? m.b : null, opp = m.ra === r ? m.rb : m.ra;
    if (!mine || (vs && opp !== vs)) continue;
    n++; if (m.x === mine) w++;
  }
  return [w, n];
}
const rgPct = (w, n) => n ? Math.round(100 * w / n) + '%' : '–';
function renderRegions() {
  const sec = document.getElementById('regions');
  if (eff.pi) setPlayIn(eff.pi);
  const ms = decidedMatches();
  if (!ms.some(m => m.ra !== m.rb)) { sec.hidden = true; return; }
  sec.hidden = false;
  // shaded by how far from even, green for winning and red for losing
  const cell = (r, c) => {
    if (r === c) return '<td class="self"></td>';
    const [w, n] = rgRecord(ms, r, c);
    if (!n) return '<td class="none"></td>';
    const p = w / n, a = Math.round(Math.abs(p - .5) * 2 * 60);
    const bg = p === .5 ? '' : ` style="background:color-mix(in srgb, var(--${p > .5 ? 'win' : 'loss'}) ${a}%, transparent)"`;
    return `<td data-rg="${r}:${c}"${bg}><b>${w}–${n - w}</b></td>`;
  };
  // the row's record against every other region
  const total = (r) => { const [w, n] = rgRecord(ms, r); return `<td class="tot" data-rg="${r}"><b>${w}–${n - w}</b><span>${rgPct(w, n)}</span></td>`; };
  document.getElementById('rgGrid').innerHTML = `<thead><tr><th></th>${REGIONS.map(c => `<th scope="col">${c}</th>`).join('')}<th scope="col" class="tot">Total</th></tr></thead>` +
    `<tbody>${REGIONS.map(r => `<tr><th scope="row">${r}</th>${REGIONS.map(c => cell(r, c)).join('')}${total(r)}</tr>`).join('')}</tbody>`;
  const picks = ms.filter(m => !m.real && m.ra !== m.rb).length, same = ms.filter(m => m.ra === m.rb).length;
  document.getElementById('rgNote').textContent = 'Every decided match above, counted once whatever its length. ' +
    (picks ? `${picks} of them ${picks === 1 ? 'is' : 'are'} your own pick${picks === 1 ? '' : 's'}, not ${picks === 1 ? 'a real result' : 'real results'}. ` : '') +
    (same ? `${same} match${same === 1 ? '' : 'es'} between two teams from the same region ${same === 1 ? 'is' : 'are'} left out.` : '');
  renderRgCap(ms);
}
function renderRgCap(ms) {
  const sel = rgHover || rgPin;
  document.querySelectorAll('#regions [data-rg]').forEach(e => { e.classList.toggle('on', e.dataset.rg === sel); e.classList.toggle('pin', e.dataset.rg === rgPin); });
  const el = document.getElementById('rgCap');
  if (!sel) { el.innerHTML = '<span class="hint">Hover or tap a square or a total to see its matches.</span>'; return; }
  const [r, c] = sel.split(':');
  const list = ms.filter(m => m.ra !== m.rb && (m.ra === r || m.rb === r) && (!c || m.ra === c || m.rb === c));
  const [w, n] = rgRecord(ms, r, c);
  el.innerHTML = `<b>${r}${c ? ' v ' + c : ''}</b> ${w}–${n - w}: ` + list.map(m => {
    const loser = m.x === m.a ? m.b : m.a;
    return `<span class="m${m.real ? '' : ' pick'}">${m.x} beat ${loser} <em>${m.when}${m.real ? '' : ', your pick'}</em></span>`;
  }).join('');
}
const rgBox = document.getElementById('regions');
rgBox.addEventListener('pointerover', e => {
  if (matchMedia('(hover: none)').matches) return;
  const t = e.target.closest('[data-rg]'); const v = t ? t.dataset.rg : null;
  if (v !== rgHover) { rgHover = v; renderRgCap(decidedMatches()); }
});
rgBox.addEventListener('pointerleave', () => { rgHover = null; renderRgCap(decidedMatches()); });
rgBox.addEventListener('click', e => {
  const t = e.target.closest('[data-rg]'); if (!t) return;
  rgPin = rgPin === t.dataset.rg ? null : t.dataset.rg;
  renderRgCap(decidedMatches());
});

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
// match cell: each row is a button that picks that team as the winner
// small region label next to a team code (KC and MVK come from the Play-In table)
function regionOf(code) {
  const t = T.find(t => t.id === code);
  return (t && t.region) || (PLAYIN[code] && PLAYIN[code].region) || '';
}
const rg = (code) => { const r = regionOf(code); return r ? `<i class="rg">${r}</i>` : ''; };
// tag every rendered team with its bracket slot, so hovering one can trace its path
const dt = (code) => { const i = T.findIndex(t => t.id === code); return i >= 0 ? ` data-team="${i}"` : ''; };
function bCell(top, bot, x, actTop, actBot, locked, unpairAct, bo, score) {
  // chance to win the series from Riot's Global Power Rankings, same odds the simulator plays with;
  // a series that has been played out shows the games each side took instead of the chance it had
  const known = top in GPR.pts && bot in GPR.pts;
  const pTop = known ? Math.round(100 * gprSeries(top, bot, bo)) : null;
  const notes = score ? score.map(String) : pTop === null ? [null, null] : [pTop + '%', (100 - pTop) + '%'];
  const note = score ? 'wp sc' : 'wp';
  const label = (name, p) => `<span class="nm">${name}${rg(name)}</span>${p === null ? '' : `<small class="${note}">${p}</small>`}`;
  const row = (name, p, cls, act) => act
    ? `<button class="${cls}"${dt(name)} data-act="${act}" ${locked ? 'aria-disabled="true"' : ''} title="${locked ? 'Real result' : 'Pick the winner'}">${label(name, p)}</button>`
    : `<span class="${cls}"${dt(name)}>${label(name, p)}</span>`;
  const extra = locked ? `<span class="blk" title="Real result">${LOCK_SVG}</span>`
    : unpairAct ? `<button class="ux" data-act="${unpairAct}" aria-label="Undraw this match" title="Undraw this match">×</button>` : '';
  return `<div class="bx ${locked ? 'real' : ''} ${extra ? 'hasicon' : ''}">${row(top, notes[0], x === 1 ? 'w' : x === 2 ? 'l' : '', actTop)}${row(bot, notes[1], x === 2 ? 'w' : x === 1 ? 'l' : '', actBot)}${extra}</div>`;
}
// undrawn teams: in the current round each is a button that drafts it into a match, same as the main page
function bSlots(teams, total, drawable, r, bo) {
  const shares = drawable && !busy && !sharesPending && latest && latest.r === r && latest.pairShare ? latest : null;
  const slot = (i) => {
    if (!drawable) return `<span class="bslot" data-team="${i}" title="${T[i].name}">${bName(i)}${rg(bName(i))}</span>`;
    let cls = '', dis = false;
    if (selected === i) cls = 'sel';
    else if (selected !== null) {
      const v = shares && shares.pairShare.get(Math.min(i, selected) + '-' + Math.max(i, selected));
      if (v !== undefined && v > 0n) cls = 'elig'; else { cls = 'dim'; dis = !!shares; }
    }
    const odds = cls === 'elig' ? ` <small>${Math.round(100 * gprSeries(name(selected), name(i), bo))}%</small>` : '';
    return `<button class="bslot ${cls}" data-team="${i}" data-act="pick:${i}" ${dis ? 'disabled' : ''} title="${T[i].name}">${bName(i)}${rg(bName(i))}${odds}</button>`;
  };
  return `<div class="bslots">${teams.map(slot).join('')}${Array.from({ length: Math.max(0, total - teams.length) }, () => '<span class="bslot q">?</span>').join('')}</div>`;
}
function bPool(key, rec, curR) {
  if (key === 'pi') {
    const x = eff.pi === 'KC' ? 1 : eff.pi === 'MVK' ? 2 : 0, locked = !!activeLocks().pi;
    return `<div class="bpool ${curR === 0 ? 'now' : ''}" data-rec="pi"><div class="bh"><span>Play-In</span><em>Bo5</em></div>${bCell('KC', 'MVK', x, 'pi:KC', 'pi:MVK', locked, null, 5)}</div>`;
  }
  const [w, l] = key.split('-').map(Number);
  if (key in END_INFO) {
    const ts = [...Array(16).keys()].filter(i => rec.w[i] === w && rec.l[i] === l);
    return `<div class="bpool end ${w === 3 ? 'adv' : 'out'}" data-rec="${key}"><h5>${w}–${l}<em>${w === 3 ? 'in' : 'out'}</em></h5>${bSlots(ts, END_INFO[key], false)}</div>`;
  }
  const r = w + l + 1, [n, bo] = POOL_INFO[key], st = rec.start[r - 1];
  const rd = eff.rounds[r - 1] || { pairs: [], win: [] }, lock = rd.lock || [];
  const known = [...Array(16).keys()].filter(i => st.w[i] === w && st.l[i] === l && st.w[i] + st.l[i] === r - 1);
  const pairs = rd.pairs.map((p, k) => [p, rd.win[k], k]).filter(([[a]]) => st.w[a] === w && st.l[a] === l);
  const used = new Set(pairs.flatMap(([p]) => p));
  const waiting = known.filter(i => !used.has(i));
  const clickable = eff.pi && r <= curR;   // this round or an earlier one
  const undrawable = r === curR && rd.win.every(v => v < 0);
  let body = pairs.map(([[a, b], x, k]) => bCell(bName(a), bName(b), x === a ? 1 : x === b ? 2 : 0,
    clickable ? `win:${r}:${k}:${a}` : null, clickable ? `win:${r}:${k}:${b}` : null, lock[k] === 2,
    undrawable && !lock[k] ? `unpair:${k}` : null, boOf(w, l))).join('');
  const open = n - 2 * pairs.length;
  if (open > 0) body += pairs.length || waiting.length ? bSlots(waiting, open, eff.pi && r === curR, r, boOf(w, l)) : Array.from({ length: open / 2 }, () => '<div class="bx tbd"><span>—</span><span>—</span></div>').join('');
  return `<div class="bpool ${curR === r ? 'now' : ''}" data-rec="${key}"><div class="bh"><span>${w}–${l}</span><em>${bo}</em></div>${body}</div>`;
}
function renderBracket(live) {
  const rec = bracketRecords(), curR = eff.pi ? live.r : 0;
  const heads = BHEADS.map((h, c) => `<span class="${curR === c + 1 ? 'now' : ''}">${h}</span>`).join('');
  const cols = BCOLS.map((keys, c) => `<div class="bcol c${c + 1} ${curR === c + 1 ? 'now' : ''}" data-head="${BHEADS[c]}">${keys.map(k => bPool(k, rec, curR)).join('')}</div>`).join('');
  return `<div class="bheads">${heads}</div><div class="bgrid">${cols}</div><svg class="blines" aria-hidden="true"></svg>`;
}
const f1 = (n) => n.toFixed(1);
// one box to the next: left to right on wide screens, top to bottom on narrow ones
function curveTo(s, b, vertical) {
  if (vertical) {
    const x1 = s.x + s.w / 2, y1 = s.y + s.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
    return `M${f1(x1)} ${f1(y1)}C${f1(x1)} ${f1(my)} ${f1(x2)} ${f1(my)} ${f1(x2)} ${f1(y2)}`;
  }
  const x1 = s.x + s.w, y1 = s.y + s.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
  return `M${f1(x1)} ${f1(y1)}C${f1(mx)} ${f1(y1)} ${f1(mx)} ${f1(y2)} ${f1(x2)} ${f1(y2)}`;
}
// measure boxes inside one bracket, relative to that bracket
function boxer(id) {
  const root = document.getElementById(id), svg = root && root.querySelector('svg.blines');
  if (!svg) return null;
  const R = root.getBoundingClientRect();
  const rect = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left - R.left, y: b.top - R.top, w: b.width, h: b.height }; };
  return { svg, root, rect, w: R.width, h: R.height,
    vertical: !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches),
    box: (k) => rect(root.querySelector(`[data-rec="${k}"]`)) };
}
function paintLines(m, paths) {
  m.svg.setAttribute('viewBox', `0 0 ${f1(m.w)} ${f1(m.h)}`);
  m.svg.innerHTML = paths.map(([d, c, o, w]) => `<path d="${d}" fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${w || 1.25}" stroke-linecap="round"/>`).join('');
}

// ---------- tracing one team through the Swiss stage ----------
const bracketEl = document.getElementById('bracket');
let tracing = null;
// the pools a team sits in, in order: every record it has actually held, then where it finished
function teamPath(i) {
  const rec = bracketRecords(), keys = i === PI ? ['pi'] : [];
  for (let r = 0; r < 5; r++) {
    const w = rec.start[r].w[i], l = rec.start[r].l[i];
    if (w + l !== r || w >= 3 || l >= 3) break;
    keys.push(w + '-' + l);
  }
  if (rec.w[i] === 3 || rec.l[i] === 3) keys.push(rec.w[i] + '-' + rec.l[i]);
  return keys;
}
function setTrace(i) {
  if (tracing === i) return;
  tracing = i;
  bracketEl.classList.toggle('tracing', i !== null);
  for (const e of bracketEl.querySelectorAll('[data-team].on')) e.classList.remove('on');
  if (i !== null) for (const e of bracketEl.querySelectorAll(`[data-team="${i}"]`)) e.classList.add('on');
  drawBracketLines();
}
bracketEl.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-team]');
  setTrace(el ? +el.dataset.team : null);
});
bracketEl.addEventListener('mouseleave', () => setTrace(null));

function drawBracketLines() {
  const m = boxer('bracket'); if (!m) return;
  const curve = (s, b) => curveTo(s, b, m.vertical);
  let up = '', down = '';
  for (const key of Object.keys(POOL_INFO)) {
    const [w, l] = key.split('-').map(Number), s = m.box(key); if (!s) continue;
    const bw = m.box(`${w + 1}-${l}`), bl = m.box(`${w}-${l + 1}`);
    if (bw) up += curve(s, bw);
    if (bl) down += curve(s, bl);
  }
  const p = m.box('pi'), z = m.box('0-0');
  if (p && z) up += `M${f1(p.x + p.w / 2)} ${f1(p.y + p.h)}L${f1(z.x + z.w / 2)} ${f1(z.y)}`;
  const on = tracing !== null;
  const paths = [[up, 'var(--win)', on ? '.3' : '.55'], [down, 'var(--loss)', on ? '.28' : '.5']];
  if (on) {
    let d = '', prev = null;
    for (const key of teamPath(tracing)) {
      const pool = m.root.querySelector(`[data-rec="${key}"]`);
      const b = m.rect(pool && pool.querySelector(`[data-team="${tracing}"]`)) || m.box(key);
      if (!b) continue;
      if (prev) d += curve(prev, b);
      prev = b;
    }
    paths.push([d, 'var(--accent)', '.95', 2.5]);
  }
  paintLines(m, paths);
}
function drawKoLines() {
  const m = boxer('kbracket'); if (!m) return;
  let d = '';
  for (let k = 4; k <= 6; k++) for (const from of KO_FEED[k]) {
    const s = m.box('k' + from), b = m.box('k' + k);
    if (s && b) d += curveTo(s, b, m.vertical);
  }
  paintLines(m, [[d, 'var(--accent)', '.5']]);
}
function drawAllLines() { drawBracketLines(); drawKoLines(); }

// ---------- knockout stage ----------
// Riot's rule: the two 3-0 teams go on opposite sides of the bracket and each draw one of the
// three 3-2 teams. The last 3-2 and the three 3-1 teams fill the other two quarterfinals.
// Pinning the first 3-0 team to QF1 leaves exactly 36 brackets, and 36 x 2^7 = 4,608 knockouts.
const KO_HEADS = ['Quarterfinals', 'Semifinals', 'Final'];
const KO_LABEL = ['Quarterfinal 1', 'Quarterfinal 2', 'Quarterfinal 3', 'Quarterfinal 4', 'Semifinal 1', 'Semifinal 2', 'Final'];
const KO_FEED = [null, null, null, null, [0, 1], [2, 3], [4, 5]];
const KO_SIZE = [2, 3, 3];              // teams that finish 3-0, 3-1, 3-2
const KO_ODDS = [[['a 3–2 team', '1 in 3']],
                 [['another 3–1 team', '1 in 3'], ['a 3–2 team', '1 in 9']],
                 [['a 3–0 team', '1 in 3'], ['a 3–1 team', '1 in 9']]];
const P4 = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];   // the three ways four teams pair off
const KO_WAYS = 4608n;
let ko = null;        // {sig, qf: [pair or null x4], win: [7], score: [7]}
let koSel = null;     // team the viewer has tapped, waiting for an opponent

function qualifiers() {
  const rec = bracketRecords(), g = [[], [], []];
  for (let i = 0; i < 16; i++) if (rec.w[i] === 3) g[rec.l[i]].push(i);
  return { g, full: g.every((a, k) => a.length === KO_SIZE[k]), sig: g.map(a => a.join(',')).join('|') };
}
// every bracket the rule allows, as four quarterfinals in order
function koArrangements(q) {
  const [z, o, t] = q.g, out = [];
  for (let k = 0; k < 3; k++) {                                        // which 3-2 joins the 3-1s
    const rest = t.filter((_, j) => j !== k), four = o.concat(t[k]);
    for (const [p, r] of [[rest[0], rest[1]], [rest[1], rest[0]]])     // which 3-2 meets which 3-0
      for (const m of P4) for (const s of [0, 1]) {                    // how the other four pair and sit
        const a = [four[m[0]], four[m[1]]], b = [four[m[2]], four[m[3]]];
        out.push([[z[0], p], s ? b : a, [z[1], r], s ? a : b]);
      }
  }
  return out;
}
const samePair = (p, x) => !!p && !!x && ((p[0] === x[0] && p[1] === x[1]) || (p[0] === x[1] && p[1] === x[0]));
// the brackets still open given what has been drawn so far
function koOpen(q, qf) { return koArrangements(q).filter(A => qf.every((p, s) => !p || samePair(p, A[s]))); }
// who a tapped team can still be drawn against
function koPartners(q, qf, i) {
  const set = new Set();
  for (const A of koOpen(q, qf)) for (const [x, y] of A) { if (x === i) set.add(y); else if (y === i) set.add(x); }
  return set;
}
const koSlotFor = (q, qf, a, b) => {
  for (let s = 0; s < 4; s++) if (!qf[s] && koOpen(q, qf.map((p, k) => k === s ? [a, b] : p)).length) return s;
  return -1;
};
const koSeats = (m) => m < 4 ? (ko.qf[m] || [-1, -1]) : KO_FEED[m].map(k => ko.win[k]);
function koClear(m) { ko.win[m] = -1; ko.score[m] = null; }
// drop any winner whose seat is gone; feeds always come earlier, so one pass does it
function koFix() { for (let m = 0; m < 7; m++) if (ko.win[m] >= 0 && !koSeats(m).includes(ko.win[m])) koClear(m); }
function koStart(q) { if (!ko || ko.sig !== q.sig) ko = { sig: q.sig, qf: [null, null, null, null], win: Array(7).fill(-1), score: Array(7).fill(null) }; }
function koPlace(q, a, b) {
  const s = koSlotFor(q, ko.qf, a, b);
  if (s < 0) return false;
  ko.qf[s] = q.g[0].includes(b) ? [b, a] : [a, b];   // the 3-0 team sits on top
  return true;
}
function koDrawRest(q) {
  const opts = koOpen(q, ko.qf);
  if (!opts.length) return;
  const A = opts[Math.floor(Math.random() * opts.length)];
  for (let s = 0; s < 4; s++) if (!ko.qf[s]) ko.qf[s] = A[s].slice();
}
// Picking a winner by hand is a what-if, so it carries no scoreline: only a series that
// was actually played out — simulated here, or read off lolesports — knows how the games went.
function koSet(m, t) { ko.win[m] = t; ko.score[m] = null; }
function koSimRest() {
  for (let m = 0; m < 7; m++) {
    const [a, b] = koSeats(m);
    if (ko.win[m] >= 0 || a < 0 || b < 0) continue;
    const s = playScore(name(a), name(b), 5);
    ko.win[m] = s.a > s.b ? a : b;
    ko.score[m] = Math.min(s.a, s.b);
  }
}
function koWays(q) {
  if (!ko) return KO_WAYS;
  return BigInt(koOpen(q, ko.qf).length) * (1n << BigInt(ko.win.filter(x => x < 0).length));
}
const koDrawn = () => ko && ko.qf.every(Boolean);

// who each record bucket can draw, and the teams in it so far
function renderKodds(q) {
  const placed = new Set(ko ? ko.qf.flatMap(p => p || []) : []);
  const mates = koSel === null ? null : koPartners(q, ko.qf, koSel);
  return q.g.map((ts, k) => {
    const tags = ts.map(i => {
      const nm = `${bName(i)}${rg(bName(i))}`;
      if (!ko || placed.has(i)) return `<span class="tag ${placed.has(i) ? 'drawn' : ''}" title="${T[i].name}">${nm}</span>`;
      const cls = koSel === i ? 'sel' : koSel === null ? '' : mates.has(i) ? 'elig' : 'dim';
      return `<button class="tag ${cls}" data-act="ksel:${i}" ${cls === 'dim' ? 'disabled' : ''} title="${T[i].name}">${nm}</button>`;
    }).join('') + Array.from({ length: KO_SIZE[k] - ts.length }, () => '<span class="tag slot">?</span>').join('');
    const odds = KO_ODDS[k].map(([who, p]) => `<span>${who} <b>${p}</b></span>`).join('');
    return `<div class="korow"><h4>3–${k}<em>${ts.length} of ${KO_SIZE[k]}</em></h4><div class="kot">${tags}</div><div class="koo">${odds}</div></div>`;
  }).join('');
}
function koCell(m) {
  const [a, b] = ko ? koSeats(m) : [-1, -1], x = ko ? ko.win[m] : -1, live = a >= 0 && b >= 0;
  const an = a >= 0 ? bName(a) : '—', bn = b >= 0 ? bName(b) : '—';
  const sc = ko && x >= 0 && ko.score[m] !== null ? (x === a ? [3, ko.score[m]] : [ko.score[m], 3]) : null;
  return `<div class="bpool ${live ? '' : 'tbd'}" data-rec="k${m}"><div class="bh"><span>${KO_LABEL[m]}</span><em>Bo5</em></div>`
    + bCell(an, bn, x < 0 ? 0 : x === a ? 1 : 2, live ? `kwin:${m}:${a}` : null, live ? `kwin:${m}:${b}` : null,
            false, m < 4 && ko && ko.qf[m] ? `kunpair:${m}` : null, 5, sc)
    + `</div>`;
}
function renderKoBracket() {
  const heads = KO_HEADS.map(h => `<span>${h}</span>`).join('');
  const cols = [[0, 1, 2, 3], [4, 5], [6]].map((ms, c) =>
    `<div class="bcol kc${c + 1}" data-head="${KO_HEADS[c]}">${ms.map(koCell).join('')}</div>`).join('');
  return `<div class="bheads">${heads}</div><div class="bgrid">${cols}</div><svg class="blines" aria-hidden="true"></svg>`;
}
function koNote(q, made) {
  if (ko && ko.win[6] >= 0) return `<b>${T[ko.win[6]].name}</b> win Worlds 2026.`;
  if (!q.full) return `${8 - made} more team${made === 7 ? '' : 's'} still to qualify. Finish the Swiss stage above to draw the quarterfinals.`;
  if (!koDrawn()) return koSel !== null
    ? `Now tap <b>${name(koSel)}</b>’s quarterfinal opponent. Dashed teams are legal. Tap ${name(koSel)} again to cancel.`
    : 'Tap a team, then its quarterfinal opponent — or draw the rest at random. Each match has an × to undo it.';
  return 'Tap the winner of each match, or tap a decided match again to undo it.';
}
function renderKo() {
  const q = qualifiers();
  if (ko && ko.sig !== q.sig) { ko = null; koSel = null; }
  if (q.full) koStart(q);
  const made = q.g.reduce((n, a) => n + a.length, 0), ways = koWays(q);
  document.getElementById('kodds').innerHTML = renderKodds(q);
  document.getElementById('koCount').textContent = !q.full ? `${made} of 8 teams in`
    : ways === 1n ? 'one bracket, fully decided' : commas(ways) + ' ways left';
  document.getElementById('kbracket').innerHTML = renderKoBracket();
  drawKoLines();
  document.getElementById('koNote').innerHTML = koNote(q, made);
  document.getElementById('bKoDraw').textContent = koDrawn() ? 'Draw again' : 'Draw the rest';
  document.getElementById('bKoDraw').disabled = !q.full;
  document.getElementById('bKoSim').disabled = !q.full;
  document.getElementById('bKoClear').disabled = !ko || (!koDrawn() && !ko.qf.some(Boolean) && ko.win.every(x => x < 0));
}
document.getElementById('kodds').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled || !ko) return;
  const i = +b.dataset.act.split(':')[1], q = qualifiers();
  if (koSel === i) koSel = null;
  else if (koSel === null) koSel = i;
  else if (koPlace(q, koSel, i)) koSel = null;
  renderKo();
});
document.getElementById('kbracket').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled || !ko) return;
  const [kind, m, t] = b.dataset.act.split(':').map(x => isNaN(+x) ? x : +x);
  if (kind === 'kunpair') { ko.qf[m] = null; koSel = null; }
  else if (kind === 'kwin') { if (ko.win[m] === t) koClear(m); else koSet(m, t); }
  else return;
  koFix(); renderKo();
});
document.getElementById('bKoDraw').onclick = () => { const q = qualifiers(); if (!q.full) return; if (koDrawn()) { ko = null; koStart(q); } koSel = null; koDrawRest(q); koFix(); renderKo(); };
document.getElementById('bKoSim').onclick = () => { const q = qualifiers(); if (!q.full) return; koSel = null; koDrawRest(q); koSimRest(); renderKo(); };
document.getElementById('bKoClear').onclick = () => { ko = null; koSel = null; renderKo(); };

function nextStep(live) {
  if (!eff.pi) return 'Start with the Play-In final: tap the team that wins.';
  if (live.r > 5) return 'Every match is decided. Tap any winner to rewrite that round.';
  const r = live.r, rd = eff.rounds[r - 1] || { pairs: [] }, need = activeList(live.w, live.l).length / 2;
  if (rd.pairs.length < need) {
    if (selected !== null) return `Now tap <b>${name(selected)}</b>’s opponent. Dashed teams are legal, with ${name(selected)}’s chance to beat them. Tap ${name(selected)} again to cancel.`;
    return r === 1 ? '<b>Round 1 draw.</b> Tap a team in the 0–0 box, then its opponent. Tier 1 meets tier 4, tier 2 meets tier 3, and teams from the same region can’t meet.'
      : `<b>Round ${r} draw.</b> Tap a team, then an opponent with the same record it hasn’t played yet.`;
  }
  return `<b>Round ${r}.</b> Tap the winner of each match. You can also tap a winner in an earlier round to rewrite it.`;
}

function render() {
  renderCount(); renderRegions(); renderLive();
  const live = eff.pi ? cur() : { r: 0 };
  bracketEl.innerHTML = renderBracket(live);
  tracing = null; bracketEl.classList.remove('tracing');
  drawBracketLines();
  renderKo();
  let html = live.r > 5 ? `<p class="done">Swiss stage decided. These eight go to the quarterfinal draw.</p>` : '';
  document.getElementById('after').innerHTML = html;
  document.getElementById('nextStep').innerHTML = nextStep(live);
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
document.getElementById('bracket').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || !b.dataset.act || b.disabled) return;
  if (b.getAttribute('aria-disabled') === 'true') { setStatus('That match has been played, so its result is locked.'); return; }
  act(b.dataset.act);
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
  const { r, w, l } = derive(s.rounds); const rd = s.rounds[r - 1]; if (!rd) return;
  rd.win = rd.win.map((x, k) => { if (x >= 0) return x; const [a, b] = rd.pairs[k]; return playSeries(name(a), name(b), boOf(w[a], l[a])) ? a : b; });
}
document.getElementById('bDraw').onclick = () => { notice = ''; snapshot('Random draw'); user = editable(); drawRest(user); commit(); };
document.getElementById('bPlay').onclick = () => { notice = ''; snapshot('Random results'); user = editable(); playRest(user); commit(); };
document.getElementById('bSim').onclick = () => { notice = '';
  snapshot('Simulated'); user = editable();
  if (!user.pi) user.pi = playSeries('KC', 'MVK', 5) ? 'KC' : 'MVK';
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
window.addEventListener('resize', drawAllLines);
// The compact count only appears once the full count has scrolled out of view.
if (window.IntersectionObserver) {
  new IntersectionObserver(([e]) => document.getElementById('mini').classList.toggle('show', !e.isIntersecting))
    .observe(document.getElementById('count'));
}
const themeBtn = document.getElementById('bTheme');
function syncThemeBtn() {
  const light = document.documentElement.dataset.swiss === 'light';
  themeBtn.textContent = light ? 'Dark mode' : 'Light mode';
  themeBtn.setAttribute('aria-pressed', String(light));
}
themeBtn.onclick = () => {
  const light = document.documentElement.dataset.swiss !== 'light';
  if (light) document.documentElement.dataset.swiss = 'light'; else delete document.documentElement.dataset.swiss;
  try { localStorage.setItem('swiss-theme', light ? 'light' : 'dark'); } catch (e) {}
  syncThemeBtn(); drawAllLines();
};
syncThemeBtn();

// Which GPR snapshot the win chances are read from.
const gprSel = document.getElementById('gprSet');
gprSel.innerHTML = GPR.sets.map((s, i) => `<option value="${i}">${s.label}</option>`).join('');
try { const k = GPR.sets.findIndex(s => s.id === localStorage.getItem('swiss-gpr')); if (k >= 0) gprUse(k); } catch (e) {}
function syncGpr() { gprSel.value = String(GPR.i); document.getElementById('gprAsOf').textContent = GPR.asOf; }
gprSel.onchange = () => {
  gprUse(+gprSel.value);
  try { localStorage.setItem('swiss-gpr', GPR.sets[GPR.i].id); } catch (e) {}
  syncGpr(); render(); runSims();
};
syncGpr();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawAllLines);
if (window.ResizeObserver) for (const id of ['bracket', 'kbracket']) new ResizeObserver(drawAllLines).observe(document.getElementById(id));

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

// Plays out the rest of the Swiss stage many times, from the bracket as it stands (real results and the
// viewer's picks stay fixed), to estimate how each team finishes: 3–0, 3–1, 3–2, 2–3, 1–3 or 0–3.
// Teams are bits in a 16-bit mask throughout, so a run allocates almost nothing.
if (typeof analyzeState === 'undefined') importScripts('engine.js' + (self.location.search || ''), 'gpr.js' + (self.location.search || ''));

// Series odds for every pair, per Play-In winner: [a*16+b] -> chance a beats b in a Bo1 / Bo3.
// The Bo3 odds come from playing it game by game (gprSeries), so one draw at those odds picks the
// winner exactly as often as simulating each game would.
const odds = {};
function oddsFor(pi) {
  if (odds[pi]) return odds[pi];
  setPlayIn(pi);
  const bo1 = new Float64Array(256), bo3 = new Float64Array(256);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    bo1[a * 16 + b] = gprSeries(TEAMS[a].id, TEAMS[b].id, 1);
    bo3[a * 16 + b] = gprSeries(TEAMS[a].id, TEAMS[b].id, 3);
  }
  // Round 1 partners allowed by tier and region, which depend on who won the Play-In.
  const r1 = new Int32Array(N);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (canPair(a, b, 1, null, null, null)) r1[a] |= 1 << b;
  return (odds[pi] = { bo1, bo3, r1 });
}
const PI_KC = gprSeries('KC', 'MVK', 5);
let TIER14 = 0;
for (let i = 0; i < N; i++) if (TEAMS[i].tier === 1 || TEAMS[i].tier === 4) TIER14 |= 1 << i;

// ok[i]: who team i may still be drawn against, within its pool.
const ok = new Int32Array(N);
const low = (m) => 31 - Math.clz32(m & -m);
// Number of legal ways to pair up every team in mask, memoized per pool (gen changes whenever ok does).
const memoN = new Float64Array(1 << 16), memoGen = new Int32Array(1 << 16);
let gen = 0;
function pairings(mask) {
  if (!mask) return 1;
  if (memoGen[mask] === gen) return memoN[mask];
  const rest = mask & ~(mask & -mask);
  let t = 0, m = ok[low(mask)] & rest;
  while (m) { const lb = m & -m; m ^= lb; t += pairings(rest & ~lb); }
  memoGen[mask] = gen; memoN[mask] = t;
  return t;
}
// Draws a uniformly random legal pairing of mask: the lowest team's partner is picked in proportion to how
// many ways the rest can still be paired, so every complete pairing is equally likely. Appends to pairs/win.
function drawPool(mask, pairs, win) {
  while (mask) {
    const a = low(mask), rest = mask & ~(1 << a);
    let total = 0, m = ok[a] & rest;
    const cand = [], ways = [];
    while (m) { const lb = m & -m; m ^= lb; const n = pairings(rest & ~lb); if (n) { cand.push(lb); ways.push(n); total += n; } }
    if (!total) return false;
    let r = Math.random() * total, k = 0;
    while (k < ways.length - 1 && (r -= ways[k]) >= 0) k++;
    const b = low(cand[k]);
    pairs.push([a, b]); win.push(-1);
    mask = rest & ~(1 << b);
  }
  return true;
}

const w = new Int8Array(N), l = new Int8Array(N), adj = new Int32Array(N), poolOf = new Int32Array(16);
// One run to the end. Returns the final records (reused arrays: read them before the next run),
// and the Play-In loser if the run had to play it.
function runOnce(state) {
  let pi = state.pi, loser = null;
  if (!pi) { pi = Math.random() < PI_KC ? 'KC' : 'MVK'; loser = pi === 'KC' ? 'MVK' : 'KC'; }
  setPlayIn(pi);
  const O = oddsFor(pi);
  w.fill(0); l.fill(0); adj.fill(0);
  for (let r = 1; r <= 5; r++) {
    const rd = state.rounds[r - 1];
    const pairs = rd ? rd.pairs.slice() : [], win = rd ? rd.win.slice() : [];
    let used = 0, active = 0;
    for (const [a, b] of pairs) used |= (1 << a) | (1 << b);
    for (let i = 0; i < N; i++) if (w[i] < 3 && l[i] < 3) active |= 1 << i;
    const free = active & ~used;
    if (free) {
      // Round 1 pools by tier (1 v 4, 2 v 3), later ones by record; no rematches.
      poolOf.fill(0);
      for (let m = free; m; m &= m - 1) { const i = low(m); poolOf[r === 1 ? (TIER14 >> i & 1) : w[i] * 4 + l[i]] |= 1 << i; }
      for (const P of poolOf) {
        if (!P) continue;
        for (let m = P; m; m &= m - 1) { const i = low(m); ok[i] = (r === 1 ? O.r1[i] : ~adj[i]) & P & ~(1 << i); }
        gen++;
        if (!drawPool(P, pairs, win)) return null;
      }
    }
    for (let k = 0; k < pairs.length; k++) {
      const [a, b] = pairs[k];
      if (win[k] < 0) win[k] = Math.random() < (boOf(w[a], l[a]) === 3 ? O.bo3 : O.bo1)[a * 16 + b] ? a : b;
    }
    for (let k = 0; k < pairs.length; k++) {
      const [a, b] = pairs[k], x = win[k], y = x === a ? b : a;
      w[x]++; l[y]++; adj[a] |= 1 << b; adj[b] |= 1 << a;
    }
  }
  return { w, l, loser };
}

// tally[code] = counts of [3–0, 3–1, 3–2, 2–3, 1–3, 0–3, lost the Play-In]. Posts partial results every
// CHUNK runs; a newer request stops an older one.
const CHUNK = 5000;
let current = 0;
onmessage = (e) => {
  const { id, state, runs, gpr } = e.data;
  // this worker loaded its own gpr.js, so it only knows the snapshot the page names here
  if (gpr !== undefined && gpr !== GPR.i) { gprUse(gpr); for (const k in odds) delete odds[k]; }
  current = id;
  const tally = {};
  let done = 0, n = 0;
  const add = (code, k) => (tally[code] || (tally[code] = [0, 0, 0, 0, 0, 0, 0]))[k]++;
  (function chunk() {
    if (id !== current) return;
    for (const end = Math.min(runs, done + CHUNK); done < end; done++) {
      const o = runOnce(state);
      if (!o) continue;
      n++;
      for (let i = 0; i < N; i++) add(TEAMS[i].id, o.w[i] === 3 ? o.l[i] : 5 - o.w[i]);
      if (o.loser) add(o.loser, 6);
    }
    postMessage({ id, tally, n, done, runs });
    if (done < runs) setTimeout(chunk, 0);
  })();
};

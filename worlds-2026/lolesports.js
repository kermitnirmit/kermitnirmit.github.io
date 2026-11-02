// Reads real Worlds 2026 results from the lolesports API and turns them into locks:
// {pi: "KC"|"MVK"|null, rounds: [{pairs:[[a,b]], win:[slot|-1]}], ko: {qf:[[a,b] x4], res:[{win, score}|null x7]}|null, seen: {...}}
const LOL = (() => {
  const KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';   // public key used by lolesports.com
  const BASE = 'https://esports-api.lolesports.com/persisted/gw/';
  const LEAGUE = '98767975604431411';                         // Worlds
  const TOURNAMENT = '115660540725177488';                    // Worlds 2026
  const FROM = '2026-10-14', TO = '2026-11-02';
  const SLOT = { GEN:0, AL:1, TLAW:2, TL:2, G2:3, LOS:4, TSW:5, HLE:6, BLG:7,
                 LYON:8, MKOI:9, KOI:9, T1:10, TES:11, CFO:12, IG:13, DK:14 };
  const PLAYIN = ['KC', 'MVK'];

  async function api(path) {
    const r = await fetch(BASE + path, { headers: { 'x-api-key': KEY } });
    if (!r.ok) throw new Error('lolesports API returned ' + r.status);
    return (await r.json()).data;
  }
  const get = async (path) => (await api(path)).schedule;

  async function fetchEvents() {
    const q = `getSchedule?hl=en-US&leagueId=${LEAGUE}`;
    const first = await get(q);
    let events = first.events.slice();
    let older = first.pages.older, newer = first.pages.newer;
    for (let i = 0; i < 4 && older && events.length && events[0].startTime > FROM; i++) {
      const p = await get(q + '&pageToken=' + encodeURIComponent(older));
      events = p.events.concat(events); older = p.pages.older;
    }
    for (let i = 0; i < 4 && newer && events.length && events[events.length - 1].startTime < TO; i++) {
      const p = await get(q + '&pageToken=' + encodeURIComponent(newer));
      events = events.concat(p.events); newer = p.pages.newer;
    }
    return events;
  }

  const byTime = (a, b) => a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : (a.match.id < b.match.id ? -1 : 1);
  const winnerCode = (m) => { const t = m.teams.find(t => t.result && t.result.outcome === 'win'); return t ? t.code : null; };

  // The knockout section of the standings lists its seven matches in bracket order:
  // QF1..QF4, then the semifinal QF1/QF2 feed, the one QF3/QF4 feed, then the final.
  async function fetchKnockouts() {
    const d = await api(`getStandings?hl=en-US&tournamentId=${TOURNAMENT}`);
    const stage = d.standings[0].stages.find(s => /knockout/i.test(s.slug || s.name || ''));
    return stage ? stage.sections.flatMap(s => s.matches) : [];
  }

  // Waits for all four quarterfinals before taking any of the draw, so it's always a whole bracket.
  function buildKnockouts(matches, pi) {
    if (matches.length !== 7) return null;
    const slot = (c) => PLAYIN.includes(c) ? (c === pi ? 15 : -1) : (c in SLOT ? SLOT[c] : -1);
    const seats = matches.map(m => m.teams.map(t => slot(t.code)));
    if (seats.slice(0, 4).some(p => p.length !== 2 || p.includes(-1))) return null;
    const res = matches.map((m, k) => {
      if (m.state !== 'completed' || seats[k].length !== 2 || seats[k].includes(-1)) return null;
      const g = m.teams.map(t => (t.result && t.result.gameWins) || 0);
      if (g[0] === g[1]) return null;
      return { win: seats[k][g[0] > g[1] ? 0 : 1], score: Math.min(g[0], g[1]) };
    });
    return { qf: seats.slice(0, 4), res };
  }

  function buildLocks(events) {
    const ev = events.filter(e => e.type === 'match' && e.match && e.match.teams && e.startTime >= FROM && e.startTime < TO);
    const locks = { pi: null, rounds: [], ko: null, seen: { pairs: 0, results: 0, playin: 'unstarted' }, problems: [] };

    // Play-In: the last Play-In match is the final.
    const playins = ev.filter(e => /play/i.test(e.blockName || '')).sort(byTime);
    const final = playins[playins.length - 1];
    if (final) {
      locks.seen.playin = final.state;
      const w = final.state === 'completed' ? winnerCode(final.match) : null;
      if (w && PLAYIN.includes(w)) locks.pi = w;
    }

    // Swiss: a match's round = how many Swiss matches its teams already have, plus one.
    const swiss = ev.filter(e => /swiss/i.test(e.blockName || '')).sort(byTime);
    const apps = {};
    for (const e of swiss) {
      const codes = e.match.teams.map(t => t.code);
      if (codes.length !== 2 || codes.some(c => !c || c === 'TBD')) continue;
      for (const c of codes) if (PLAYIN.includes(c) && !locks.pi) locks.pi = c;  // Play-In winner already in the Swiss stage
      const slots = codes.map(c => PLAYIN.includes(c) ? (c === locks.pi ? 15 : -1) : (c in SLOT ? SLOT[c] : -1));
      if (slots.includes(-1)) { locks.problems.push('Unknown team in a Swiss match: ' + codes.join(' v ')); continue; }
      const [a, b] = slots;
      const ra = apps[a] || 0, rb = apps[b] || 0;
      if (ra !== rb || ra >= 5) { locks.problems.push(`Couldn't place ${codes.join(' v ')} in a round`); continue; }
      apps[a] = ra + 1; apps[b] = rb + 1;
      while (locks.rounds.length <= ra) locks.rounds.push({ pairs: [], win: [] });
      const wc = e.state === 'completed' ? winnerCode(e.match) : null;
      const ws = wc === codes[0] ? a : wc === codes[1] ? b : -1;
      locks.rounds[ra].pairs.push([a, b]); locks.rounds[ra].win.push(ws);
      locks.seen.pairs++; if (ws >= 0) locks.seen.results++;
    }
    return locks;
  }

  async function fetchLocks() {
    const [events, kos] = await Promise.all([fetchEvents(), fetchKnockouts()]);
    const locks = buildLocks(events);
    locks.ko = buildKnockouts(kos, locks.pi);
    return locks;
  }
  return { fetchLocks, buildLocks, buildKnockouts, fetchEvents, fetchKnockouts };
})();
if (typeof module !== 'undefined') module.exports = LOL;

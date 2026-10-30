// Reads real Worlds 2026 results from the lolesports API and turns them into locks:
// {pi: "KC"|"MVK"|null, rounds: [{pairs:[[a,b]], win:[slot|-1]}], seen: {...}}
const LOL = (() => {
  const KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';   // public key used by lolesports.com
  const BASE = 'https://esports-api.lolesports.com/persisted/gw/';
  const LEAGUE = '98767975604431411';                         // Worlds
  const FROM = '2026-10-14', TO = '2026-11-02';
  const SLOT = { GEN:0, AL:1, TLAW:2, TL:2, G2:3, LOS:4, TSW:5, HLE:6, BLG:7,
                 LYON:8, MKOI:9, KOI:9, T1:10, TES:11, CFO:12, IG:13, DK:14 };
  const PLAYIN = ['KC', 'MVK'];

  async function get(path) {
    const r = await fetch(BASE + path, { headers: { 'x-api-key': KEY } });
    if (!r.ok) throw new Error('lolesports API returned ' + r.status);
    return (await r.json()).data.schedule;
  }

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

  function buildLocks(events) {
    const ev = events.filter(e => e.type === 'match' && e.match && e.match.teams && e.startTime >= FROM && e.startTime < TO);
    const locks = { pi: null, rounds: [], seen: { pairs: 0, results: 0, playin: 'unstarted' }, problems: [] };

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

  async function fetchLocks() { return buildLocks(await fetchEvents()); }
  return { fetchLocks, buildLocks, fetchEvents };
})();
if (typeof module !== 'undefined') module.exports = LOL;

// Riot's Global Power Rankings (lolesports.com/en-US/gpr/2026/current).
// Win chance uses GPR's own expected-result formula: We = 1 / (10^(-dr/600) + 1), dr = rating difference.
// That's taken as the chance to win one game; Bo3s and the Bo5s are played game by game.
// Two dated snapshots are kept so the page can be read against either; gprUse picks one.
const GPR = {
  sets: [
    { id: 'oct18', label: 'Oct 18',
      pts: { HLE: 1540, GEN: 1519, BLG: 1513, G2: 1478, T1: 1471, LYON: 1424, DK: 1409, AL: 1409, KC: 1396,
             TSW: 1370, TLAW: 1369, TES: 1364, IG: 1348, MKOI: 1320, CFO: 1316, MVK: 1269, LOS: 1183 } },
    { id: 'oct30', label: 'Oct 30',
      pts: { GEN: 1556, HLE: 1540, T1: 1493, BLG: 1492, G2: 1465, DK: 1456, LYON: 1445, KC: 1418, TES: 1402,
             IG: 1392, TLAW: 1386, AL: 1376, TSW: 1334, MKOI: 1324, CFO: 1301, MVK: 1250, LOS: 1215 } },
  ],
  i: 0, asOf: '', pts: null,
};
function gprUse(i) {
  GPR.i = (i >= 0 && i < GPR.sets.length) ? i : GPR.sets.length - 1;
  GPR.asOf = GPR.sets[GPR.i].label;
  GPR.pts = GPR.sets[GPR.i].pts;
}
gprUse(GPR.sets.length - 1);   // newest by default
function gprWin(codeA, codeB) {
  const a = GPR.pts[codeA], b = GPR.pts[codeB];
  if (a === undefined || b === undefined) return 0.5;
  return 1 / (Math.pow(10, -(a - b) / 600) + 1);
}
// Chance A wins a best-of-bo: first to (bo+1)/2 games, each won with gprWin.
function gprSeries(codeA, codeB, bo) {
  const p = gprWin(codeA, codeB), q = 1 - p, need = (bo + 1) / 2;
  let t = 0, c = 1; // c = ways to drop k games before the last win: C(need-1+k, k)
  for (let k = 0; k < need; k++) { t += c * Math.pow(p, need) * Math.pow(q, k); c = c * (need + k) / (k + 1); }
  return t;
}
// Plays a best-of-bo one game at a time and reports the games each side took.
function playScore(codeA, codeB, bo) {
  const p = gprWin(codeA, codeB), need = (bo + 1) / 2;
  let a = 0, b = 0;
  while (a < need && b < need) if (Math.random() < p) a++; else b++;
  return { a, b };
}
// true if A wins the series.
function playSeries(codeA, codeB, bo) { const s = playScore(codeA, codeB, bo); return s.a > s.b; }
if (typeof module !== 'undefined') module.exports = { GPR, gprWin, gprUse, gprSeries, playScore, playSeries };

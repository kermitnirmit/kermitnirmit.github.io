// Riot's Global Power Rankings (lolesports.com/en-US/gpr/2026/current), last updated Oct 18, 2026, 5:00 AM.
// Win chance uses GPR's own expected-result formula: We = 1 / (10^(-dr/600) + 1), dr = rating difference.
const GPR = {
  asOf: 'Oct 18, 2026',
  pts: { HLE: 1540, GEN: 1519, BLG: 1513, G2: 1478, T1: 1471, LYON: 1424, DK: 1409, AL: 1409, KC: 1396,
         TSW: 1370, TLAW: 1369, TES: 1364, IG: 1348, MKOI: 1320, CFO: 1316, MVK: 1269, LOS: 1183 },
};
function gprWin(codeA, codeB) {
  const a = GPR.pts[codeA], b = GPR.pts[codeB];
  if (a === undefined || b === undefined) return 0.5;
  return 1 / (Math.pow(10, -(a - b) / 600) + 1);
}
if (typeof module !== 'undefined') module.exports = { GPR, gprWin };

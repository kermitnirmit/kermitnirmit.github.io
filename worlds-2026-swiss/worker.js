// Counts remaining Swiss stages off the main thread.
if (typeof analyzeState === 'undefined') importScripts('engine.js' + (self.location.search || ''));
const ready = (typeof V3_INLINE !== 'undefined')
  ? Promise.resolve(setV3(V3_INLINE))
  : fetch('v3.json').then(r => r.json()).then(setV3);

onmessage = async (e) => {
  const { id, state } = e.data;
  try {
    await ready;
    if (state.pi) {
      setPlayIn(state.pi);
      const q = quickTotal(state.rounds);
      if (q !== null) postMessage({ id, out: { r: derive(state.rounds).r, phase: 'draw', total: q.toString(), partial: true } });
    }
    const a = analyzeState(state);
    const out = { r: a.r, phase: a.phase, total: a.total.toString() };
    if (a.pairShare) out.pairShare = Object.fromEntries([...a.pairShare].map(([k, v]) => [k, v.toString()]));
    if (a.winShare) out.winShare = a.winShare.map(String);
    if (a.piShare) out.piShare = Object.fromEntries(Object.entries(a.piShare).map(([k, v]) => [k, v.toString()]));
    postMessage({ id, out });
  } catch (err) { postMessage({ id, error: String(err && err.message || err) }); }
};

// Exact path counter for the Worlds 2026 Swiss stage.
// A "path" = the Play-In winner, then every draw and every match winner until the Swiss stage ends.
// Slot 15 is the Play-In winner (KC or MVK); its region changes the Round 1 draw.
const TEAMS = [
  ["GEN","Gen.G","LCK",1],["AL","Anyone's Legend","LPL",1],["TLAW","Team Liquid","LCS",1],["G2","G2 Esports","LEC",1],
  ["LOS","LOS","CBLOL",2],["TSW","Team Secret Whales","LCP",2],["HLE","Hanwha Life","LCK",2],["BLG","Bilibili Gaming","LPL",2],
  ["LYON","LYON","LCS",3],["MKOI","Movistar KOI","LEC",3],["T1","T1","LCK",3],["TES","Top Esports","LPL",3],
  ["CFO","CTBC Flying Oyster","LCP",4],["IG","Invictus Gaming","LPL",4],["DK","Dplus KIA","LCK",4],["PI","Play-In winner","",4],
].map(([id,name,region,tier],i)=>({i,id,name,region,tier}));
const PLAYIN = { KC:{id:"KC",name:"Karmine Corp",region:"LEC"}, MVK:{id:"MVK",name:"MVK Esports",region:"LCP"} };
const PLAYIN_CODES = ["KC","MVK"];
const PI = 15;
function setPlayIn(code){
  const p = PLAYIN[code];
  if(p) Object.assign(TEAMS[PI], p); else Object.assign(TEAMS[PI], {id:"PI",name:"Play-In winner",region:""});
}
const N = 16;
const F_AFTER_R1 = 193494280378613760n; // ways to play rounds 2-5 once round 1 is done (any result)
let V3 = {}; // canonical post-round-2 state -> ways to play rounds 3-5 (string)
function setV3(t){ V3 = t; }

// ---------- state helpers ----------
// history: array of rounds; round = {pairs:[[a,b],...], win:[teamId|-1,...]}
function derive(history){
  const w=new Array(N).fill(0), l=new Array(N).fill(0), adj=new Array(N).fill(0);
  let r=1;
  for(const rd of history){
    const done = isRoundDone(rd, w, l);
    if(!done) break;
    for(let k=0;k<rd.pairs.length;k++){
      const [a,b]=rd.pairs[k], x=rd.win[k], y = x===a?b:a;
      w[x]++; l[y]++; adj[a]|=1<<b; adj[b]|=1<<a;
    }
    r++;
  }
  return {w,l,adj,r};
}
// Bo3 once a win or a loss decides something (2–0, 0–2 and every round 4 and 5 match), else Bo1
function boOf(w,l){ return w===2||l===2 ? 3 : 1; }
function activeList(w,l){ const o=[]; for(let i=0;i<N;i++) if(w[i]<3&&l[i]<3) o.push(i); return o; }
function isRoundDone(rd,w,l){
  const need = activeList(w,l).length/2;
  return rd.pairs.length===need && need>0 && rd.win.every(x=>x>=0);
}
function canPair(a,b,r,w,l,adj){
  if(a===b) return false;
  if(r===1){
    const ta=TEAMS[a].tier, tb=TEAMS[b].tier;
    if(ta+tb!==5) return false;              // 1 v 4, 2 v 3
    return TEAMS[a].region!==TEAMS[b].region;
  }
  if(w[a]!==w[b]||l[a]!==l[b]) return false;
  return !((adj[a]>>b)&1);
}

// ---------- canonical form of a 2-regular colored graph (post-round-2) ----------
function cycCanon(colors, adj, verts){
  const seen=new Set(), parts=[];
  for(const s of verts){
    if(seen.has(s)) continue;
    const seq=[s]; seen.add(s); let prev=-1, cur=s;
    while(true){
      const nb=[]; for(const v of verts) if((adj[cur]>>v)&1) nb.push(v);
      const nxt = nb[0]!==prev ? nb[0] : nb[1];
      if(nxt===s) break;
      seq.push(nxt); seen.add(nxt); prev=cur; cur=nxt;
    }
    const ch=seq.map(v=>String.fromCharCode(65+colors[v])).join(''), rv=ch.split('').reverse().join('');
    let best=null;
    for(let i=0;i<ch.length;i++){
      const a=ch.slice(i)+ch.slice(0,i), b=rv.slice(i)+rv.slice(0,i);
      if(best===null||a<best) best=a; if(b<best) best=b;
    }
    parts.push(best);
  }
  parts.sort();
  return parts.join('|');
}

// ---------- perfect matchings ----------
function matchings(nodes, ok){ // ok(a,b) -> bool ; returns array of arrays of pairs
  const out=[];
  (function rec(rest, acc){
    if(!rest.length){ out.push(acc.slice()); return; }
    const a=rest[0];
    for(let j=1;j<rest.length;j++){
      const b=rest[j]; if(!ok(a,b)) continue;
      acc.push([a,b]); rec(rest.slice(1,j).concat(rest.slice(j+1)), acc); acc.pop();
    }
  })(nodes, []);
  return out;
}
function pmCount(mask, adj){
  if(mask===0) return 1;
  const a = 31-Math.clz32(mask & -mask), rest = mask & ~(1<<a);
  let t=0, m=rest;
  while(m){ const lb=m&-m, b=31-Math.clz32(lb); m^=lb; if(!((adj[a]>>b)&1)) t+=pmCount(rest & ~(1<<b), adj); }
  return t;
}

// ---------- value of a state at the start of round rNext ----------
function boundaryValue(rNext, w, l, adj){
  if(rNext===2) return F_AFTER_R1;
  if(rNext===6) return 1n;
  const act=activeList(w,l);
  if(rNext===3){
    const colors=new Array(N).fill(0); for(const i of act) colors[i]=w[i]*4+l[i];
    const key=cycCanon(colors, adj, act);
    const v=V3[key]; if(v===undefined) throw new Error('missing V3 '+key);
    return BigInt(v);
  }
  if(rNext===5){ // single 2-2 pool, 3 matches, 8 result combos
    let mask=0; for(const i of act) mask|=1<<i;
    return BigInt(pmCount(mask, adj)*8);
  }
  // rNext===4: 2-1 pool A, 1-2 pool B
  const A=[], B=[];
  for(const i of act){ if(w[i]===2) A.push(i); else B.push(i); }
  const tA=transversals(A, adj), tB=transversals(B, adj);
  const ok=OK; for(const i of act){ const ai=adj[i]; for(const j of act) ok[i*16+j]=(ai>>j)&1?0:1; }
  let v=0;
  for(let x=0;x<tA.n;x++){
    const a0=tA.t[3*x], a1=tA.t[3*x+1], a2=tA.t[3*x+2], cx=tA.c[x];
    for(let y=0;y<tB.n;y++){
      const b0=tB.t[3*y], b1=tB.t[3*y+1], b2=tB.t[3*y+2];
      v+=cx*tB.c[y]*pm6(ok,a0,a1,a2,b0,b1,b2);
    }
  }
  return BigInt(v*8);
}
const OK=new Uint8Array(256);
function pm4(ok,a,b,c,d){ return ok[a*16+b]*ok[c*16+d]+ok[a*16+c]*ok[b*16+d]+ok[a*16+d]*ok[b*16+c]; }
function pm6(ok,s0,s1,s2,s3,s4,s5){
  const r=s0*16;
  return (ok[r+s1]?pm4(ok,s2,s3,s4,s5):0)+(ok[r+s2]?pm4(ok,s1,s3,s4,s5):0)+(ok[r+s3]?pm4(ok,s1,s2,s4,s5):0)
        +(ok[r+s4]?pm4(ok,s1,s2,s3,s5):0)+(ok[r+s5]?pm4(ok,s1,s2,s3,s4):0);
}
// the 15 perfect matchings of 6 slots
const M6=(()=>{ const out=[]; (function rec(rest,acc){ if(!rest.length){out.push(acc.slice());return;}
  const a=rest[0]; for(let j=1;j<rest.length;j++){ acc.push(a,rest[j]); rec(rest.slice(1,j).concat(rest.slice(j+1)),acc); acc.length-=2; } })([0,1,2,3,4,5],[]); return out; })();
// For a 6-team pool: every set of 3 teams that can come out of one side of a legal draw, with multiplicity
const TBUF=new Int32Array(64);
function transversals(G, adj){
  const cnt=TBUF; cnt.fill(0);
  for(const M of M6){
    if(((adj[G[M[0]]]>>G[M[1]])&1)||((adj[G[M[2]]]>>G[M[3]])&1)||((adj[G[M[4]]]>>G[M[5]])&1)) continue;
    for(let bits=0;bits<8;bits++) cnt[(1<<M[bits&1?0:1])|(1<<M[bits&2?2:3])|(1<<M[bits&4?4:5])]++;
  }
  const c=new Int32Array(20), t=new Int32Array(60); let n=0;
  for(let s=0;s<64;s++) if(cnt[s]){
    c[n]=cnt[s]; let k=0; for(let j=0;j<6;j++) if(s>>j&1) t[3*n+(k++)]=G[j]; n++;
  }
  return {c,t,n};
}

// apply results bits to a full draw; returns value of the following boundary
function afterResults(r, D, winners, w, l, adj){
  const w2=w.slice(), l2=l.slice(), a2=adj.slice();
  for(let k=0;k<D.length;k++){ const [a,b]=D[k], x=winners[k], y=x===a?b:a;
    w2[x]++; l2[y]++; a2[a]|=1<<b; a2[b]|=1<<a; }
  return boundaryValue(r+1, w2, l2, a2);
}

// Sum over all result combos for the unset matches. fixed[k] = winner or -1.
// Calls onCombo(winnersArray, value) for attribution.
function sumResults(r, D, fixed, w, l, adj, onCombo){
  if(r===1){ // every round-1 result leads to an equivalent future
    const free=fixed.filter(x=>x<0).length;
    if(!onCombo) return F_AFTER_R1 * (1n<<BigInt(free));
  }
  const freeIdx=[]; fixed.forEach((x,k)=>{ if(x<0) freeIdx.push(k); });
  let tot=0n; const win=fixed.slice();
  for(let bits=0; bits<(1<<freeIdx.length); bits++){
    freeIdx.forEach((k,j)=>{ win[k] = (bits>>j)&1 ? D[k][0] : D[k][1]; });
    const v = r===1 ? F_AFTER_R1 : afterResults(r, D, win, w, l, adj);
    tot+=v; if(onCombo) onCombo(win, v);
  }
  return tot;
}

const drawMemo = new Map();
function drawValue(sig, r, D, w, l, adj){
  if(r===1) return 256n*F_AFTER_R1;
  if(r===5) return 8n;
  let key;
  if(r===2){ // memo on the shape of the played graph
    const a2=adj.slice(); for(const [a,b] of D){ a2[a]|=1<<b; a2[b]|=1<<a; }
    const colors=new Array(N).fill(0); for(let i=0;i<N;i++) colors[i]=w[i]*4+l[i];
    key='2|'+cycCanon(colors,a2,[...Array(N).keys()]);
  } else key=sig+'|'+D.map(p=>p[0]<p[1]?p[0]+'-'+p[1]:p[1]+'-'+p[0]).sort().join(',');
  let v=drawMemo.get(key);
  if(v===undefined){ v=sumResults(r, D, D.map(()=>-1), w, l, adj); drawMemo.set(key,v); if(drawMemo.size>400000) drawMemo.clear(); }
  return v;
}

// all ways to finish the current round's draw
function drawCompletions(rd, r, w, l, adj){
  const act=activeList(w,l), used=new Set(rd.pairs.flat());
  const free=act.filter(i=>!used.has(i));
  let pools;
  if(r===1) pools=[free.filter(i=>TEAMS[i].tier===1||TEAMS[i].tier===4), free.filter(i=>TEAMS[i].tier===2||TEAMS[i].tier===3)];
  else { const m=new Map(); for(const i of free){ const k=w[i]*4+l[i]; if(!m.has(k)) m.set(k,[]); m.get(k).push(i); } pools=[...m.values()]; }
  let combos=[[]];
  for(const P of pools){
    if(!P.length) continue;
    const ms=matchings(P,(a,b)=>canPair(a,b,r,w,l,adj));
    const next=[]; for(const c of combos) for(const m of ms) next.push(c.concat(m));
    combos=next; if(!combos.length) break;
  }
  return combos;
}

// Round 1 draw count for a given Play-In winner
function r1Draws(code){
  const prev = TEAMS[PI].id; setPlayIn(code);
  const z=new Array(N).fill(0);
  const n = drawCompletions({pairs:[],win:[]},1,z,z,z).length;
  setPlayIn(prev==="PI"?null:prev);
  return n;
}
// state = {pi: "KC"|"MVK"|null, rounds:[...]}
function analyzeState(state){
  if(!state.pi){
    const share={}; let total=0n;
    for(const c of PLAYIN_CODES){ share[c]=BigInt(r1Draws(c))*256n*F_AFTER_R1; total+=share[c]; }
    return {r:0, phase:'playin', total, piShare:share};
  }
  setPlayIn(state.pi);
  return analyze(state.rounds);
}

// ---------- main entry ----------
// Returns {r, phase, total, pairShare: Map("a-b" -> BigInt), winShare: BigInt[N]}
function analyze(history){
  const {w,l,adj,r}=derive(history);
  if(r>5) return {r, phase:'done', total:1n};
  const rd = history[r-1] || {pairs:[],win:[]};
  const need=activeList(w,l).length/2;
  const sig=JSON.stringify(history.slice(0,r-1));
  if(rd.pairs.length<need){
    const comps=drawCompletions(rd,r,w,l,adj);
    let total=0n; const pairShare=new Map();
    for(const extra of comps){
      const D=rd.pairs.concat(extra);
      const v=drawValue(sig,r,D,w,l,adj);
      total+=v;
      for(const [a,b] of extra){ const k=Math.min(a,b)+'-'+Math.max(a,b); pairShare.set(k,(pairShare.get(k)||0n)+v); }
    }
    return {r, phase:'draw', total, pairShare, completions:comps.length};
  }
  const winShare=new Array(N).fill(0n);
  const total=sumResults(r, rd.pairs, rd.win, w, l, adj, (win,v)=>{
    rd.win.forEach((x,k)=>{ if(x<0) winShare[win[k]]+=v; });
  });
  return {r, phase:'results', total, winShare};
}

// Fast total for the start of a round (no draw made yet), from precomputed values
function quickTotal(history){
  const {w,l,adj,r}=derive(history);
  if(r<2||r>5) return null;
  const rd=history[r-1];
  if(rd && rd.pairs.length) return null;
  return boundaryValue(r,w,l,adj);
}

function randomDraw(history){
  const {w,l,adj,r}=derive(history);
  const rd=history[r-1]||{pairs:[],win:[]};
  const comps=drawCompletions(rd,r,w,l,adj);
  return comps.length ? comps[Math.floor(Math.random()*comps.length)] : null;
}

if(typeof module!=='undefined') module.exports={TEAMS,PLAYIN,PLAYIN_CODES,PI,setPlayIn,r1Draws,analyzeState,drawCompletions,analyze,quickTotal,randomDraw,derive,setV3,activeList,canPair,boOf,F_AFTER_R1};

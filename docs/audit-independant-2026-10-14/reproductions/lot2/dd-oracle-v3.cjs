// Calcul exact (décimal) des 7 lignes-oracle sous la règle v3 proposée.
// PU = arrondi½↑( PRFO×kfo×cFO + h/u×taux×kmo×maj×cMO ) ; PT = arrondi½↑(q × PU).
const fs = require('fs');
const path = process.argv[2];
const d = JSON.parse(fs.readFileSync(path, 'utf8'));
// décimaux exacts en millièmes de centime via BigInt
function dec(x){ const s=String(x); const [w,f='']=s.split('.'); return {n:BigInt(w+f), e:f.length}; }
function mul(a,b){ return {n:a.n*b.n, e:a.e+b.e}; }
function add(a,b){ const e=Math.max(a.e,b.e); return {n:a.n*10n**BigInt(e-a.e)+b.n*10n**BigInt(e-b.e), e}; }
function roundHalfUp(a){ const den=10n**BigInt(a.e); return (a.n*2n+den)/(den*2n); }
const rate = dec(4000); // 40 €/h en centimes
const cfo = dec('1.30'), cmo = dec('1.20');
let out=[];
for (const l of d.oracle.lignes){
  const prfo = dec(Math.round(l.prfo*100)); // centimes entiers stockés
  const h = dec(l.tps_u);
  const fo_u = mul(prfo, cfo);
  const mo_u = mul(mul(h, rate), cmo);
  const pu = roundHalfUp(add(fo_u, mo_u));
  const pt = roundHalfUp(mul(dec(l.q), {n:pu,e:0}));
  const cost_u = add(prfo, mul(h, rate));
  const costLine = roundHalfUp(mul(dec(l.q), cost_u));
  out.push({id:l.id, q:l.q, prfo_c:Number(prfo.n), h_u:l.tps_u, pu_c:Number(pu), pt_c:Number(pt), offre_pu:l.attendu.pv_u_offre, offre_pt:l.attendu.pt_offre, ecart_pt_c: Number(pt) - Math.round(l.attendu.pt_offre*100), cout_c:Number(costLine)});
}
console.log(JSON.stringify(out,null,1));
let s=0n; for(const o of out) s+=BigInt(o.pt_c); console.log('somme PT v3 (c)', s.toString());

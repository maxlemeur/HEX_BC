const path=require("path");const XLSX=require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const dir="C:/Users/maxim/Projects/miaouffrage/docs/prd_file/exemple chiffrage OPTIMA";
const hu=(x)=>Math.round(Number(x.toFixed(6)));
for (const name of process.argv.slice(2)){
 const wb=XLSX.readFile(path.join(dir,name));const ws=wb.Sheets[wb.SheetNames[0]];
 const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
 let n=0,sumV3=0,sumUnrounded=0,cost=0,fo=0,hours=0,v2tot=0,v2bis=0;
 for(let r=2;r<rows.length;r++){const row=rows[r];const q=Number(row[3]);const e=row[4];const label=String(row[1]||'');
  if(/^Sous-total|^Total/i.test(label.trim()))continue; if(!(typeof e==='number'&&e>0&&q>0))continue; n++;
  const g=typeof row[6]==='number'?row[6]:0;const i=typeof row[8]==='number'?row[8]:0;
  const G=Math.round(g*100);const puExact=G*1.3+i*4000*1.2;const pu=hu(puExact);
  sumV3+=hu(q*pu);sumUnrounded+=hu(q*puExact);cost+=hu(q*(G+i*4000));
  // v2 actuel avec h_mo saisi par unité (mauvaise sémantique) et marge 1,3
  v2bis+=hu(hu(q*G+i*4000)*1.3);
  v2tot+=hu(hu(q*G+q*i*4000)*1.3);
 }
 console.log(JSON.stringify({name,lines:n,sumV3_130_120:sumV3,sumRoundQxPUexact:sumUnrounded,deboursCents:cost,marqueV3:((sumV3-cost)/sumV3*100).toFixed(2),coefRealise:(sumV3/cost).toFixed(4),v2_hTotales_k130:v2tot,v2_hParUnite_k130:v2bis}));
}

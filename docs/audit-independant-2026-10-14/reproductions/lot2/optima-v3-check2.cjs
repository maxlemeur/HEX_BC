const path=require("path");const XLSX=require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const dir="C:/Users/maxim/Projects/miaouffrage/docs/prd_file/exemple chiffrage OPTIMA";
const hu=(x)=>Math.round(Number(x.toFixed(6)));
for (const name of process.argv.slice(2)){
 const wb=XLSX.readFile(path.join(dir,name));const ws=wb.Sheets[wb.SheetNames[0]];
 const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true});
 const p=rows[1];const L2=+p[11],M2=+p[12],N2=+(p[13]||0),O2=+p[14];
 let n=0,puEq=0,ptEq=0,maxGap=0,sx=0,sv=0,sub=0,gaps=[],diffs=[],prfo3=0,hours3=0;
 for(let r=2;r<rows.length;r++){const row=rows[r];const q=Number(row[3]);const e=row[4];
  const label=String(row[1]||'');
  if(/^Sous-total|^Total/i.test(label.trim())){continue;}
  if(!(typeof e==='number'&&e>0&&q>0))continue;
  n++;const g=typeof row[6]==='number'?row[6]:0;const i=typeof row[8]==='number'?row[8]:0;
  if(Math.abs(g*100-Math.round(g*100))>1e-6)prfo3++;
  if(Math.abs(i*1000-Math.round(i*1000))>1e-6)hours3++;
  const pu=hu(Math.round(g*100)*L2+i*(1+N2)*O2*100*M2);const puX=hu(e*100);
  if(pu===puX)puEq++;else if(diffs.length<5)diffs.push({r:r+1,g,i,e,pu});
  const pt=hu(q*pu);const ptX=hu(Number(row[5])*100);if(pt===ptX)ptEq++;
  const gap=pt-ptX;gaps.push(gap);maxGap=Math.max(maxGap,Math.abs(gap));sx+=ptX;sv+=pt;}
 const total=rows.find(r=>/^Total/i.test(String(r[1]||'').trim()));
 console.log(JSON.stringify({name,params:{L2,M2,N2,O2},lines:n,puEq,diffs,prfoMoreThan2Dec:prfo3,hoursMoreThan3Dec:hours3,ptEq,maxGapCents:maxGap,sumXlsxCents:sx,sumV3Cents:sv,deltaCents:sv-sx}));
}

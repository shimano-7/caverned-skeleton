import {analyze} from './analysis.js';
export function rsi(rows, period=14) {
  if(rows.length<=period)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=rows[i].close-rows[i-1].close;gain+=Math.max(d,0)/period;loss+=Math.max(-d,0)/period;}
  for(let i=period+1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
const numeric=v=>v!==null&&v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
const pick=(o,...keys)=>{for(const k of keys)if(o[k]!==undefined)return o[k];return null;};
export function normalizeBars(raw){
  const rows=raw.map(r=>({date:pick(r,'Date','date'),close:numeric(pick(r,'AdjC','AdjustmentClose')),volume:numeric(pick(r,'AdjVo','AdjustmentVolume')),rawClose:numeric(pick(r,'C','Close'))})).sort((a,b)=>a.date?.localeCompare(b.date));
  if(rows.some((r,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||r.close===null||r.close<=0||r.volume===null||r.volume<0||(i&&r.date===rows[i-1].date)))throw Error('価格データ不正');
  return rows;
}
export function fundamentals(raw, price, asOf){
  const annual=raw.filter(f=>pick(f,'CurPerType','TypeOfCurrentPeriod')==='FY' && pick(f,'DiscDate','DisclosedDate')<=asOf).sort((a,b)=>String(pick(a,'DiscDate','DisclosedDate')).localeCompare(String(pick(b,'DiscDate','DisclosedDate'))));
  const unique=new Map();for(const f of annual)unique.set(pick(f,'CurFYEn','CurrentFiscalYearEndDate'),f);
  const periods=[...unique.values()].sort((a,b)=>String(pick(a,'CurFYEn','CurrentFiscalYearEndDate')).localeCompare(String(pick(b,'CurFYEn','CurrentFiscalYearEndDate'))));
  const f=periods.at(-1),p=periods.at(-2);if(!f||!p)throw Error('比較可能な通期決算が不足');
  const end=pick(f,'CurFYEn','CurrentFiscalYearEndDate'),prevEnd=pick(p,'CurFYEn','CurrentFiscalYearEndDate');
  const gap=(Date.parse(end)-Date.parse(prevEnd))/86400000;
  if(gap<330||gap>400)throw Error('比較年度が連続していません');
  const sales=numeric(pick(f,'Sales','NetSales')),previousSales=numeric(pick(p,'Sales','NetSales')),profit=numeric(pick(f,'NP','Profit')),previousProfit=numeric(pick(p,'NP','Profit'));
  const eps=numeric(pick(f,'EPS','EarningsPerShare')),bps=numeric(pick(f,'BPS','BookValuePerShare')),equity=numeric(pick(f,'Eq','Equity')),previousEquity=numeric(pick(p,'Eq','Equity')),div=numeric(pick(f,'DivAnn','ResultDividendPerShareAnnual'));
  return {salesGrowth:sales!==null&&previousSales>0?(sales/previousSales-1)*100:null,profitGrowth:profit!==null&&previousProfit>0?(profit/previousProfit-1)*100:null,per:eps>0?price/eps:null,pbr:bps>0?price/bps:null,roe:profit!==null&&equity>0&&previousEquity>0?profit/((equity+previousEquity)/2)*100:null,dividendYield:div!==null&&div>=0?div/price*100:null,disclosedAt:pick(f,'DiscDate','DisclosedDate'),fiscalYearEnd:end,previousFiscalYearEnd:prevEnd};
}
export function evaluate(stock, now=new Date()){
  const {rows,metrics:m}=stock;
  if(rows.length<76)throw Error('76営業日以上の価格が必要');
  if((now-Date.parse(rows.at(-1).date))/86400000>7)throw Error('株価が7日超前です');
  if((now-Date.parse(m.disclosedAt))/86400000>460)throw Error('通期決算が古すぎます');
  if(['salesGrowth','profitGrowth','per','pbr','roe','dividendYield'].some(k=>!Number.isFinite(m[k])))throw Error('必須財務指標が不足');
  const technical=analyze(rows),strength=rsi(rows),last=rows.at(-1),ma25=technical.ma25.at(-1),ma75=technical.ma75.at(-1);
  const baseline=rows.slice(-21,-1).reduce((sum,r)=>sum+r.volume,0)/20,volumeRatio=baseline>0?last.volume/baseline:null;
  const rules=[['売上成長率10%以上',m.salesGrowth>=10,15],['利益成長率10%以上',m.profitGrowth>=10,15],['PER 0〜20倍',m.per>0&&m.per<=20,10],['PBR 0〜1.5倍',m.pbr>0&&m.pbr<=1.5,10],['ROE 8%以上',m.roe>=8,10],['配当利回り2%以上',m.dividendYield>=2,5],['25日線が75日線より上',ma25>ma75,10],['終値が25日線より上',last.close>ma25,10],['RSI 40〜70',strength>=40&&strength<=70,10],['出来高が直前20日平均の1.2倍以上',volumeRatio>=1.2,5]];
  const score=rules.reduce((sum,[,pass,points])=>sum+(pass?points:0),0);
  const verdict=score>=70&&technical.verdict==='買い'&&strength<75?'買い候補':score<40||technical.verdict==='見送り'?'見送り':'待ち';
  return {...stock,score,verdict,checks:rules.map(([label,passed,points])=>({label,passed,points})),technical:{ma25,ma75,rsi:strength,volumeRatio,latestCross:technical.crosses.at(-1)||null},priceDate:last.date,close:last.close,volume:last.volume};
}
export function rank(stocks, now=new Date()){
  const eligible=[],excluded=[];
  for(const stock of stocks)try{eligible.push(evaluate(stock,now));}catch(e){excluded.push({code:stock.code,reason:e.message});}
  eligible.sort((a,b)=>b.score-a.score||a.code.localeCompare(b.code));
  return {rankings:eligible.slice(0,5),eligibleCount:eligible.length,excluded};
}

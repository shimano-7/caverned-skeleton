// JPX cash-equity sessions: weekends, Japanese national/substitute/citizens'
// holidays, Jan 1–3 and Dec 31 are closed. Explicit supported years; fail closed.
export const calendarSource={name:'JPX現物株取引日ルール・内閣府国民の祝日（2024–2027年を収録）',url:'https://www.jpx.co.jp/corporate/about-jpx/calendar/index.html',version:'2024-2027-v1'};
const holidays={
2024:'01-01 01-08 02-11 02-12 02-23 03-20 04-29 05-03 05-04 05-05 05-06 07-15 08-11 08-12 09-16 09-22 09-23 10-14 11-03 11-04 11-23',
2025:'01-01 01-13 02-11 02-23 02-24 03-20 04-29 05-03 05-04 05-05 05-06 07-21 08-11 09-15 09-23 10-13 11-03 11-23 11-24',
2026:'01-01 01-12 02-11 02-23 03-20 04-29 05-03 05-04 05-05 05-06 07-20 08-11 09-21 09-22 09-23 10-12 11-03 11-23',
2027:'01-01 01-11 02-11 02-23 03-21 03-22 04-29 05-03 05-04 05-05 07-19 08-11 09-20 09-23 10-11 11-03 11-23'
};
export function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export function isTradingDay(date){
 if(!validDate(date))throw Error('取引日が不正');
 const year=Number(date.slice(0,4));if(!holidays[year])throw Error('取引所カレンダーの対応年外');
 const md=date.slice(5),day=new Date(date).getUTCDay();
 return day!==0&&day!==6&&!['01-01','01-02','01-03','12-31'].includes(md)&&!holidays[year].split(' ').includes(md);
}
const shift=(date,days)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export function lastCompletedSession(now=new Date()){
 const local=new Date(now.getTime()+9*3600000),today=local.toISOString().slice(0,10),minutes=local.getUTCHours()*60+local.getUTCMinutes();
 const close=today<'2024-11-05'?15*60:15*60+30;
 let expected=today;
 if(!isTradingDay(today)||minutes<close)expected=shift(today,-1);
 for(let i=0;i<20;i++){if(isTradingDay(expected))return {expectedDate:expected,today,minutes};expected=shift(expected,-1);}
 throw Error('最終取引日を確認できません');
}
export function priceFreshness(priceDate,now=new Date()){
 try{
  const context=lastCompletedSession(now),{expectedDate}=context;
  if(!validDate(priceDate)||!isTradingDay(priceDate)||priceDate>expectedDate)return {...context,status:'invalid',actualDate:priceDate,missingSessions:null,reason:'株価の日付が不正・休場日・未終了の取引日です'};
  let missingSessions=0;
  // Date arithmetic is only used to enumerate actual exchange sessions.
  for(let date=shift(priceDate,1);date<=expectedDate;date=shift(date,1))if(isTradingDay(date))missingSessions++;
  const pending=missingSessions===1&&expectedDate===context.today&&context.minutes<20*60;
  return {...context,actualDate:priceDate,missingSessions,status:missingSessions===0?'available':pending?'pending':'stale',reason:missingSessions===0?null:`株価の最終取引日 ${priceDate} / 基準取引日 ${expectedDate}：${missingSessions}営業日分未収録${pending?'（当日データの反映待ちの可能性・ランキング対象外）':''}`};
 }catch{return {status:'unknown',actualDate:priceDate,expectedDate:null,missingSessions:null,reason:'対応する取引所カレンダーを確認できないため鮮度を判定できません'};}
}

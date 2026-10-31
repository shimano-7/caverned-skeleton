import {priceFreshness,lastCompletedSession,validDate} from './japan-calendar.js';
export const FREE_MODE='free-delayed';
export function freePlanDate(now=new Date()){
 return lastCompletedSession(new Date(now.getTime()-84*86400000)).expectedDate;
}
export function stockFreshness(stock,now=new Date()){
 const date=stock.rows?.at(-1)?.date||stock.priceDate;
 if(stock.analysisMode!==FREE_MODE)return priceFreshness(date,now);
 if(!validDate(date)||date>new Date(now.getTime()+9*3600000).toISOString().slice(0,10))return {status:'invalid',actualDate:date,reason:'取引日が不正・未来です'};
 const atDate=new Date(date+'T12:00:00Z');
 const session=priceFreshness(date,atDate);
 return {...session,analysisMode:FREE_MODE,providerExpectedDate:freePlanDate(now),historical:true};
}
export function valuationTime(stock,now=new Date()){
 return stock.analysisMode===FREE_MODE&&validDate(stock.rows?.at(-1)?.date)?new Date(stock.rows.at(-1).date+'T12:00:00Z'):now;
}

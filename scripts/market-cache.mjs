import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {priceFreshness} from '../japan-calendar.js';
export async function openCache(directory,{now=()=>Date.now(),log=console.log}={}){
  await mkdir(directory,{recursive:true});
  const file=join(directory,'market.json');
  let state={version:1,entries:{},rate:{}};
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.version===1&&saved.entries&&saved.rate)state=saved;}catch{}
  const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(state));await rename(file+'.tmp',file);};
  return {state,save,timestamp(path,params={}){return state.entries[JSON.stringify([path,params])]?.savedAt;},wrap(api){return async(path,params={})=>{
    const key=JSON.stringify([path,params]);
    const ttl=path==='equities/master'?7*86400000:path==='fins/summary'?86400000:12*3600000;
    const cached=state.entries[key],age=now()-cached?.savedAt;
    if(cached&&age>=0&&age<ttl&&Array.isArray(cached.data)){log(`Cache hit: ${path}`);return cached.data;}
    const data=await api(path,params);
    // 成功した公開市場データだけを保存。キー・ヘッダー・エラー本文は保存しない。
    state.entries[key]={savedAt:now(),data};await save();return data;
  };}};
}
export function reusableSnapshot(snapshot,now=Date.now()){
  const age=now-Date.parse(snapshot?.generatedAt);
  return snapshot?.status==='ok'&&Array.isArray(snapshot.rankings)&&snapshot.rankings.length>0&&age>=0&&age<36*3600000&&snapshot.rankings.every(s=>priceFreshness(s.priceDate,new Date(now)).status==='available');
}

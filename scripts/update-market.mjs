import {mkdir,writeFile} from 'node:fs/promises';
import {normalizeBars,fundamentals,rank} from '../discovery.js';
const generatedAt=new Date().toISOString();
const base={schemaVersion:1,market:'JP',source:{name:'JPX J-Quants API v2',url:'https://jpx-jquants.com/'},generatedAt,rankings:[],status:'unavailable',coverage:{}};
const out=process.env.MARKET_OUTPUT||'data/japan.json';
export async function collect(apiKey,request=fetch){
  async function api(path,params={}){
    const result=[];let pagination_key;
    do{
      const url=new URL('https://api.jquants.com/v2/'+path);for(const [k,v]of Object.entries({...params,...(pagination_key?{pagination_key}: {})}))url.searchParams.set(k,v);
      let response;
      for(let attempt=0;attempt<4;attempt++){
        response=await request(url,{headers:{'x-api-key':apiKey},signal:AbortSignal.timeout(30000)});
        if(response.status!==429)break;
        await new Promise(resolve=>setTimeout(resolve,15000*(attempt+1)));
      }
      if(!response.ok)throw Error(`J-Quants ${path}: HTTP ${response.status}`);
      const body=await response.json();if(!Array.isArray(body.data))throw Error(`J-Quants ${path}: 応答形式が未対応`);
      result.push(...body.data);pagination_key=body.pagination_key;
      if(result.length>100000)throw Error('ページ数上限');
    }while(pagination_key);
    return result;
  }
  const master=await api('equities/master');
  const universe=master.filter(s=>String(s.Mkt)==='0111').sort((a,b)=>String(a.Code).localeCompare(String(b.Code)));
  const limit=Number(process.env.SCREEN_LIMIT||100);
  if(!Number.isInteger(limit)||limit<5||limit>5000)throw Error('SCREEN_LIMITは5〜5000');
  const selected=universe.slice(0,limit),stocks=[],errors=[];
  const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-1);
  for(const s of selected){
    try{
      const rows=normalizeBars(await api('equities/bars/daily',{code:s.Code,from:from.toISOString().slice(0,10)}));
      if(!rows.length)throw Error('価格なし');
      if(!(rows.at(-1).rawClose>0))throw Error('未調整終値なし');
      const raw=await api('fins/summary',{code:s.Code});
      stocks.push({code:String(s.Code),name:s.CoName,market:'JP',rows,metrics:fundamentals(raw,rows.at(-1).rawClose,rows.at(-1).date)});
    }catch(e){errors.push({code:String(s.Code),reason:e.message});}
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  const ranked=rank(stocks);
  return {...base,...ranked,status:ranked.rankings.length?'ok':'unavailable',coverage:{universe:universe.length,attempted:selected.length,eligible:ranked.eligibleCount,selection:'東証プライム・コード昇順（上限あり）。全市場ランキングではありません。'},excluded:[...errors,...ranked.excluded],message:ranked.rankings.length?'分析対象内の上位銘柄です。':'必要な実データがそろわず、ランキングを生成できませんでした。'};
}
if(process.argv[1]?.endsWith('update-market.mjs')){
  let result;
  try{if(!process.env.JQUANTS_API_KEY)throw Error('JQUANTS_API_KEYが未設定です。GitHub Secretsを設定してください。');result=await collect(process.env.JQUANTS_API_KEY);}catch(e){result={...base,message:e.message};}
  await mkdir(out.slice(0,out.lastIndexOf('/'))||'.',{recursive:true});
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  console.log(`Market data: ${result.status}; ${result.rankings.length} entries`);
}

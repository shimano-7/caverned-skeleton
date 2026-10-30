import {mkdir,writeFile} from 'node:fs/promises';
import {normalizeBars,fundamentals,rank} from '../discovery.js';
const generatedAt=new Date().toISOString();
const base={schemaVersion:1,market:'JP',source:{name:'JPX J-Quants API v2',url:'https://jpx-jquants.com/'},generatedAt,rankings:[],status:'unavailable',coverage:{}};
const out=process.env.MARKET_OUTPUT||'data/japan.json';
import {createClient,MarketError} from './market-client.mjs';
export async function collect(apiKey,request=fetch,options={}){
  const {totalTimeoutMs=300000,log=console.log,...clientOptions}=options;
  const limit=Number(options.limit??process.env.SCREEN_LIMIT??20);
  if(!Number.isInteger(limit)||limit<5||limit>100)throw new MarketError('SCREEN_LIMITは5〜100',{fatal:true});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),totalTimeoutMs);
  const api=createClient(apiKey,{request,signal:controller.signal,log,...clientOptions});
  try {
  log(`Market update: master start; limit ${limit}; total budget ${totalTimeoutMs}ms`);
  const master=await api('equities/master');
  const universe=master.filter(s=>String(s.Mkt)==='0111').sort((a,b)=>String(a.Code).localeCompare(String(b.Code)));

  const selected=universe.slice(0,limit),stocks=[],errors=[];
  const from=new Date();from.setUTCFullYear(from.getUTCFullYear()-1);
  let attempted=0,consecutiveErrors=0;
  log(`Market update: ${selected.length} stocks; total budget ${totalTimeoutMs}ms`);
  for(const s of selected){
    attempted++;
    log(`Stock ${attempted}/${selected.length}: start`);
    try{
      const rows=normalizeBars(await api('equities/bars/daily',{code:s.Code,from:from.toISOString().slice(0,10)}));
      if(!rows.length)throw Error('価格なし');
      if(!(rows.at(-1).rawClose>0))throw Error('未調整終値なし');
      const raw=await api('fins/summary',{code:s.Code});
      stocks.push({code:String(s.Code),name:s.CoName,market:'JP',rows,metrics:fundamentals(raw,rows.at(-1).rawClose,rows.at(-1).date)});
      consecutiveErrors=0;
      log(`Stock ${attempted}/${selected.length}: received`);
    }catch(e){
      if(controller.signal.aborted)throw new MarketError('取得処理の制限時間に達しました',{fatal:true});
      if(e instanceof MarketError && e.fatal)throw e;
      const reason=e instanceof MarketError?e.message:'価格または財務データが不足・不正';
      errors.push({code:String(s.Code),reason});
      log(`Stock ${attempted}/${selected.length}: excluded (${reason})`);
      if(++consecutiveErrors>=5)throw new MarketError('5銘柄連続で取得・検証に失敗したため中止しました',{fatal:true});
    }
  }
  const ranked=rank(stocks);
  return {...base,...ranked,status:ranked.rankings.length?'ok':'unavailable',coverage:{universe:universe.length,attempted,eligible:ranked.eligibleCount,selection:'東証プライム・コード昇順（上限あり）。全市場ランキングではありません。'},excluded:[...errors,...ranked.excluded],message:ranked.rankings.length?'分析対象内の上位銘柄です。':'必要な実データがそろわず、ランキングを生成できませんでした。'};
  } finally {clearTimeout(timer);controller.abort();}
}
if(process.argv[1]?.endsWith('update-market.mjs')){
  let result;
  try{if(!process.env.JQUANTS_API_KEY)throw new MarketError('JQUANTS_API_KEYが未設定です。GitHub Secretsを設定してください。');result=await collect(process.env.JQUANTS_API_KEY);}catch(e){result={...base,message:e instanceof MarketError?e.message:'データ更新に失敗しました。設定と接続を確認してください。'};console.error(`Market update stopped: ${result.message}`);}
  await mkdir(out.slice(0,out.lastIndexOf('/'))||'.',{recursive:true});
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  console.log(`Market data: ${result.status}; ${result.rankings.length} entries`);
}

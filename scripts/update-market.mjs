import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {normalizeBars,fundamentals,rank} from '../discovery.js';
const generatedAt=new Date().toISOString();
const base={schemaVersion:1,market:'JP',source:{name:'JPX J-Quants API v2',url:'https://jpx-jquants.com/'},generatedAt,rankings:[],status:'unavailable',coverage:{}};
const out=process.env.MARKET_OUTPUT||'data/japan.json';
import {openCache,reusableSnapshot} from './market-cache.mjs';
import {join} from 'node:path';
import {diagnoseCache} from './diagnose-cache.mjs';
import {createClient,MarketError} from './market-client.mjs';
export async function collect(apiKey,request=fetch,options={}){
  const {totalTimeoutMs=600000,log=console.log,...clientOptions}=options;
  const limit=Number(options.limit??process.env.SCREEN_LIMIT??10);
  if(!Number.isInteger(limit)||limit<5||limit>100)throw new MarketError('SCREEN_LIMITは5〜100',{fatal:true});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),totalTimeoutMs);
  const rawApi=createClient(apiKey,{request,signal:controller.signal,log,...clientOptions});
  const api=options.cache?options.cache.wrap(rawApi):rawApi;
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
      const priceParams={code:s.Code,from:from.toISOString().slice(0,7)+'-01'};
      const rows=normalizeBars(await api('equities/bars/daily',priceParams));
      if(!rows.length)throw Error('価格なし');
      if(!(rows.at(-1).rawClose>0))throw Error('未調整終値なし');
      const raw=await api('fins/summary',{code:s.Code});
      stocks.push({code:String(s.Code),name:s.CoName,market:'JP',rows,priceFetchedAt:new Date(options.cache?.timestamp('equities/bars/daily',priceParams)??Date.now()).toISOString(),financialsFetchedAt:new Date(options.cache?.timestamp('fins/summary',{code:s.Code})??Date.now()).toISOString(),metrics:fundamentals(raw,rows.at(-1).rawClose,rows.at(-1).date)});
      consecutiveErrors=0;
      log(`Stock ${attempted}/${selected.length}: received`);
    }catch(e){
      if(controller.signal.aborted)throw new MarketError('取得処理の制限時間に達しました',{fatal:true});
      if(e instanceof MarketError && e.fatal)throw e;
      const reason=e instanceof Error?e.message:String(e);
      errors.push({code:String(s.Code),reason});
      log(`Stock ${attempted}/${selected.length}: excluded (${reason})`);
      if(++consecutiveErrors>=5)throw new MarketError('5銘柄連続で取得・検証に失敗したため中止しました',{fatal:true});
    }
  }
  const ranked=rank(stocks);
  for (const excluded of ranked.excluded) log(`Ranking excluded ${excluded.code}: ${excluded.reason}`);
  return {...base,...ranked,status:ranked.rankings.length?'ok':'unavailable',coverage:{universe:universe.length,attempted,eligible:ranked.eligibleCount,selection:'東証プライム・コード昇順（上限あり）。全市場ランキングではありません。'},excluded:[...errors,...ranked.excluded],message:ranked.rankings.length?'分析対象内の上位銘柄です。':'必要な実データがそろわず、ランキングを生成できませんでした。'};
  } finally {clearTimeout(timer);controller.abort();}
}
if(process.argv[1]?.endsWith('update-market.mjs')){
  const cache=await openCache(process.env.MARKET_CACHE_DIR||'.market-cache');
  const snapshotPath=join(process.env.MARKET_CACHE_DIR||'.market-cache','snapshot.json');
  let result;
  try{
    if(process.env.CACHE_ONLY==='true'){
      result=diagnoseCache(cache);
    }else{
    if(!process.env.JQUANTS_API_KEY)throw new MarketError('JQUANTS_API_KEYが未設定です。GitHub Secretsを設定してください。');
    result=await collect(process.env.JQUANTS_API_KEY,fetch,{cache,rateState:cache.state.rate,onCooldown:cache.save});
    // 0件でも除外理由を消さず保存する。
    for(const item of result.excluded||[])console.log(`Excluded ${item.code}: ${item.reason}`);
    if(result.status==='ok')await writeFile(snapshotPath,JSON.stringify(result));
    console.log(`Ranking diagnostics: attempted=${result.coverage?.attempted??0}, eligible=${result.eligibleCount??0}, excluded=${result.excluded?.length??0}`);
    }
  }catch(e){
    const message=e instanceof MarketError?e.message:'データ更新に失敗しました。設定と接続を確認してください。';
    result={...base,message};
    try{
      const previous=JSON.parse(await readFile(snapshotPath,'utf8'));
      if(reusableSnapshot(previous))result={...previous,lastAttemptAt:new Date().toISOString(),warning:`更新未完了：${message}。取得済みデータを表示しています。`};
    }catch{}
    console.error(`Market update stopped: ${message}`);
  }
  await mkdir(out.slice(0,out.lastIndexOf('/'))||'.',{recursive:true});
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  console.log(`Market data: ${result.status}; ${result.rankings.length} entries; cached=${Boolean(result.warning)}`);
}

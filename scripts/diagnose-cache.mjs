import {normalizeBars,fundamentals,rank} from '../discovery.js';
// fetchを受け取らず、保存済みデータのみを読み取る。TTL超過も診断し、鮮度は判定で除外する。
export function diagnoseCache(cache,{limit=10,now=new Date(),log=console.log}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('診断対象件数が不正');
  const records=[];
  for(const [key,entry]of Object.entries(cache.state.entries)){
    try{const [path,params]=JSON.parse(key);if(Array.isArray(entry.data))records.push({path,params,entry});}catch{}
  }
  const find=(path,code)=>records.filter(r=>r.path===path&&(!code||String(r.params.code)===String(code))).sort((a,b)=>b.entry.savedAt-a.entry.savedAt)[0]?.entry;
  const master=find('equities/master');
  let universe=master?.data.filter(s=>String(s.Mkt)==='0111').sort((a,b)=>String(a.Code).localeCompare(String(b.Code)));
  if(!universe?.length){
    const codes=[...new Set(records.filter(r=>r.params.code).map(r=>String(r.params.code)))].sort();
    universe=codes.map(Code=>({Code,CoName:'名称未取得'}));
  }
  const stocks=universe.slice(0,limit).map(s=>{
    const price=find('equities/bars/daily',s.Code),financial=find('fins/summary',s.Code);
    const stock={code:String(s.Code),name:s.CoName||String(s.Code),market:'JP',rows:[],metrics:{},priceFetchedAt:price?new Date(price.savedAt).toISOString():null,financialsFetchedAt:financial?new Date(financial.savedAt).toISOString():null};
    try{stock.rows=normalizeBars(price?.data||[]);}catch{stock.priceError='保存済み株価データが不正';}
    try{
      if(!financial)throw Error('財務データのキャッシュなし');
      const last=stock.rows.at(-1);
      if(!(last?.rawClose>0))throw Error('財務倍率の計算に必要な未調整終値が不足');
      stock.metrics=fundamentals(financial.data,last.rawClose,last.date);
    }catch(e){stock.financialError=['比較可能な通期決算が不足','比較年度が連続していません','財務データのキャッシュなし','財務倍率の計算に必要な未調整終値が不足'].includes(e.message)?e.message:'保存済み財務データが不正';}
    return stock;
  });
  const result=rank(stocks,now);
  for(const item of result.excluded)log(`Excluded ${item.code}: ${item.reason}`);
  log(`Cache diagnosis: examined=${stocks.length}; eligible=${result.eligibleCount}; excluded=${result.excluded.length}; API calls=0`);
  return {schemaVersion:1,status:result.rankings.length?'ok':'unavailable',market:'JP',source:{name:'JPX J-Quants API v2（保存済みデータのみ）',url:'https://jpx-jquants.com/'},...result,generatedAt:now.toISOString(),diagnosedAt:now.toISOString(),cacheOnly:true,coverage:{universe:universe.length,attempted:stocks.length,eligible:result.eligibleCount,selection:master?'保存済み東証プライム・コード昇順。市場データAPIへのアクセスなし。':'銘柄一覧なし：キャッシュ内の銘柄のみを診断。市場データAPIへのアクセスなし。'},message:stocks.length?'保存済みデータを再判定しました。除外理由を確認してください。':'保存済みキャッシュがありません。APIにはアクセスしていません。'};
}

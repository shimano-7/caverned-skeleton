export class MarketError extends Error {
  constructor(message, {fatal=false}={}) { super(message); this.fatal=fatal; }
}
export function wait(ms,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(new MarketError('取得処理の制限時間に達しました',{fatal:true}));
    const onAbort=()=>{clearTimeout(timer);reject(new MarketError('取得処理の制限時間に達しました',{fatal:true}));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);
    signal.addEventListener('abort',onAbort,{once:true});
  });
}
export function createClient(apiKey,{request=fetch,signal,requestTimeoutMs=15000,pauseMs=1200,maxPages=10,retryWaitMs=15000,log=console.log}={}){
  let nextRequest=0;
  async function page(path,params){
    for(let attempt=0;attempt<2;attempt++){
      await wait(Math.max(0,nextRequest-Date.now()),signal);
      nextRequest=Date.now()+pauseMs;
      const controller=new AbortController();
      let timer,onAbort;
      try{
        const bounded=new Promise((_,reject)=>{
          onAbort=()=>{controller.abort();reject(new MarketError('取得処理の制限時間に達しました',{fatal:true}));};
          signal.addEventListener('abort',onAbort,{once:true});
          if(signal.aborted)onAbort();
          timer=setTimeout(()=>{controller.abort();reject(new MarketError(`J-Quants ${path}: 通信タイムアウト`));},requestTimeoutMs);
        });
        const operation=async()=>{
          const url=new URL('https://api.jquants.com/v2/'+path);
          for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
          const response=await request(url,{headers:{'x-api-key':apiKey},signal:controller.signal});
          if(response.status===429||response.status>=500){await response.body?.cancel();return {retry:response.status};}
          if(!response.ok){await response.body?.cancel();throw new MarketError(`J-Quants ${path}: HTTP ${response.status}`,{fatal:[400,401,403,404].includes(response.status)});}
          const body=await response.json();
          if(!Array.isArray(body.data))throw new MarketError(`J-Quants ${path}: 応答形式が未対応`,{fatal:true});
          return {body};
        };
        const result=await Promise.race([operation(),bounded]);
        if(result.body)return result.body;
        if(attempt===1)throw new MarketError(`J-Quants ${path}: HTTP ${result.retry}（再試行上限）`,{fatal:result.retry===429});
        log(`API ${path}: HTTP ${result.retry}; retry 1/1`);
      }catch(e){
        // サーバー本文、URL、ヘッダー、キーをエラーに含めない。
        if(e instanceof MarketError){if(e.fatal||attempt===1)throw e;}else if(attempt===1)throw new MarketError(`J-Quants ${path}: 通信またはJSON処理に失敗`);
      }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
      await wait(retryWaitMs,signal);
    }
  }
  return async(path,params={})=>{
    const result=[],seen=new Set();let key;
    for(let pages=0;pages<maxPages;pages++){
      const body=await page(path,{...params,...(key?{pagination_key:key}:{})});
      result.push(...body.data);
      if(result.length>100000)throw new MarketError('取得レコード数の上限',{fatal:true});
      key=body.pagination_key;
      if(!key)return result;
      if(typeof key!=='string'||seen.has(key))throw new MarketError('ページングキーの循環または不正',{fatal:true});
      seen.add(key);
    }
    throw new MarketError('取得ページ数の上限',{fatal:true});
  };
}

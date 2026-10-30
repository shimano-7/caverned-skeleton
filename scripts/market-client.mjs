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
export function retryDelay(value,attempt,{now=Date.now(),baseMs=60000,jitterMs=Math.floor(Math.random()*1000)}={}){
  const seconds=typeof value==='string'&&/^\d+(\.\d+)?$/.test(value.trim())?Number(value)*1000:NaN;
  const header=Number.isFinite(seconds)?seconds:Math.max(0,Date.parse(value)-now);
  return Math.max(baseMs*2**attempt,Number.isFinite(header)?header:0)+jitterMs;
}
export function createClient(apiKey,{request=fetch,signal,requestTimeoutMs=15000,pauseMs=13000,maxPages=10,retryWaitMs=60000,maxAttempts=3,jitterMs=1000,rateState={},onCooldown=async()=>{},sleep=wait,log=console.log}={}){
  let nextRequest=0;
  async function page(path,params){
    for(let attempt=0;attempt<maxAttempts;attempt++){
      await sleep(Math.max(0,nextRequest-Date.now(),(rateState.blockedUntil||0)-Date.now()),signal);
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
          if(response.status===429||response.status>=500){await response.body?.cancel();return {retry:response.status,retryAfter:response.headers?.get('retry-after')};}
          if(!response.ok){await response.body?.cancel();throw new MarketError(`J-Quants ${path}: HTTP ${response.status}`,{fatal:[400,401,403,404].includes(response.status)});}
          const body=await response.json();
          if(!Array.isArray(body.data))throw new MarketError(`J-Quants ${path}: 応答形式が未対応`,{fatal:true});
          return {body};
        };
        const result=await Promise.race([operation(),bounded]);
        if(result.body)return result.body;
        if(result.retry===429){
          const delay=retryDelay(result.retryAfter,attempt,{baseMs:retryWaitMs,jitterMs:Math.floor(Math.random()*jitterMs)});
          rateState.blockedUntil=Date.now()+delay;
          await onCooldown();
          log(`API ${path}: HTTP 429; cooldown ${Math.ceil(delay/1000)}s`);
        }
        if(attempt===maxAttempts-1)throw new MarketError(`J-Quants ${path}: HTTP ${result.retry}（再試行上限）`,{fatal:result.retry===429});
        log(`API ${path}: HTTP ${result.retry}; retry ${attempt+1}/${maxAttempts-1}`);
      }catch(e){
        // サーバー本文、URL、ヘッダー、キーをエラーに含めない。
        if(e instanceof MarketError){if(e.fatal||attempt===maxAttempts-1)throw e;}else if(result.retry===429){
          const delay=retryDelay(result.retryAfter,attempt,{baseMs:retryWaitMs,jitterMs:Math.floor(Math.random()*jitterMs)});
          rateState.blockedUntil=Date.now()+delay;
          await onCooldown();
          log(`API ${path}: HTTP 429; cooldown ${Math.ceil(delay/1000)}s`);
        }
        if(attempt===maxAttempts-1)throw new MarketError(`J-Quants ${path}: 通信またはJSON処理に失敗`);
      }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
      await sleep(retryWaitMs,signal);
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

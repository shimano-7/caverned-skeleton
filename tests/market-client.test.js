import test from 'node:test';import assert from 'node:assert/strict';
import {createClient,retryDelay} from '../scripts/market-client.mjs';
import {collect} from '../scripts/update-market.mjs';
function client(request,options={}){return createClient('TEST-SECRET-NOT-REAL',{request,signal:new AbortController().signal,pauseMs:0,retryWaitMs:0,jitterMs:0,maxAttempts:2,requestTimeoutMs:30,log:()=>{},...options});}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('成功とページング',async()=>{let count=0;const api=client(async()=>response(++count===1?{data:[1],pagination_key:'next'}:{data:[2]}));assert.deepEqual(await api('equities/master'),[1,2]);assert.equal(count,2);});
test('401/403は再試行せず本文やキーを公開しない',async()=>{for(const status of [401,403]){let count=0;const api=client(async()=>{count++;return response({secret:'TEST-SECRET-NOT-REAL'},status);});await assert.rejects(api('fins/summary'),e=>e.fatal&&!e.message.includes('TEST-SECRET'));assert.equal(count,1);}});
test('429は1回だけ再試行し最後に余分な待機をしない',async()=>{let count=0;const api=client(async()=>{count++;return response({},429);});await assert.rejects(api('equities/master'),e=>e.fatal&&e.message.includes('429'));assert.equal(count,2);});
test('500は再試行して復旧できる',async()=>{let count=0;const api=client(async()=>++count===1?response({},503):response({data:[]}));assert.deepEqual(await api('equities/master'),[]);assert.equal(count,2);});
test('応答ヘッダー後に本文が停止してもタイムアウト',async()=>{let count=0;const api=client(async()=>{count++;return {ok:true,status:200,json:()=>new Promise(()=>{})};});await assert.rejects(api('fins/summary'),/タイムアウト/);assert.equal(count,2);});
test('fetchが停止してもタイムアウト',async()=>{await assert.rejects(client(()=>new Promise(()=>{}))('equities/master'),/タイムアウト/);});
test('ページング循環と最大ページ数を検出',async()=>{await assert.rejects(client(async()=>response({data:[],pagination_key:'same'}))('equities/master'),/循環/);let n=0;await assert.rejects(client(async()=>response({data:[],pagination_key:String(++n)}),{maxPages:2})('equities/master'),/ページ数/);});
test('全体の予算切れは通信単位のタイムアウトより先に中止',async()=>{await assert.rejects(collect('TEST',()=>new Promise(()=>{}),{totalTimeoutMs:20,requestTimeoutMs:1000,log:()=>{}}),/制限時間/);});
test('10銘柄が既定上限、5連続不正データで中止し進捗を記録',async()=>{let calls=0;const logs=[];await assert.rejects(collect('TEST',async()=>{calls++;return response({data:calls===1?Array.from({length:100},(_,i)=>({Code:String(10000+i),Mkt:'0111'})):[]});},{pauseMs:0,log:m=>logs.push(m)}),/5銘柄連続/);assert.equal(calls,6);assert.ok(logs.some(s=>s.includes('10 stocks')));assert.ok(logs.some(s=>s.includes('5/10')));});
test('件数範囲を通信開始前に検証',async()=>{let calls=0;await assert.rejects(collect('TEST',()=>{calls++;},{limit:101}),/SCREEN_LIMIT/);assert.equal(calls,0);});

test('Retry-Afterの秒数・HTTP日付と指数バックオフを尊重',()=>{
  assert.equal(retryDelay('120',0,{now:0,jitterMs:0}),120000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:03:00 GMT',0,{now:0,jitterMs:0}),180000);
  assert.equal(retryDelay(null,1,{now:0,jitterMs:0}),120000);
  assert.equal(retryDelay('invalid',0,{now:0,jitterMs:0}),60000);
});
test('429のRetry-Afterを共有クールダウンに保存し再試行',async()=>{
  let calls=0,saved=0;const delays=[],rateState={};
  const api=client(async()=>++calls===1?new Response('{}',{status:429,headers:{'Retry-After':'120'}}):response({data:[1]}),{rateState,onCooldown:async()=>saved++,sleep:async ms=>delays.push(ms)});
  assert.deepEqual(await api('equities/master'),[1]);assert.equal(saved,1);assert.ok(delays.some(ms=>ms>119000));assert.ok(rateState.blockedUntil>Date.now()+119000);
});
test('復元されたクールダウンが最初のAPI呼び出しにも適用される',async()=>{
  const delays=[];await client(async()=>response({data:[]}),{rateState:{blockedUntil:Date.now()+60000},sleep:async ms=>delays.push(ms)})('equities/master');assert.ok(delays[0]>59000);
});
test('既定の429再試行は2回まででクールダウンを最後にも保存',async()=>{
 let calls=0,saves=0;await assert.rejects(client(async()=>{calls++;return response({},429);},{maxAttempts:3,onCooldown:async()=>saves++})('equities/master'),/429/);assert.equal(calls,3);assert.equal(saves,3);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {createClient} from '../scripts/market-client.mjs';
import {collect} from '../scripts/update-market.mjs';
function client(request,options={}){return createClient('TEST-SECRET-NOT-REAL',{request,signal:new AbortController().signal,pauseMs:0,retryWaitMs:0,requestTimeoutMs:30,log:()=>{},...options});}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('成功とページング',async()=>{let count=0;const api=client(async()=>response(++count===1?{data:[1],pagination_key:'next'}:{data:[2]}));assert.deepEqual(await api('equities/master'),[1,2]);assert.equal(count,2);});
test('401/403は再試行せず本文やキーを公開しない',async()=>{for(const status of [401,403]){let count=0;const api=client(async()=>{count++;return response({secret:'TEST-SECRET-NOT-REAL'},status);});await assert.rejects(api('fins/summary'),e=>e.fatal&&!e.message.includes('TEST-SECRET'));assert.equal(count,1);}});
test('429は1回だけ再試行し最後に余分な待機をしない',async()=>{let count=0;const api=client(async()=>{count++;return response({},429);});await assert.rejects(api('equities/master'),e=>e.fatal&&e.message.includes('429'));assert.equal(count,2);});
test('500は再試行して復旧できる',async()=>{let count=0;const api=client(async()=>++count===1?response({},503):response({data:[]}));assert.deepEqual(await api('equities/master'),[]);assert.equal(count,2);});
test('応答ヘッダー後に本文が停止してもタイムアウト',async()=>{let count=0;const api=client(async()=>{count++;return {ok:true,status:200,json:()=>new Promise(()=>{})};});await assert.rejects(api('fins/summary'),/タイムアウト/);assert.equal(count,2);});
test('fetchが停止してもタイムアウト',async()=>{await assert.rejects(client(()=>new Promise(()=>{}))('equities/master'),/タイムアウト/);});
test('ページング循環と最大ページ数を検出',async()=>{await assert.rejects(client(async()=>response({data:[],pagination_key:'same'}))('equities/master'),/循環/);let n=0;await assert.rejects(client(async()=>response({data:[],pagination_key:String(++n)}),{maxPages:2})('equities/master'),/ページ数/);});
test('全体の予算切れは通信単位のタイムアウトより先に中止',async()=>{await assert.rejects(collect('TEST',()=>new Promise(()=>{}),{totalTimeoutMs:20,requestTimeoutMs:1000,log:()=>{}}),/制限時間/);});
test('20銘柄が既定上限、5連続不正データで中止し進捗を記録',async()=>{let calls=0;const logs=[];await assert.rejects(collect('TEST',async()=>{calls++;return response({data:calls===1?Array.from({length:100},(_,i)=>({Code:String(10000+i),Mkt:'0111'})):[]});},{pauseMs:0,log:m=>logs.push(m)}),/5銘柄連続/);assert.equal(calls,6);assert.ok(logs.some(s=>s.includes('20 stocks')));assert.ok(logs.some(s=>s.includes('5/20')));});
test('件数範囲を通信開始前に検証',async()=>{let calls=0;await assert.rejects(collect('TEST',()=>{calls++;},{limit:101}),/SCREEN_LIMIT/);assert.equal(calls,0);});

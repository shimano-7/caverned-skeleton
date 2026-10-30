import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openCache,reusableSnapshot} from '../scripts/market-cache.mjs';
test('取得成功データを別実行で復元し呼び出し0回、期限後は再取得',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'stock-cache-'));let time=1000,calls=0;
  try{
    const source=async()=>{calls++;return [{Code:'12340'}];};
    const first=await openCache(dir,{now:()=>time,log:()=>{}});await first.wrap(source)('equities/master');
    const second=await openCache(dir,{now:()=>time,log:()=>{}});await second.wrap(source)('equities/master');assert.equal(calls,1);
    time+=8*86400000;await second.wrap(source)('equities/master');assert.equal(calls,2);
    assert.ok(!(await readFile(join(dir,'market.json'),'utf8')).includes('x-api-key'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('失敗をキャッシュせず、成功済みエンドポイントは後続失敗でも残る',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-cache-'));
 try{const cache=await openCache(dir,{log:()=>{}});await cache.wrap(async()=>[1])('equities/master');await assert.rejects(cache.wrap(async()=>{throw Error('failed');})('fins/summary',{code:'12340'}));const restored=await openCache(dir,{log:()=>{}});assert.equal(Object.keys(restored.state.entries).length,1);assert.deepEqual(await restored.wrap(()=>assert.fail('must reuse'))('equities/master'),[1]);}finally{await rm(dir,{recursive:true,force:true});}
});
test('財務と価格のTTLは別々に適用される',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-cache-'));let now=0,calls=0;
 try{const cache=await openCache(dir,{now:()=>now,log:()=>{}});const api=cache.wrap(async()=>{calls++;return [];});await api('equities/bars/daily');await api('fins/summary');now=13*3600000;await api('equities/bars/daily');await api('fins/summary');assert.equal(calls,3);}finally{await rm(dir,{recursive:true,force:true});}
});
test('スナップショット再利用で日時を更新せず36時間・価格7日の鮮度を要求',()=>{
 const now=Date.parse('2026-10-31T00:00:00Z');const s={status:'ok',generatedAt:'2026-10-30T10:00:00Z',rankings:[{priceDate:'2026-10-30'}]};assert.equal(reusableSnapshot(s,now),true);assert.equal(reusableSnapshot({...s,generatedAt:'2026-10-28'},now),false);assert.equal(reusableSnapshot({...s,rankings:[{priceDate:'2026-10-01'}]},now),false);assert.equal(reusableSnapshot({status:'unavailable'},now),false);
});
test('更新失敗時に保存済みランキングの生成日時を変えず公開JSONへ戻す',async()=>{
 const {spawnSync}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'stock-fallback-'));
 try{
  const {writeFile}=await import('node:fs/promises');
  const generatedAt=new Date(Date.now()-3600000).toISOString();
  const previous={status:'ok',generatedAt,rankings:[{priceDate:new Date().toISOString().slice(0,10)}]};
  await writeFile(join(dir,'snapshot.json'),JSON.stringify(previous));
  const output=join(dir,'output.json');
  const result=spawnSync(process.execPath,['scripts/update-market.mjs'],{env:{...process.env,JQUANTS_API_KEY:'',MARKET_CACHE_DIR:dir,MARKET_OUTPUT:output},encoding:'utf8'});
  assert.equal(result.status,0);const restored=JSON.parse(await readFile(output,'utf8'));assert.equal(restored.generatedAt,generatedAt);assert.equal(restored.rankings.length,1);assert.match(restored.warning,/更新未完了/);assert.ok(restored.lastAttemptAt);
 }finally{await rm(dir,{recursive:true,force:true});}
});

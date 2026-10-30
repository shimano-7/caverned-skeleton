import test from 'node:test';import assert from 'node:assert/strict';
import {diagnoseCache} from '../scripts/diagnose-cache.mjs';import {diagnoseStock,rank} from '../discovery.js';
const now=new Date('2026-10-31T00:00:00Z');
const rows=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2026,7,12+i)).toISOString().slice(0,10),close:100+i,volume:100,rawClose:100+i}));
const metrics={salesGrowth:10,profitGrowth:10,per:10,pbr:1,roe:10,dividendYield:2,disclosedAt:'2026-05-01'};
test('株価・財務・25/75日線の全不足を同時記録',()=>{const s=diagnoseStock({code:'1',rows:[],metrics:{}},now);assert.equal(s.checks.price.status,'missing');assert.equal(s.checks.financials.status,'missing');assert.equal(s.checks.ma25.status,'uncomputable');assert.equal(s.checks.ma75.status,'uncomputable');assert.equal(s.checks.financials.missing.length,6);});
test('25本なら25日線は利用可・75日線は不足と個別判定',()=>{const s=diagnoseStock({code:'1',rows:rows.slice(-25),metrics},now);assert.equal(s.checks.ma25.status,'available');assert.equal(s.checks.ma75.status,'missing');assert.equal(s.checks.ma75.count,25);});
test('財務不足の指標名を記録し移動平均とは区別',()=>{const s=diagnoseStock({code:'1',rows,metrics:{...metrics,per:null,roe:null}},now);assert.deepEqual(s.checks.financials.missing,['PER','ROE']);assert.equal(s.checks.ma75.status,'available');});
test('ゼロ件でも全銘柄・全カテゴリの件数を保持',()=>{const result=rank([{code:'1',rows:[],metrics:{}},{code:'2',rows:rows.slice(-20),metrics}],now);assert.equal(result.rankings.length,0);assert.equal(result.excluded.length,2);assert.deepEqual(result.exclusionSummary.categories,{price:1,financials:1,ma25:2,ma75:2});});
test('TTLやfromが異なるキャッシュも診断対象、API不使用',()=>{
 const entries={};const put=(path,params,data)=>entries[JSON.stringify([path,params])]={savedAt:Date.parse('2026-10-01'),data};
 put('equities/master',{},[{Code:'12340',CoName:'テスト銘柄',Mkt:'0111'}]);put('equities/bars/daily',{code:'12340',from:'2025-10-30'},rows.map(r=>({Date:r.date,AdjC:r.close,AdjVo:r.volume,C:r.rawClose})));put('fins/summary',{code:'12340'},[]);
 const logs=[];const result=diagnoseCache({state:{entries}},{now,log:m=>logs.push(m)});assert.equal(result.coverage.attempted,1);assert.equal(result.excluded[0].checks.price.status,'available');assert.equal(result.excluded[0].checks.ma75.status,'available');assert.match(result.excluded[0].reason,/通期決算/);assert.ok(logs.some(s=>s.includes('API calls=0')));
});
test('masterなしではキャッシュの銘柄を診断し、完全に空なら空と明記',()=>{
 const empty=diagnoseCache({state:{entries:{}}},{now,log:()=>{}});assert.equal(empty.coverage.attempted,0);assert.match(empty.message,/キャッシュがありません/);
 const entries={[JSON.stringify(['fins/summary',{code:'12340'}])]:{savedAt:now.getTime(),data:[]}};
 assert.equal(diagnoseCache({state:{entries}},{now,log:()=>{}}).excluded[0].code,'12340');
});
test('キャッシュ専用CLIはfetchを禁止しても成功しキーを不要とする',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {spawnSync}=await import('node:child_process');const dir=await mkdtemp(join(tmpdir(),'offline-diagnose-'));
 try{const guard=join(dir,'guard.mjs');await writeFile(guard,"globalThis.fetch=()=>{throw Error('NETWORK IS FORBIDDEN')};");const output=join(dir,'output.json');const child=spawnSync(process.execPath,['--import',guard,'scripts/update-market.mjs'],{env:{...process.env,CACHE_ONLY:'true',JQUANTS_API_KEY:'',MARKET_CACHE_DIR:dir,MARKET_OUTPUT:output},encoding:'utf8'});assert.equal(child.status,0);const result=JSON.parse(await readFile(output,'utf8'));assert.equal(result.cacheOnly,true);assert.equal(result.exclusionSummary.total,0);assert.match(child.stdout,/API calls=0/);}finally{await rm(dir,{recursive:true,force:true});}
});

import test from 'node:test';import assert from 'node:assert/strict';import {priceFreshness,lastCompletedSession,isTradingDay} from '../japan-calendar.js';
test('土曜・日曜は金曜が基準、取得日時を最新取引日へ代用しない',()=>{for(const day of ['2026-10-31','2026-11-01']){const f=priceFreshness('2026-10-30',new Date(day+'T03:00:00Z'));assert.equal(f.status,'available');assert.equal(f.expectedDate,'2026-10-30');assert.equal(f.missingSessions,0);}assert.equal(priceFreshness('2026-10-20',new Date('2026-10-31')).status,'stale');});
test('月曜祝日と国民の休日・振替休日を除外',()=>{assert.equal(lastCompletedSession(new Date('2026-10-12T10:00:00Z')).expectedDate,'2026-10-09');for(const d of ['2026-09-21','2026-09-22','2026-09-23','2026-05-06'])assert.equal(isTradingDay(d),false);});
test('年末年始の7暦日超の経過も取引がなければ有効',()=>{const f=priceFreshness('2024-12-30',new Date('2025-01-06T02:00:00Z'));assert.equal(f.expectedDate,'2024-12-30');assert.equal(f.status,'available');});
test('引け前・引け後と反映待ちを区別、反映待ちはランキング不可',()=>{assert.equal(lastCompletedSession(new Date('2026-10-30T06:29:00Z')).expectedDate,'2026-10-29');const pending=priceFreshness('2026-10-29',new Date('2026-10-30T06:30:00Z'));assert.equal(pending.status,'pending');assert.equal(priceFreshness('2026-10-29',new Date('2026-10-30T11:00:00Z')).status,'stale');});
test('古いデータは不足営業日数で除外、未来・休場日・対応年外は不可',()=>{assert.equal(priceFreshness('2026-10-29',new Date('2026-10-31')).missingSessions,1);assert.equal(priceFreshness('2026-10-31',new Date('2026-10-31')).status,'invalid');assert.equal(priceFreshness('2026-11-02',new Date('2026-10-31')).status,'invalid');assert.equal(priceFreshness('2030-01-01',new Date('2030-01-02')).status,'unknown');});
test('208本と移動平均があっても、取得日時で古い取引日を最新扱いしない',async()=>{
 const {diagnoseStock}=await import('../discovery.js');const now=new Date('2026-10-31T03:00:00Z');
 const all=[];for(let date='2025-11-01';date<='2026-10-30';date=new Date(Date.parse(date)+86400000).toISOString().slice(0,10))if(isTradingDay(date))all.push({date,close:100,volume:100});
 const stock={code:'TEST',rows:all.filter(r=>r.date<='2026-10-15').slice(-208),metrics:{},priceFetchedAt:now.toISOString()};
 const result=diagnoseStock(stock,now);assert.equal(result.checks.price.count,208);assert.equal(result.checks.ma25.status,'available');assert.equal(result.checks.ma75.status,'available');assert.equal(result.checks.price.status,'stale');assert.equal(result.checks.price.freshness.actualDate,'2026-10-15');assert.equal(result.checks.price.freshness.expectedDate,'2026-10-30');assert.equal(result.checks.price.freshness.missingSessions,11);
});
test('208本の最終取引日が金曜なら土曜の鮮度は有効',async()=>{
 const {diagnoseStock}=await import('../discovery.js');const rows=[];for(let date='2025-11-01';date<='2026-10-30';date=new Date(Date.parse(date)+86400000).toISOString().slice(0,10))if(isTradingDay(date))rows.push({date,close:100,volume:100});
 const result=diagnoseStock({code:'TEST',rows:rows.slice(-208),metrics:{}},new Date('2026-10-31'));assert.equal(result.checks.price.status,'available');assert.equal(result.checks.price.freshness.missingSessions,0);
});

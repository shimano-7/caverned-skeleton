const status=document.getElementById('discovery-status'),container=document.getElementById('rankings');
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fmt=(v,suffix='')=>Number.isFinite(v)?v.toLocaleString('ja-JP',{maximumFractionDigits:2})+suffix:'取得できません';
export function displayDiscovery(data,now=new Date()){
  container.replaceChildren();
  const source=document.getElementById('discovery-source');
  source.textContent=`取得元：${data.source?.name||'不明'} ｜ ${data.cacheOnly?'再判定日時':'更新試行'}：${data.generatedAt?new Date(data.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST':'未取得'}`;
  const excluded=Array.isArray(data.excluded)?data.excluded:[];
  const diagnostics=el('section',undefined,'exclusion-report');
  diagnostics.append(el('h2',`データ診断：対象 ${data.coverage?.attempted??'不明'}銘柄 / 評価可能 ${data.eligibleCount??data.coverage?.eligible??0}銘柄 / 除外 ${excluded.length}銘柄`));
  const labels={price:'株価データ',financials:'財務データ',ma25:'25日移動平均',ma75:'75日移動平均'};
  const statuses={available:'利用可能',missing:'不足',invalid:'不正',stale:'古いため対象外',uncomputable:'計算不可'};
  if(excluded.length){
    const counts=data.exclusionSummary?.categories||{};
    diagnostics.append(el('p',Object.entries(labels).map(([key,label])=>`${label}の不足・不正等 ${counts[key]??excluded.filter(s=>s.checks?.[key]&&s.checks[key].status!=='available').length}件`).join(' / '),'small muted'));
    diagnostics.append(el('p','同じ銘柄が複数の項目に該当するため、項目別件数は重複します。','small muted'));
    for(const item of excluded){
      const card=el('article',undefined,'rank-card');card.append(el('h3',`${item.name||item.code} (${item.code})`));
      for(const [key,label]of Object.entries(labels)){
        const check=item.checks?.[key];
        const info=check?`${statuses[check.status]||'未確認'}${check.count!==undefined?`（${check.count}本${check.required?` / 必要${check.required}本`:''}）`:''}`:'記録なし';
        card.append(el('p',`${label}：${info}`,'small'));
      }
      card.append(el('p',item.reason||'理由の記録なし','small'));
      card.append(el('p',`株価取得：${item.priceFetchedAt||'未取得'} / 財務取得：${item.financialsFetchedAt||'未取得'}`,'small muted'));
      diagnostics.append(card);
    }
  }else diagnostics.append(el('p',data.cacheOnly&&!data.coverage?.attempted?'キャッシュがないため銘柄別診断はできません。APIへの追加アクセスは行っていません。':'除外理由の記録はありません。','small muted'));
  container.append(diagnostics);
  const age=now-Date.parse(data.generatedAt);
  if(data.status!=='ok'||!Number.isFinite(age)||age<0||age>36*3600000||!Array.isArray(data.rankings)||!data.rankings.length){status.className='discovery-error';status.textContent=age>36*3600000?'更新から36時間以上経過したためランキングを非表示にしています。':data.message||'実データを取得できません。ランキングは表示しません。';return;}
  const c=data.coverage;
  status.textContent=`対象 ${c.attempted} / プライム ${c.universe}銘柄・評価可能 ${c.eligible}銘柄の上位${data.rankings.length}件。${c.selection}`;
  if(data.warning){status.textContent+=` ${data.warning} 最終更新試行：${data.lastAttemptAt}`;}
  for(const [i,s]of data.rankings.entries()){
    if(!s.metrics||!s.technical||!Array.isArray(s.checks)||!Number.isFinite(s.score))throw Error('ランキング形式が不正');
    const card=el('article',undefined,'rank-card'),heading=el('div',undefined,'rank-heading');
    heading.append(el('h2',`${i+1}. ${s.name} (${s.code})`),el('span',`${s.score}点 · ${s.verdict}`,'rank-score'));card.append(heading);
    card.append(el('p',`終値 ¥${fmt(s.close)} ｜ 株価基準日 ${s.priceDate} ｜ 決算開示 ${s.metrics.disclosedAt}`,'small muted'));
    const metrics=el('dl',undefined,'metrics');
    for(const [label,value]of [['売上成長率',fmt(s.metrics.salesGrowth,'%')],['利益成長率',fmt(s.metrics.profitGrowth,'%')],['PER',fmt(s.metrics.per,'倍')],['PBR',fmt(s.metrics.pbr,'倍')],['ROE',fmt(s.metrics.roe,'%')],['配当利回り',fmt(s.metrics.dividendYield,'%')],['RSI (14)',fmt(s.technical.rsi)],['出来高',fmt(s.volume,'株')],['出来高 / 20日平均',fmt(s.technical.volumeRatio,'倍')],['25日線',fmt(s.technical.ma25)],['75日線',fmt(s.technical.ma75)]]){const pair=el('div');pair.append(el('dt',label),el('dd',value));metrics.append(pair);}card.append(metrics);
    card.append(el('p',`株価取得：${s.priceFetchedAt||'不明'} ｜ 財務取得：${s.financialsFetchedAt||'不明'}`,'small muted'));
    const cross=s.technical.latestCross;card.append(el('p',cross?`${cross.type==='golden'?'GC':'DC'}：${cross.date}`:'GC/DC：取り込み期間内に交差なし','small'));
    card.append(el('p',`取得元：${data.source.name} ｜ 通期 ${s.metrics.fiscalYearEnd} / 前期 ${s.metrics.previousFiscalYearEnd}`,'small muted'));
    const details=el('details'),list=el('ul');details.append(el('summary','評価の根拠・配点を見る'));for(const check of s.checks)list.append(el('li',`${check.passed?'✓':'−'} ${check.label}：${check.passed?check.points:0}/${check.points}点`));details.append(list);card.append(details);
    const button=el('button','この銘柄のチャートを開く');button.onclick=()=>window.dispatchEvent(new CustomEvent('select-stock',{detail:s}));card.append(button);container.append(card);
  }
}
try{const response=await fetch('./data/japan.json',{cache:'no-store'});if(!response.ok)throw Error();displayDiscovery(await response.json());}catch{container.replaceChildren();status.className='discovery-error';status.textContent='実データを取得できません。架空の株価やランキングへの置き換えは行いません。';}

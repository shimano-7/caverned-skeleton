const status=document.getElementById('discovery-status'),container=document.getElementById('rankings');
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fmt=(v,suffix='')=>Number.isFinite(v)?v.toLocaleString('ja-JP',{maximumFractionDigits:2})+suffix:'取得できません';
export function displayDiscovery(data,now=new Date()){
  container.replaceChildren();
  const source=document.getElementById('discovery-source');
  source.textContent=`取得元：${data.source?.name||'不明'} ｜ 更新試行：${data.generatedAt?new Date(data.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' JST':'未取得'}`;
  const age=now-Date.parse(data.generatedAt);
  if(data.status!=='ok'||!Number.isFinite(age)||age<0||age>36*3600000||!Array.isArray(data.rankings)||!data.rankings.length){status.className='discovery-error';status.textContent=age>36*3600000?'更新から36時間以上経過したためランキングを非表示にしています。':data.message||'実データを取得できません。ランキングは表示しません。';return;}
  const c=data.coverage;
  status.textContent=`対象 ${c.attempted} / プライム ${c.universe}銘柄・評価可能 ${c.eligible}銘柄の上位${data.rankings.length}件。${c.selection}`;
  for(const [i,s]of data.rankings.entries()){
    if(!s.metrics||!s.technical||!Array.isArray(s.checks)||!Number.isFinite(s.score))throw Error('ランキング形式が不正');
    const card=el('article',undefined,'rank-card'),heading=el('div',undefined,'rank-heading');
    heading.append(el('h2',`${i+1}. ${s.name} (${s.code})`),el('span',`${s.score}点 · ${s.verdict}`,'rank-score'));card.append(heading);
    card.append(el('p',`終値 ¥${fmt(s.close)} ｜ 株価基準日 ${s.priceDate} ｜ 決算開示 ${s.metrics.disclosedAt}`,'small muted'));
    const metrics=el('dl',undefined,'metrics');
    for(const [label,value]of [['売上成長率',fmt(s.metrics.salesGrowth,'%')],['利益成長率',fmt(s.metrics.profitGrowth,'%')],['PER',fmt(s.metrics.per,'倍')],['PBR',fmt(s.metrics.pbr,'倍')],['ROE',fmt(s.metrics.roe,'%')],['配当利回り',fmt(s.metrics.dividendYield,'%')],['RSI (14)',fmt(s.technical.rsi)],['出来高',fmt(s.volume,'株')],['出来高 / 20日平均',fmt(s.technical.volumeRatio,'倍')],['25日線',fmt(s.technical.ma25)],['75日線',fmt(s.technical.ma75)]]){const pair=el('div');pair.append(el('dt',label),el('dd',value));metrics.append(pair);}card.append(metrics);
    const cross=s.technical.latestCross;card.append(el('p',cross?`${cross.type==='golden'?'GC':'DC'}：${cross.date}`:'GC/DC：取り込み期間内に交差なし','small'));
    card.append(el('p',`取得元：${data.source.name} ｜ 通期 ${s.metrics.fiscalYearEnd} / 前期 ${s.metrics.previousFiscalYearEnd}`,'small muted'));
    const details=el('details'),list=el('ul');details.append(el('summary','評価の根拠・配点を見る'));for(const check of s.checks)list.append(el('li',`${check.passed?'✓':'−'} ${check.label}：${check.passed?check.points:0}/${check.points}点`));details.append(list);card.append(details);
    const button=el('button','この銘柄のチャートを開く');button.onclick=()=>window.dispatchEvent(new CustomEvent('select-stock',{detail:s}));card.append(button);container.append(card);
  }
}
try{const response=await fetch('./data/japan.json',{cache:'no-store'});if(!response.ok)throw Error();displayDiscovery(await response.json());}catch{container.replaceChildren();status.className='discovery-error';status.textContent='実データを取得できません。架空の株価やランキングへの置き換えは行いません。';}

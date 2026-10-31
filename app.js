import { analyze, sample, parseCSV } from './analysis.js';
const $ = id => document.getElementById(id);
// 架空サンプルは明示的に開く手動分析専用。自動発掘には使用しません。
let market = 'JP', rows = sample(), range = 180, source = 'sample';
const format = n => n == null ? '—' : new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2, minimumFractionDigits: market === 'US' ? 2 : 0 }).format(n);
const money = n => n == null ? '—' : `${market === 'JP' ? '¥' : '$'}${format(n)}`;
const svg = (content, height) => `<svg viewBox="0 0 700 ${height}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
function render() {
  const result = analyze(rows), last = rows.at(-1), previous = rows.at(-2);
  $('chart-title').textContent = $('stock-name').value || '名称未設定';
  $('market-label').textContent = market === 'JP' ? 'JAPAN / JPY' : 'UNITED STATES / USD';
  $('source-tag').textContent = source === 'sample' ? 'SAMPLE DATA' : 'CSV DATA';
  $('price').textContent = money(last.close);
  const change = previous ? last.close - previous.close : 0;
  $('change').textContent = previous ? `${change >= 0 ? '+' : ''}${format(change)} (${(change / previous.close * 100).toFixed(2)}%)` : '前日比なし';
  $('change').className = change >= 0 ? 'up' : 'down';
  $('asof').textContent = `${last.date} 終値 · ${rows.length}本の日足データ`;
  $('ma25').textContent = money(result.ma25.at(-1)); $('ma75').textContent = money(result.ma75.at(-1));
  $('verdict').textContent = `${result.verdict === '買い' ? '↗' : result.verdict === '待ち' ? '◷' : '↘'} ${result.verdict}`;
  $('verdict').className = `verdict ${result.verdict === '待ち' ? 'wait' : result.verdict === '見送り' ? 'avoid' : ''}`;
  $('reason').textContent = result.reason;
  const cross = result.crosses.at(-1);
  $('cross-state').replaceChildren();
  const label = document.createElement('div'); label.className = 'cross-item ' + (cross?.type === 'golden' ? 'up' : cross ? 'down' : '');
  label.textContent = cross ? (cross.type === 'golden' ? '↗ ゴールデンクロス' : '↘ デッドクロス') : 'クロスは検出されていません';
  const date = document.createElement('p'); date.className = 'cross-date'; date.textContent = cross ? `${cross.date} 発生 · 取り込み期間内の最新` : rows.length < 76 ? '判定には最低76本のデータが必要です。' : '取り込み期間内に交差はありません。';
  $('cross-state').append(label, date);
  $('cross-history').replaceChildren(...result.crosses.slice().reverse().map(c => { const li = document.createElement('li'); li.textContent = `${c.date} ${c.type === 'golden' ? 'ゴールデンクロス' : 'デッドクロス'}`; return li; }));
  $('volume-value').textContent = `${last.volume.toLocaleString('ja-JP')} 株`;
  $('point-detail').textContent = 'グラフをタップして、その日の値を確認';
  const offset = range ? Math.max(0, rows.length - range) : 0, visible = rows.slice(offset);
  const data = [visible.map(r => r.close), result.ma25.slice(offset), result.ma75.slice(offset)];
  const all = data.flat().filter(v => v != null), min = Math.min(...all), max = Math.max(...all), pad = (max - min) * .12 || max * .02;
  const low = min - pad, high = max + pad;
  const x = i => 12 + i / Math.max(1, visible.length - 1) * 610;
  const y = v => 230 - (v - low) / (high - low) * 210;
  let chart = '';
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4, py = y(value);
    chart += `<line x1="12" x2="622" y1="${py}" y2="${py}" stroke="#eaf0f4"/><text x="634" y="${py + 4}">${format(value)}</text>`;
  }
  data.forEach((values, k) => {
    const points = values.map((v, i) => v == null ? '' : `${x(i)},${y(v)}`).filter(Boolean).join(' ');
    if (k === 0) chart += `<polygon points="${x(0)},230 ${points} ${x(visible.length - 1)},230" fill="#e8f5f2" opacity=".7"/>`;
    chart += `<polyline points="${points}" fill="none" stroke="${['#208c8a','#e9a33b','#8881cf'][k]}" stroke-width="${k ? 2 : 2.5}" stroke-linejoin="round"/>`;
    if (values.length === 1 && values[0] != null) chart += `<circle cx="${x(0)}" cy="${y(values[0])}" r="4" fill="#208c8a"/>`;
  });
  result.crosses.filter(c => c.index >= offset).forEach(c => { chart += `<circle cx="${x(c.index - offset)}" cy="${y(result.ma25[c.index])}" r="5" fill="${c.type === 'golden' ? '#178e79' : '#ce6675'}" stroke="white" stroke-width="2"/>`; });
  const ticks = [...new Set([0, Math.floor((visible.length - 1) / 2), visible.length - 1])];
  for (const i of ticks) chart += `<text x="${x(i)}" y="255" text-anchor="${i === 0 ? 'start' : i === visible.length - 1 ? 'end' : 'middle'}">${visible[i].date}</text>`;
  chart += '<line id="cursor" x1="0" x2="0" y1="15" y2="230" stroke="#64758a" stroke-dasharray="4" visibility="hidden"/>';
  $('price-chart').innerHTML = svg(chart, 265);
  const vmax = Math.max(1, ...visible.map(r => r.volume));
  const width = Math.max(.5, Math.min(14, 610 / visible.length * .65));
  $('volume-chart').innerHTML = svg(visible.map((r,i) => `<rect x="${x(i) - width/2}" y="${75 - r.volume / vmax * 65}" width="${width}" height="${r.volume / vmax * 65}" fill="${r.close >= (rows[offset+i-1]?.close ?? r.close) ? '#8fc7bc' : '#dba6b0'}" rx="1"/>`).join('') + `<text x="634" y="20">${(vmax/10000).toFixed(0)}万</text><text x="634" y="78">0</text>`, 85);
  const inspect = event => {
    const bounds = $('price-chart').getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width * 700;
    const i = Math.max(0, Math.min(visible.length - 1, Math.round((px - 12)/610 * (visible.length - 1))));
    const r = visible[i];
    $('point-detail').textContent = `${r.date} ｜ 終値 ${money(r.close)} ｜ 25日 ${money(result.ma25[offset+i])} ｜ 75日 ${money(result.ma75[offset+i])} ｜ 出来高 ${r.volume.toLocaleString()}株`;
    const cursor = $('cursor'); cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('visibility', 'visible');
  };
  $('price-chart').onpointerdown = inspect;
  $('price-chart').onpointermove = e => { if (e.pointerType === 'mouse' || e.buttons) inspect(e); };
}
function loadSample() { rows = sample(market); source = 'sample'; $('stock-name').value = market === 'JP' ? 'サンプル日本株' : 'サンプル米国株'; $('message').className = 'message'; $('message').textContent = 'サンプルは架空のデータです。実際の株価ではありません。'; render(); }
document.querySelectorAll('[data-market]').forEach(button => button.onclick = () => {
  market = button.dataset.market;
  document.querySelectorAll('[data-market]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  if (source === 'sample') loadSample(); else render();
});
document.querySelectorAll('[data-range]').forEach(button => button.onclick = () => { range = Number(button.dataset.range); document.querySelectorAll('[data-range]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); render(); });
$('stock-name').oninput = () => { $('chart-title').textContent = $('stock-name').value || '名称未設定'; };
$('sample-button').onclick = loadSample;
$('upload-button').onclick = () => $('csv-file').click();
$('csv-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('CSVは5MB以下にしてください。');
    const imported = parseCSV(await file.text());
    rows = imported; source = 'csv'; $('stock-name').value = file.name.replace(/\.csv$/i, '');
    $('message').className = 'message'; $('message').textContent = `${rows.length}本を取り込みました。通貨は日本株・米国株ボタンで選択してください。`;
    render();
  } catch (error) { $('message').className = 'message error'; $('message').textContent = error.message; }
  event.target.value = '';
};
$('download-button').onclick = () => {
  const csv = '\uFEFFdate,close,volume\n' + sample(market).map(r => `${r.date},${r.close},${r.volume}`).join('\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `sample-${market}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
render();
window.addEventListener('select-stock',event=>{
  const s=event.detail;market='JP';rows=s.rows;source='live';
  document.querySelectorAll('[data-market]').forEach(b=>{b.classList.toggle('active',b.dataset.market==='JP');b.setAttribute('aria-pressed',String(b.dataset.market==='JP'));});
  $('stock-name').value=s.name;document.getElementById('manual-analysis').open=true;
  $('message').textContent=`JPX J-Quants API v2 ｜ データ基準日 ${s.priceDate} ｜ ${s.analysisMode==='free-delayed'?'12週間遅延の過去データ分析':'実データ'}（調整済み）`;
  render();$('source-tag').textContent='J-QUANTS';$('chart-title').scrollIntoView({behavior:'smooth',block:'start'});
});

export function movingAverage(rows, period) {
  let sum = 0;
  return rows.map((row, i) => {
    sum += row.close;
    if (i >= period) sum -= rows[i - period].close;
    return i >= period - 1 ? sum / period : null;
  });
}
export function analyze(rows) {
  const ma25 = movingAverage(rows, 25), ma75 = movingAverage(rows, 75);
  const crosses = [];
  for (let i = 1; i < rows.length; i++) {
    if (ma75[i - 1] === null) continue;
    const previous = ma25[i - 1] - ma75[i - 1], current = ma25[i] - ma75[i];
    if (previous <= 0 && current > 0) crosses.push({ index: i, type: 'golden', date: rows[i].date });
    if (previous >= 0 && current < 0) crosses.push({ index: i, type: 'dead', date: rows[i].date });
  }
  const i = rows.length - 1, latest = rows[i];
  let verdict = '待ち', reason = '75本以上のデータを取り込むと、中長期の傾向を判定できます。';
  if (ma75[i] != null) {
    if (ma25[i] > ma75[i] && latest.close > ma25[i]) {
      verdict = '買い'; reason = '25日線が75日線を上回り、終値も25日線より上です。上昇傾向の参考シグナルです。';
    } else if (ma25[i] < ma75[i] && latest.close < ma25[i]) {
      verdict = '見送り'; reason = '25日線が75日線を下回り、終値も25日線より下です。下落傾向に注意してください。';
    } else { reason = '移動平均線と終値の方向がそろっていません。次の動きを確認しましょう。'; }
  }
  return { ma25, ma75, crosses, verdict, reason };
}
function fields(line) {
  const result = []; let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (line[i] === ',' && !quoted) { result.push(value.trim()); value = ''; }
    else value += line[i];
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  result.push(value.trim()); return result;
}
export function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length > 10001) throw new Error('データは10,000行以下にしてください。');
  if (lines.length < 2) throw new Error('ヘッダーと株価データが必要です。');
  const headers = fields(lines[0]).map(v => v.toLowerCase());
  const aliases = [['date', '日付'], ['close', '終値'], ['volume', '出来高']];
  const columns = aliases.map(names => headers.findIndex(h => names.includes(h)));
  if (columns.includes(-1)) throw new Error('date, close, volume（または日付・終値・出来高）列が必要です。');
  const seen = new Set();
  const rows = lines.slice(1).map((line, i) => {
    const cells = fields(line), date = (cells[columns[0]] || '').replace(/\//g, '-');
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
    const normalized = match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : '';
    const validDate = normalized && Number.isFinite(Date.parse(normalized)) && new Date(normalized).toISOString().slice(0, 10) === normalized;
    const number = index => { const raw = cells[index]?.replace(/,/g, ''); return raw ? Number(raw) : NaN; };
    const close = number(columns[1]), volume = number(columns[2]);
    if (!validDate || !Number.isFinite(close) || close <= 0 || !Number.isSafeInteger(volume) || volume < 0) throw new Error(`${i + 2}行目：日付・正の終値・0以上の整数の出来高を確認してください。`);
    if (seen.has(normalized)) throw new Error(`${i + 2}行目：日付が重複しています。`);
    seen.add(normalized); return { date: normalized, close, volume };
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
export function sample(market = 'JP') {
  const rows = []; const start = new Date('2025-10-01T00:00:00Z');
  for (let day = 0; rows.length < 180; day++) {
    const date = new Date(start); date.setUTCDate(date.getUTCDate() + day);
    if ([0,6].includes(date.getUTCDay())) continue;
    const i = rows.length;
    const trend = i < 70 ? -i * 5 : i < 125 ? -350 + (i - 70) * 11 : 255 - (i - 125) * 2 + (i - 150) ** 2 * .12;
    const close = (3000 + trend + Math.sin(i * .35) * 45) / (market === 'US' ? 16 : 1);
    rows.push({date: date.toISOString().slice(0,10), close: Math.round(close * 100) / 100, volume: Math.round(800000 + Math.sin(i * .8) * 270000 + (i % 13) * 20000)});
  }
  return rows;
}

function check(values, period) {
  if (!Number.isInteger(period) || period < 1 || values.some(v => !Number.isFinite(v)))
    throw new Error('指标输入无效');
}

export function sma(values, period) {
  check(values, period);
  let sum = 0;
  return values.map((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}

export function ema(values, period) {
  check(values, period);
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous += alpha * (values[i] - previous);
    result[i] = previous;
  }
  return result;
}

export function technicalIndicators(bars) {
  const close = bars.map(b => b.close), volume = bars.map(b => b.volume);
  const fast = ema(close, 12), slow = ema(close, 26);
  const dif = close.map((_, i) => slow[i] === null ? null : fast[i] - slow[i]);
  const first = dif.findIndex(value => value !== null);
  const dea = Array(close.length).fill(null);
  if (first >= 0) ema(dif.slice(first), 9).forEach((value, i) => { dea[first + i] = value; });
  // Explicit 2x histogram convention, often used in Chinese charting software.
  const histogram = dif.map((value, i) => dea[i] === null ? null : 2 * (value - dea[i]));
  return {ma5: sma(close, 5), ma10: sma(close, 10), ma20: sma(close, 20),
    volumeMa5: sma(volume, 5), volumeMa10: sma(volume, 10), dif, dea, histogram};
}

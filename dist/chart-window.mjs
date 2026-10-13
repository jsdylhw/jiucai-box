export const MIN_VISIBLE_BARS = 12;
export const MAX_VISIBLE_BARS = 70;

export function chartWindow(endIndex, requestedCount) {
  if (!Number.isInteger(endIndex) || endIndex < 0 || !Number.isFinite(requestedCount)) throw new Error('Invalid chart window');
  const maximum = Math.min(MAX_VISIBLE_BARS, endIndex + 1);
  const minimum = Math.min(MIN_VISIBLE_BARS, maximum);
  const count = Math.max(minimum, Math.min(maximum, Math.round(requestedCount)));
  return {start: endIndex - count + 1, end: endIndex + 1, count, minimum, maximum};
}

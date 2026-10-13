export const ANONYMOUS = 'ASSET';
export const WARMUP = 60;
export const GAME_DAYS = 60;

export function scenarioCatalog(source) {
  const catalog = [];
  for (const symbol of source.tradable) {
    const count = source.stocks[symbol].bars.length;
    for (let start = WARMUP - 1; start + GAME_DAYS < count; start++) catalog.push({symbol, start});
  }
  if (!catalog.length) throw new Error('行情不足：每局需要至少 60 根前置日线和 60 个后续交易日');
  return catalog;
}

export function randomScenario(source, previous = null, random = Math.random) {
  const count = scenarioCatalog(source).length;
  const exclude = Number.isInteger(previous) && previous >= 0 && previous < count && count > 1;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机数无效');
  let ticket = Math.floor(value * (count - (exclude ? 1 : 0)));
  if (exclude && ticket >= previous) ticket++;
  return ticket;
}

export function makeScenario(source, ticket) {
  const catalog = scenarioCatalog(source);
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= catalog.length) throw new Error('随机场景编号无效');
  const {symbol, start} = catalog[ticket];
  // Internal bar dates retain real calendar gaps for fees; UI and saves use relative days.
  // Only the alias is passed into the trading engine, logs, orders and save actions.
  return {id: `blind-v2:${source.id}:${ticket}`, startIndex: start, sessions: GAME_DAYS,
    tradable: [ANONYMOUS], benchmark: ANONYMOUS,
    stocks: {[ANONYMOUS]: {name: '匿名股票', bars: source.stocks[symbol].bars.slice(0, start + GAME_DAYS + 1)}}};
}

export function revealedStock(source, ticket, state) {
  if (!state || (state.day < GAME_DAYS && !state.bankrupt)) return null;
  const entry = scenarioCatalog(source)[ticket];
  if (!Number.isInteger(ticket) || !entry) throw new Error('随机场景编号无效');
  return {symbol: entry.symbol, name: source.stocks[entry.symbol].name || entry.symbol};
}

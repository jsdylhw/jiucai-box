export const DEFAULTS = Object.freeze({initial: 100000, fee: 0.001, slippage: 0.0005, borrow: 0.05, maintenance: 0.5});

export function validateConfig(config) {
  for (const [key, value] of Object.entries(config)) {
    if (!(key in DEFAULTS) || !Number.isFinite(value)) throw new Error('实验参数无效');
  }
  if (config.initial < 100 || config.initial > 1e9 || config.fee < 0 || config.fee > 0.05 ||
      config.slippage < 0 || config.slippage > 0.05 || config.borrow < 0 || config.borrow > 1 ||
      config.maintenance <= 0 || config.maintenance > 1) throw new Error('实验参数超出范围');
}

export function create(data, options = {}) {
  const config = {...DEFAULTS, ...options};
  validateConfig(config);
  const state = {dataId: data.id, config, day: 0, cash: config.initial,
    positions: Object.fromEntries(data.tradable.map(s => [s, 0])), fees: 0, borrowPaid: 0,
    dividends: 0, fills: [], actions: [], history: [], marginCall: false, bankrupt: false};
  record(data, state);
  return state;
}

export function bar(data, state, symbol, offset = 0) {
  return data.stocks[symbol].bars[data.startIndex + state.day + offset];
}

export function metrics(data, state, field = 'close') {
  let net = 0, gross = 0, short = 0;
  for (const symbol of data.tradable) {
    const value = state.positions[symbol] * bar(data, state, symbol)[field];
    net += value; gross += Math.abs(value); short += Math.max(0, -value);
  }
  return {equity: state.cash + net, net, gross, short,
    capacity: Math.max(0, state.cash + net - gross)};
}

export function weights(data, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('仓位格式无效');
  if (Object.keys(input).some(s => !data.tradable.includes(s))) throw new Error('未知股票');
  const result = Object.fromEntries(data.tradable.map(s => [s, input[s] ?? 0]));
  if (Object.values(result).some(w => !Number.isFinite(w) || Math.abs(w) > 1)) throw new Error('仓位须在 -100% 到 +100% 之间');
  if (Object.values(result).reduce((sum, w) => sum + Math.abs(w), 0) > 1 + 1e-10)
    throw new Error('多空仓位绝对值之和不能超过 100%');
  return result;
}

function fill(data, state, symbol, delta, reason) {
  if (!delta) return;
  const open = bar(data, state, symbol).open;
  const price = open * (1 + Math.sign(delta) * state.config.slippage);
  const fee = Math.abs(delta * price) * state.config.fee;
  state.cash -= delta * price + fee;
  state.positions[symbol] += delta;
  state.fees += fee;
  state.fills.push({day: state.day, date: bar(data, state, symbol).date, symbol, delta, price, fee, reason});
}

function record(data, state) {
  const m = metrics(data, state);
  const peak = Math.max(state.config.initial, m.equity, ...state.history.map(h => h.equity));
  state.history.push({day: state.day, date: bar(data, state, data.benchmark).date,
    equity: m.equity, gross: m.gross, drawdown: (peak - m.equity) / peak});
}

export function advance(data, previous, order = null) {
  if (previous.day >= data.sessions || previous.bankrupt) throw new Error('本局已结束');
  const target = order === null ? null : weights(data, order);
  const state = structuredClone(previous);
  const yesterday = bar(data, state, data.benchmark).date;
  const oldShort = metrics(data, state).short;
  state.day++;
  const today = bar(data, state, data.benchmark).date;
  const days = (Date.parse(today) - Date.parse(yesterday)) / 86400000;
  // Research approximation: ex-date dividend accrual, including compensation on shorts.
  for (const symbol of data.tradable) {
    const dividend = state.positions[symbol] * (bar(data, state, symbol).dividend || 0);
    state.cash += dividend; state.dividends += dividend;
  }
  const borrowFee = oldShort * state.config.borrow * days / 365;
  state.cash -= borrowFee; state.borrowPaid += borrowFee;
  const atOpen = metrics(data, state, 'open');
  const forced = state.marginCall || atOpen.equity <= 0 ||
    (atOpen.gross > 0 && atOpen.equity / atOpen.gross < state.config.maintenance);
  if (forced) {
    for (const symbol of data.tradable) fill(data, state, symbol, -state.positions[symbol], '风险平仓');
    state.marginCall = false;
  } else if (target) {
    // Reserve a conservative bound for closing existing and opening new exposure costs.
    // Target percentages are decided at T close; this precommitted rule sizes at T+1 open.
    const c = state.config.slippage + state.config.fee * (1 + state.config.slippage);
    const budget = Math.max(0, (atOpen.equity - atOpen.gross * c) / (1 + c));
    const desired = Object.fromEntries(data.tradable.map(symbol => [symbol,
      Math.trunc(target[symbol] * budget / bar(data, state, symbol).open)]));
    // Close/reduce first, then open/increase. Each symbol ends at its desired signed shares.
    for (const symbol of data.tradable) {
      const old = state.positions[symbol], next = desired[symbol];
      if (old && Math.sign(old) !== Math.sign(next)) fill(data, state, symbol, -old, '平仓');
      else if (Math.abs(next) < Math.abs(old)) fill(data, state, symbol, next - old, '减仓');
    }
    for (const symbol of data.tradable) fill(data, state, symbol, desired[symbol] - state.positions[symbol], '目标调仓');
  }
  const atClose = metrics(data, state);
  state.marginCall = atClose.gross > 0 && (atClose.equity <= 0 || atClose.equity / atClose.gross < state.config.maintenance);
  state.bankrupt = atClose.equity <= 0 && atClose.gross === 0;
  state.actions.push(target);
  record(data, state);
  return state;
}

export function save(state) {
  return {version: 1, dataId: state.dataId, config: state.config, actions: state.actions};
}

export function restore(data, input) {
  if (input?.version !== 1 || input.dataId !== data.id || !Array.isArray(input.actions) || input.actions.length > data.sessions)
    throw new Error('存档格式或行情版本不匹配');
  let state = create(data, input.config);
  for (const action of input.actions) state = advance(data, state, action);
  return state;
}

export function summary(data, state) {
  const m = metrics(data, state);
  return {days: state.day, finalEquity: m.equity, returnPct: (m.equity / state.config.initial - 1) * 100,
    maxDrawdownPct: Math.max(...state.history.map(h => h.drawdown)) * 100,
    commissions: state.fees, borrowFees: state.borrowPaid, netDividends: state.dividends,
    fills: state.fills.length, marginCall: state.marginCall, bankrupt: state.bankrupt};
}

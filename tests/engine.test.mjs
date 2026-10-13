import test from 'node:test';
import assert from 'node:assert/strict';
import {create, advance, metrics, restore, save, weights, summary} from '../dist/engine.mjs';

function fixture(prices, dividends = {}) {
  return {id: 'fixture', startIndex: 0, sessions: prices.length - 1, tradable: ['X', 'Y'], benchmark: 'X',
    stocks: Object.fromEntries(['X', 'Y'].map(s => [s, {bars: prices.map((p, i) => ({
      date: new Date(Date.UTC(2025, 0, 3 + i * 3)).toISOString().slice(0, 10),
      open: p, close: p, high: p, low: p, volume: 100000, dividend: dividends[i] || 0}))}]))};
}
const zero = {initial: 10000, fee: 0, slippage: 0, borrow: 0};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('next-open sizing and no same-day fills', () => {
  const d = fixture([100, 200, 220]);
  const s = create(d, zero);
  assert.equal(s.fills.length, 0);
  const next = advance(d, s, {X: 0.5});
  assert.equal(next.positions.X, 25);
  assert.equal(next.fills[0].price, 200);
  assert.equal(s.day, 0);
  near(metrics(d, advance(d, next)).equity, 10500);
});

test('short sale proceeds are liabilities, falling prices profit, rising prices lose', () => {
  for (const [price, expected] of [[80, 11000], [120, 9000]]) {
    const d = fixture([100, 100, price]);
    let s = advance(d, create(d, zero), {X: -0.5});
    assert.equal(s.cash, 15000);
    near(metrics(d, s).equity, 10000);
    near(metrics(d, s).capacity, 5000);
    s = advance(d, s);
    near(metrics(d, s).equity, expected);
  }
});

test('long and short dividend accounting uses overnight holdings', () => {
  const d = fixture([100, 100, 99], {2: 1});
  for (const side of [-1, 1]) {
    let s = advance(d, create(d, zero), {X: side});
    s = advance(d, s, {X: 0});
    near(s.dividends, side * 100);
    near(metrics(d, s).equity, 10000);
  }
});

test('borrow cost accrues over calendar days, including weekend', () => {
  const d = fixture([100, 100, 100]);
  let s = advance(d, create(d, {...zero, borrow: 0.365}), {X: -1});
  s = advance(d, s);
  near(s.borrowPaid, 30);
  near(metrics(d, s).equity, 9970);
});

test('gross exposure is capped even on short proceeds and fees', () => {
  const d = fixture([100, 100, 140, 70]);
  let s = create(d);
  for (const target of [{X: -0.5, Y: 0.5}, {X: 0.7, Y: -0.3}, {X: -1}]) {
    s = advance(d, s, target);
    const m = metrics(d, s, 'open');
    assert.ok(m.gross <= m.equity + 1e-7);
  }
  assert.throws(() => weights(d, {X: -0.6, Y: 0.6}));
  assert.throws(() => weights(d, {X: NaN}));
  assert.throws(() => weights(d, {Z: 0.2}));
});

test('margin breach at open forces liquidation and preserves negative equity', () => {
  const d = fixture([100, 100, 300]);
  let s = advance(d, create(d, zero), {X: -1});
  s = advance(d, s, {Y: 1});
  assert.equal(s.positions.X, 0);
  assert.equal(s.positions.Y, 0);
  assert.equal(s.cash, -10000);
  assert.equal(s.bankrupt, true);
  assert.equal(s.fills.at(-1).reason, '风险平仓');
});

test('no future-data dependency before next execution day', () => {
  const d = fixture([100, 110, 120, 130]);
  const modified = structuredClone(d);
  modified.stocks.X.bars[3].close = 9999;
  const a = advance(d, create(d, zero), {X: 0.5});
  const b = advance(modified, create(modified, zero), {X: 0.5});
  assert.deepEqual(a, b);
});

test('save replays actions, rejects wrong dataset, stops exactly at session limit', () => {
  const d = fixture([100, 110, 90]);
  let s = advance(d, create(d), {X: -0.25});
  s = advance(d, s);
  assert.deepEqual(restore(d, save(s)), s);
  assert.throws(() => restore(d, {...save(s), dataId: 'other'}));
  assert.throws(() => advance(d, s));
  assert.equal(summary(d, s).days, 2);
});

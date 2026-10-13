import fs from 'node:fs';
import {create, advance, summary} from '../dist/engine.mjs';
const data = JSON.parse(fs.readFileSync(new URL('../dist/data/us-2025.json', import.meta.url)));
const strategies = {'cash': {}, 'AAPL_long_50': {AAPL: 0.5}, 'AAPL_short_50': {AAPL: -0.5},
  'MSFT_long_50_TSLA_short_50': {MSFT: 0.5, TSLA: -0.5}};
const results = {};
for (const [name, target] of Object.entries(strategies)) {
  let state = create(data);
  state = advance(data, state, target);
  while (state.day < data.sessions && !state.bankrupt) state = advance(data, state);
  results[name] = summary(data, state);
}
const report = {dataId: data.id, policy: 'Set target once at first open, then hold; fixed experimental fees and borrow costs.', results};
fs.writeFileSync(new URL('../experiment-results.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

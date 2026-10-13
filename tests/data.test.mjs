import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scenarioCatalog} from '../dist/scenarios.mjs';

const path=new URL('../dist/data/us-2025.json',import.meta.url);
test('local sample contains 30 complete stocks, valid OHLCV, and 3930 full scenarios', {skip:!fs.existsSync(path)},()=>{
  const source=JSON.parse(fs.readFileSync(path,'utf8'));
  assert.equal(source.tradable.length,30);
  assert.equal(new Set(source.tradable).size,30);
  const dates=source.stocks[source.tradable[0]].bars.map(b=>b.date);
  assert.equal(dates.length,250);assert.equal(dates[0],'2025-01-02');assert.equal(dates.at(-1),'2025-12-31');
  assert.deepEqual(dates,[...new Set(dates)].sort());
  for(const symbol of source.tradable){
    const bars=source.stocks[symbol].bars;
    assert.deepEqual(bars.map(b=>b.date),dates);
    for(const b of bars){
      for(const field of ['open','high','low','close','volume','dividend'])assert.ok(Number.isFinite(b[field]),`${symbol} ${field}`);
      assert.ok(b.low>0&&b.low<=Math.min(b.open,b.close)&&Math.max(b.open,b.close)<=b.high);
      assert.ok(b.volume>=0&&b.dividend>=0);
    }
  }
  const catalog=scenarioCatalog(source);assert.equal(catalog.length,3930);
  for(const {symbol,start} of catalog)assert.ok(start>=59&&source.stocks[symbol].bars.length>start+60);
});

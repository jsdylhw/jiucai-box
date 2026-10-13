import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scenarioCatalog, randomScenario, makeScenario, ANONYMOUS} from '../dist/scenarios.mjs';
import {sma, ema, technicalIndicators} from '../dist/indicators.mjs';
import {create, advance, save, restore} from '../dist/engine.mjs';

const bars = Array.from({length: 125}, (_, i) => ({date: new Date(Date.UTC(2025, 0, i+1)).toISOString().slice(0,10),
  open: 100+i, high: 102+i, low: 99+i, close: 101+i, volume: 1000+i, dividend:0}));
const source = {id:'fixture', tradable:['SECRET_A','SECRET_B'], stocks:{
  SECRET_A:{name:'Hidden company', bars}, SECRET_B:{name:'Other hidden company', bars}}};
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);

test('every random scenario has 60 warmup bars and a complete 60-session challenge', () => {
  const catalog = scenarioCatalog(source);
  assert.equal(catalog.length, 12);
  for (let ticket=0;ticket<catalog.length;ticket++) {
    const data = makeScenario(source,ticket);
    assert.deepEqual(data.tradable,[ANONYMOUS]);
    assert.ok(data.startIndex>=59);
    assert.equal(data.stocks.ASSET.bars.length-data.startIndex-1,60);
    let state=create(data);
    for(let i=0;i<60;i++)state=advance(data,state);
    assert.equal(state.day,60);
    assert.throws(()=>advance(data,state));
  }
});

test('random selection reaches both ends and excludes only the exact preceding scenario', () => {
  const count=scenarioCatalog(source).length;
  assert.equal(randomScenario(source,null,()=>0),0);
  assert.equal(randomScenario(source,null,()=>.999999),count-1);
  for(let previous=0;previous<count;previous++) {
    const seen=new Set();
    for(let i=0;i<count-1;i++)seen.add(randomScenario(source,previous,()=>i/(count-1)));
    assert.equal(seen.size,count-1);assert.ok(!seen.has(previous));
  }
  assert.throws(()=>makeScenario(source,1.5));
  assert.throws(()=>makeScenario(source,count));
});

test('anonymous saves/logs and deterministic replay preserve the selected stock and date', () => {
  const data=makeScenario(source,8);
  let state=advance(data,create(data),{ASSET:-.5});
  state=advance(data,state);
  const snapshot=save(state), encoded=JSON.stringify(snapshot);
  assert.ok(!encoded.includes('SECRET_'));
  assert.ok(!encoded.includes('2025-'));
  assert.deepEqual(restore(makeScenario(source,8),snapshot),state);
  assert.equal(state.fills[0].symbol,ANONYMOUS);
  assert.throws(()=>restore(makeScenario(source,7),snapshot));
});

test('SMA and EMA warmup and seeding match hand calculations', () => {
  assert.deepEqual(sma([1,2,3,4,8],3),[null,null,2,3,5]);
  assert.deepEqual(ema([1,2,3,4,8],3),[null,null,2,3,5.5]);
  assert.deepEqual(ema([1,2],3),[null,null]);
});

test('MACD of a constant series is zero, linear series yields DIF=DEA=7', () => {
  for(const linear of [false,true]) {
    const input=Array.from({length:80},(_,i)=>({close:linear?100+i:100,volume:1000}));
    const result=technicalIndicators(input);
    assert.equal(result.dif[24],null);assert.equal(result.dea[32],null);
    for(let i=33;i<input.length;i++) {
      near(result.dif[i],linear?7:0);near(result.dea[i],linear?7:0);near(result.histogram[i],0);
      near(result.volumeMa5[i],1000);
    }
  }
});

test('MACD histogram uses 2x convention and no future bars affect current values', () => {
  const input=Array.from({length:100},(_,i)=>({close:100+Math.sin(i/5)*15,volume:1000+i}));
  const full=technicalIndicators(input), prefix=technicalIndicators(input.slice(0,65));
  for(const key of Object.keys(full)) assert.deepEqual(full[key].slice(0,65),prefix[key]);
  for(let i=33;i<100;i++)near(full.histogram[i],2*(full.dif[i]-full.dea[i]));
});

test('blind UI source does not include stock names, date selectors or named presets', () => {
  const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(html+app,/AAPL|MSFT|AMZN|TSLA|Apple|Microsoft|Amazon|Tesla/);
  assert.doesNotMatch(html,/id="symbol"|data-preset="pair"/);
});

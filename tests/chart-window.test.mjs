import test from 'node:test';
import assert from 'node:assert/strict';
import {chartWindow} from '../dist/chart-window.mjs';

test('zoom stays anchored to the latest revealed bar without exposing future bars',()=>{
  for(const end of [59,100,249])for(const count of [-10,12,20,35,50,70,500]){
    const view=chartWindow(end,count);
    assert.equal(view.end,end+1);
    assert.equal(view.end-view.start,view.count);
    assert.ok(view.start>=0&&view.count>=12&&view.count<=70);
  }
});
test('zoom limits and reset respect available history',()=>{
  assert.deepEqual(chartWindow(59,70),{start:0,end:60,count:60,minimum:12,maximum:60});
  assert.equal(chartWindow(119,5).start,108);
  assert.equal(chartWindow(119,70).start,50);
  assert.equal(chartWindow(119,24.6).count,25);
  assert.equal(chartWindow(4,12).count,5);
  assert.throws(()=>chartWindow(59,NaN));
});

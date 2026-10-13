import test from 'node:test';
import assert from 'node:assert/strict';
import {createHoldInspector} from '../dist/inspection.mjs';

function fixture() {
  const pending=new Map(),selected=[];let tick=0;
  const control=createHoldInspector({select:x=>selected.push(x),schedule:(fn,delay)=>{assert.equal(delay,350);pending.set(++tick,fn);return tick;},unschedule:id=>pending.delete(id)});
  return {control,selected,fire:()=>{for(const [id,fn] of pending){pending.delete(id);fn();}}};
}
test('hold selects after delay, dragging updates, and lifting keeps final selection',()=>{
  const {control,selected,fire}=fixture();
  control.start(20,30);assert.deepEqual(selected,[]);
  control.move(22,31);fire();assert.deepEqual(selected,[20]);
  assert.equal(control.move(50,40),true);assert.deepEqual(selected,[20,50]);
  assert.equal(control.end(),true);assert.equal(control.move(60,40),false);
  assert.deepEqual(selected,[20,50]);
});
test('quick taps and scrolling before hold do not select or block scrolling',()=>{
  for(const scrolling of [false,true]){
    const {control,selected,fire}=fixture();control.start(20,30);
    if(scrolling)assert.equal(control.move(20,60),false);
    else assert.equal(control.end(),false);
    fire();assert.deepEqual(selected,[]);assert.equal(control.end(),false);
  }
});
test('cancellation and a replacement gesture clear stale selection timers',()=>{
  const {control,selected,fire}=fixture();
  control.start(20,30);control.cancel();fire();assert.deepEqual(selected,[]);
  control.start(20,30);control.start(80,30);fire();assert.deepEqual(selected,[80]);
  control.cancel();assert.equal(control.move(100,30),false);
});

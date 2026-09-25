import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameCount,frameRange} from '../src/frame-range.js';
test('inclusive frame range maps to exact source times',()=>{
  assert.deepEqual(frameRange(25,48,3,24),{start:25,end:48,total:72,count:24,startTime:1,endTime:2,duration:1});
  assert.equal(frameRange(72,72,3,24).count,1);
  assert.ok(Math.abs(frameRange(72,72,3,24).duration-1/24)<1e-10);
});
test('invalid bounds are clamped, final partial frame is not extended',()=>{
  const range=frameRange(-10,9999,1.01,24);
  assert.equal(range.start,1);assert.equal(range.end,25);assert.equal(range.duration,1.01);
  assert.equal(frameRange(20,10,1,24).count,1);
  assert.equal(frameCount(1+1e-12,24),24);
});

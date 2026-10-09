import test from 'node:test';
import assert from 'node:assert/strict';
import { abFromInputs, holmAdjust } from '../src/analytics.mjs';
const input=content=>[{id:'manual',title:'用户数据',content,evidence:'test_data'}];
test('Welch summary and user-level metrics retain uncertainty and reject duplicate users',()=>{
  const result=abFromInputs(input('variant,users,mean,stddev\nA,20,10,2\nB,25,12,3'));
  assert.equal(result.metric,'continuous');assert.equal(result.difference,2);
  assert.ok(Math.abs(result.degreesOfFreedom-41.784011220196355)<1e-8);
  assert.ok(Math.abs(result.pValue-0.010686816561632895)<1e-9);
  assert.ok(Math.abs(result.differenceInterval[0]-0.48957462730259693)<1e-7);assert.ok(Math.abs(result.differenceInterval[1]-3.5104253726974033)<1e-7);
  const raw=abFromInputs(input('variant,user_id,value\nA,u1,8\nA,u2,10\nA,u3,12\nB,u4,9\nB,u5,12\nB,u6,15'));
  assert.equal(raw.rows[0].mean,10);assert.equal(raw.rows[0].stddev,2);
  assert.equal(raw.rows[1].mean,12);assert.equal(raw.rows[1].stddev,3);
  const summary=abFromInputs(input('variant,users,mean,stddev\nA,3,10,2\nB,3,12,3'));
  assert.ok(Math.abs(summary.pValue-raw.pValue)<1e-12);
  assert.throws(()=>abFromInputs(input('variant,user_id,value\nA,u1,1\nA,u2,2\nB,u1,3\nB,u3,4')),/唯一用户/);
  assert.throws(()=>abFromInputs(input('variant,users,mean,stddev\nA,2,10,-1\nB,2,12,3')),/非负/);
});
test('Holm adjusts planned comparisons including unavailable estimates, and constant metrics do not infer significance',()=>{
  const adjusted=holmAdjust([{pValue:0.01},{pValue:0.04},{pValue:0.03},{pValue:null}]);
  assert.deepEqual(adjusted.map(item=>item.adjustedPValue),[0.04,0.09,0.09,null]);
  const multi=abFromInputs(input('variant,users,conversions\nA,1000,100\nB,1000,140\nC,1000,105'));
  assert.equal(multi.comparisons.length,2);assert.ok(multi.comparisons[0].adjustedPValue>=multi.comparisons[0].pValue);assert.equal(multi.pValue,null);
  const constant=abFromInputs(input('variant,users,mean,stddev\nA,10,0,0\nB,10,1,0'));
  assert.equal(constant.pValue,null);assert.equal(constant.significant,null);assert.equal(constant.differenceInterval,null);assert.equal(constant.relativeLift,null);
});

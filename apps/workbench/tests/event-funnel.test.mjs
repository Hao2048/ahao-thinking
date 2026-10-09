import test from 'node:test';
import assert from 'node:assert/strict';
import {funnelFromInputs} from '../src/domain.mjs';
test('event funnel deduplicates users, requires order and full observation window',()=>{
  const content='user_id,timestamp,event\nu1,2026-10-01T10:00:00Z,view\nu1,2026-10-01T10:00:00Z,view\nu1,2026-10-01T11:00:00Z,create\nu1,2026-10-01T12:00:00Z,active\nu2,2026-10-01T10:00:00Z,view\nu2,2026-10-01T09:00:00Z,create\nu2,2026-10-01T12:00:00Z,active\nu3,2026-10-02T23:00:00Z,view';
  const inputs=[{id:'events',title:'原始行为',content,evidence:'test_data'}],options={steps:['view','create','active'],windowHours:24,observationEnd:'2026-10-03T00:00:00Z'};
  const result=funnelFromInputs(inputs,options);
  assert.deepEqual(result.rows.map(row=>row.users),[2,1,1]);assert.equal(result.definition.excludedImmatureUsers,1);assert.equal(result.rows[2].cumulativeRate,.5);
  assert.throws(()=>funnelFromInputs(inputs,{...options,steps:['view','view']}),/不同事件/);
  assert.throws(()=>funnelFromInputs(inputs,{...options,observationEnd:'2026-02-30T00:00:00Z'}),/不存在/);
});

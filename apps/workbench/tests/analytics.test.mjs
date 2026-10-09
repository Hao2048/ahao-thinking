import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, retentionFromInputs, abFromInputs } from '../src/analytics.mjs';
const input=content=>[{id:'fixture',title:'数据.csv',content,evidence:'test_data'}];
test('CSV handles quoted commas, embedded newline, escaped quotes and rejects inconsistent rows',()=>{
  assert.deepEqual(parseCSV('key,value\n"a,b","line1\nline2"\n"a""b",ok'),[['key','value'],['a,b','line1\nline2'],['a"b','ok']]);
  assert.throws(()=>parseCSV('a,b\n1'),/列数/);assert.throws(()=>parseCSV('a,b\n"open,2'),/闭合/);
});
test('retention excludes immature groups, distinguishes missing counts, weights denominators',()=>{
  const content='cohort,cohort_users,day,retained_users\n2026-10-01,100,1,60\n2026-10-01,100,7,30\n2026-10-07,80,1,40\n2026-10-07,80,7,20';
  const result=retentionFromInputs(input(content),{observationEnd:'2026-10-08'});
  assert.equal(result.summary[0].eligibleUsers,180);assert.equal(result.summary[0].rate,100/180);
  assert.equal(result.summary[1].eligibleUsers,100);assert.equal(result.summary[1].rate,.3);
  assert.equal(result.rows[1].values[1].mature,false);assert.equal(result.rows[1].values[1].rate,null);
  assert.equal(result.summary[2].rate,null);
  const missing=retentionFromInputs(input('cohort,cohort_users,day,retained_users\n2026-10-01,10,7,2'),{observationEnd:'2026-10-08'});
  assert.equal(missing.summary[0].missingCohorts,1);assert.equal(missing.summary[0].rate,null);
  assert.throws(()=>retentionFromInputs(input(content),{observationEnd:'2026-02-30'}),/不存在/);
  assert.throws(()=>retentionFromInputs(input(content+'\n2026-10-01,100,1,60'),{observationEnd:'2026-10-08'}),/重复/);
});
test('raw events deduplicate users, ignore earlier activity, count mature zero visits as zero',()=>{
  const result=retentionFromInputs(input('user_id,date,event\nu1,2026-10-01,signup\nu1,2026-10-01,signup\nu1,2026-10-02,active\nu1,2026-10-02,active\nu2,2026-10-01,signup\nu2,2026-09-30,active'),{observationEnd:'2026-10-08'});
  assert.equal(result.rows[0].users,2);assert.equal(result.summary[0].rate,.5);assert.equal(result.summary[1].rate,0);
});
test('AB numerical result matches independent standard-normal oracle and retains uncertainty',()=>{
  const result=abFromInputs(input('variant,users,conversions\nA,1000,100\nB,1000,140'));
  assert.ok(Math.abs(result.pValue-0.005915851074238088)<2e-7);
  assert.ok(Math.abs(result.difference-.04)<1e-12);assert.equal(result.significant,true);
  assert.ok(result.differenceInterval[0]>0&&result.differenceInterval[1]>.04);
  const reversed=abFromInputs(input('variant,users,conversions\nA,1000,100\nB,1000,140'),{control:'B'});
  assert.equal(reversed.difference,-result.difference);assert.equal(reversed.pValue,result.pValue);
});
test('AB small or zero samples avoid false significance and reject invalid counts',()=>{
  const result=abFromInputs(input('variant,users,conversions\nA,10,0\nB,10,1'));
  assert.equal(result.pValue,null);assert.equal(result.significant,null);assert.equal(result.relativeLift,null);
  assert.throws(()=>abFromInputs(input('variant,users,conversions\nA,10,11\nB,10,1')),/不超过/);
  assert.throws(()=>abFromInputs(input('variant,users,conversions\nA,10,1\nA,10,1')),/相同/);
});
test('manual, chat and inherited JSON data are computed without requiring a CSV filename',()=>{
  const rows=[{variant:'A',users:1000,conversions:100},{variant:'B',users:1000,conversions:140}];
  const chat=[{id:'chat',title:'对话确认的数据',kind:'chat',content:'```json\n'+JSON.stringify(rows)+'\n```',evidence:'ai_hypothesis'}];
  assert.equal(abFromInputs(chat).significant,true);assert.equal(abFromInputs(chat).evidence,'ai_hypothesis');
  assert.equal(abFromInputs([{...chat[0],content:JSON.stringify({computedAB:{rows}})}]).significant,true);
  const retained=retentionFromInputs([{...chat[0],content:JSON.stringify({observationEnd:'2026-10-08',rows:[{cohort:'2026-10-01',cohort_users:100,day:7,retained_users:30}]})}]);
  assert.equal(retained.summary[1].rate,.3);
  assert.equal(abFromInputs([{...chat[0],content:'variant,users,conversions\nA,1000,100\nB,1000,140'}]).significant,true);
});

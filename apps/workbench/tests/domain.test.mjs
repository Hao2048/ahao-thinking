import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModel, publicModel, funnelFromInputs, validateResult } from '../src/domain.mjs';
const csv = content => [{ id: 'input-1', title: 'data.csv', evidence: 'test_data', content }];
test('funnel uses supplied counts and preserves evidence', () => {
  const chart = funnelFromInputs(csv('step,users\n访问,1200\n创建,840\n喂养,660\n发布,180'));
  assert.equal(chart.evidence, 'test_data');
  assert.equal(chart.rows[1].stepRate, .7);
  assert.equal(chart.rows[3].cumulativeRate, .15);
  assert.equal(chart.rows[3].stepRate, 180/660);
});
test('funnel rejects increasing, fractional, duplicate and zero-base counts', () => {
  for (const content of ['step,users\na,2\nb,3','step,users\na,3\nb,1.2','step,users\na,3\na,1','step,users\na,0\nb,0']) assert.throws(() => funnelFromInputs(csv(content)));
  assert.equal(funnelFromInputs(csv('step,users\na,3\nb,0\nc,0')).rows[2].stepRate, null);
});
test('model public representation never contains secret',()=>{
  const model=validateModel({name:'内部模型',model:'test',api:'openai-completions',baseURL:'http://localhost:9999/v1',apiKey:'test-secret'});
  assert.equal(publicModel(model).configured,true);
  assert.equal('apiKey' in publicModel(model),false);
  assert.throws(()=>validateModel({...model,baseURL:'file:///tmp'}));
});
test('results require complete documents and structured data',()=>{
  assert.throws(()=>validateResult({summary:'test',structuredData:{},documents:[]}));
  const result=validateResult({summary:'test',structuredData:{facts:[]},documents:[{title:'PRD',format:'markdown',content:'# 文档'}]});
  assert.ok(result.documents[0].id);
  assert.deepEqual(result.charts,[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {documentSummary} from '../public/document-summary.mjs';
import {funnelFromInputs} from '../src/domain.mjs';
import {parseGeneration} from '../src/structured-generation.mjs';
import {publicAddress} from '../src/research.mjs';
test('summary includes funnel results even when conclusions are in a table',()=>{
 const doc={content:'# 漏斗测试报告\n## 核心指标与口径\n总付费转化率2.4%，测试目标5%，差距2.6个百分点。\n| 指标 | 数值 |\n|---|---|\n| 总付费转化率 | 2.4% |\n## 原因假设\n需要验证支付摩擦。\n## 证据局限\n人造数据。\n## 改进建议\n核对埋点。'};
 assert.match(documentSummary(doc),/2\.4%/);assert.match(documentSummary(doc),/5%/);
});
test('funnel reads explicitly headed CSV below explanatory text',()=>{
 const result=funnelFromInputs([{title:'材料',content:'人造数据，同一批用户。\nstep,users\n访问,1000\n注册,400\n互动,240\n付费,24\n\n仅测试，不代表真实用户。'}]);assert.ok(result,'must detect the CSV block');
});
test('provider authentication failures are not mistaken for JSON format errors',()=>{
 assert.throws(()=>parseGeneration({finalResponse:'',events:[{type:'turn/end',data:{reason:{kind:'error',error:{message:'HTTP 401 invalid API key sk-test-secret'}}}}]}), e=>e.code==='MODEL_AUTH' && !e.message.includes('sk-test-secret'));
});
test('IPv6 benchmark and documentation addresses stay blocked',()=>{
 for(const a of ['2001:2::70','2001:db8::1','2001:0db8::1','3fff::1','::ffff:c0a8:101'])assert.equal(publicAddress(a),false,a);
});

import {publicTarget} from '../src/research.mjs';
import {mermaidSource,normalizeDocumentDiagrams} from '../public/diagram-source.mjs';
import {validateChartEdits,replaceDocumentCharts,chartBlocks} from '../public/document-charts.mjs';
import {executeNode} from '../src/node-executors.mjs';
import {NodeRegistry} from '../src/node-registry.mjs';
import {resolve} from 'node:path';

test('dual-stack proxy DNS is resolved to pinned public addresses, never private targets',async()=>{
 let requests=0;const options={resolveAddresses:async()=>[{address:'198.18.0.37',family:4},{address:'2001:2::70',family:6}],resolveFetch:async url=>{requests++;assert.equal(url.hostname,'cloudflare-dns.com');return new Response(JSON.stringify({Answer:[{type:1,data:'93.184.215.14'}]}));}};
 const target=await publicTarget('https://example.com/report',options);assert.deepEqual(target.addresses,[{address:'93.184.215.14',family:4}]);assert.equal(requests,1);
 await assert.rejects(publicTarget('https://example.com/report',{...options,resolveFetch:async()=>new Response(JSON.stringify({Answer:[{type:1,data:'127.0.0.1'}]}))}),/未取得有效公网/);
 await assert.rejects(publicTarget('https://example.com/report',{...options,resolveAddresses:async()=>[{address:'10.0.0.1',family:4},{address:'198.18.0.3',family:4}]}),/本机/);assert.equal(requests,1);
 await assert.rejects(publicTarget('https://198.18.0.37/report',options),/本机/);
});
test('legacy Mermaid theme directives are safely ignored without enabling interaction',()=>{
 const raw='%%{init: {"theme":"base","securityLevel":"loose"}}%%\nflowchart TD\n A[进入设置页] --> B[保存]';
 assert.equal(mermaidSource(raw),'flowchart TD\n A[进入设置页] --> B[保存]');assert.doesNotMatch(normalizeDocumentDiagrams('```mermaid\n'+raw+'\n```'),/securityLevel|init:/);
 assert.throws(()=>mermaidSource('flowchart TD\n A --> B\nclick A "https://example.com"'),/不支持/);
});
test('preview then edit then save keeps the same editor objects and persists the change',()=>{
 const charts=[{schema:'pm-chart-v1',id:'c',type:'bar',title:'原题',evidenceStatus:'测试数据',sources:[{id:'s',title:'测试来源'}],data:[{name:'A',value:2,sourceIds:['s']}],encoding:{x:{field:'name',scale:'category',categories:['A'],label:'类别'},y:{field:'value',scale:'quantitative',label:'数值'}}}];
 const bound=charts[0];assert.equal(validateChartEdits(charts),charts);bound.title='预览后修改';bound.data[0].value=9;
 const saved=JSON.parse(chartBlocks(replaceDocumentCharts('# 报告',validateChartEdits(charts)))[0].source);assert.equal(saved.title,'预览后修改');assert.equal(saved.data[0].value,9);
});
test('statistics retain a durable checkpoint and useful document when AI fails',async()=>{
 const registry=new NodeRegistry(resolve('nodes'));await registry.scan();let checkpoint;
 const output=await executeNode({definition:registry.snapshot('analysis.funnel'),node:{config:{}},upstream:[{materials:[{id:'s',title:'test.csv',content:'step,users\n访问,1000\n付费,24',evidence:'test_data'}]}],registry,connection:{},runtime:{invoke:async()=>{throw Object.assign(new Error('模型认证失败'),{code:'MODEL_AUTH'});}},workspace:'/tmp',signal:new AbortController().signal,onProgress:()=>{},onCheckpoint:c=>{checkpoint=c;}});
 assert.equal(checkpoint.computed.rows[1].cumulativeRate,.024);assert.equal(output.computed.rows[1].users,24);assert.equal(output.interpretationStatus,'failed');assert.equal(output.quality.level,'partial');assert.match(output.documents[0].content,/2\.40%/);assert.match(output.documents[0].content,/AI解读未完成/);
});

import {inputCheck} from '../src/node-executors.mjs';
test('input checks repair format once but never retry authentication failure',async()=>{
 let count=0;const args={connection:{},prompt:'仅检查',workspace:'/tmp',validate:c=>typeof c.sufficient==='boolean'};
 const result=await inputCheck({...args,runtime:{invoke:async()=>({finalResponse:++count===1?'not JSON':'{"sufficient":true}'})}});assert.equal(result.sufficient,true);assert.equal(count,2);
 count=0;await assert.rejects(inputCheck({...args,runtime:{invoke:async()=>{count++;return{finalResponse:'',events:[{type:'turn/end',data:{reason:{kind:'error',message:'401 invalid api key'}}}]};}}}),e=>e.code==='MODEL_AUTH');assert.equal(count,1);
});

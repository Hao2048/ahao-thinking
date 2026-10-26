import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NodeRegistry} from '../src/node-registry.mjs';
import {executeNode} from '../src/node-executors.mjs';
import {generateDocuments} from '../src/structured-generation.mjs';
import {bindComputedFacts} from '../src/computed-facts.mjs';
import {collectMaterials,routeUpstream,currentOutput} from '../src/node-data.mjs';
import {FlowService} from '../src/flow-service.mjs';
import {Store} from '../src/store.mjs';
import {installBundledNodes} from '../desktop/node-installation.mjs';
import {WebResearch} from '../src/research.mjs';
import {startServer} from '../src/server.mjs';
const registry=new NodeRegistry(resolve('nodes'));await registry.scan();
const result=content=>({summary:'核心结论',structuredData:{},documents:[{title:'报告',format:'markdown',content}],openQuestions:[]});
const ctx={registry,connection:{id:'m'},workspace:'/tmp',signal:new AbortController().signal,onProgress:async()=>{}};
const funnel={type:'funnel',rows:[{step:'访问',users:1000,cumulativeRate:1},{step:'付费',users:24,cumulativeRate:.024}]};
test('unbound model numbers cannot publish a complete statistical document; canonical result survives',async()=>{
 const output=await executeNode({...ctx,definition:registry.snapshot('analysis.funnel'),node:{config:{outline:'# 漏斗\n## 结论'}},upstream:[{materials:[{title:'test.csv',content:'step,users\n访问,1000\n付费,24',evidence:'test_data'}]}],runtime:{invoke:async()=>({finalResponse:JSON.stringify(result('# 漏斗\n## 结论\n总转化率90%，付费900人。'))})}});
 assert.equal(output.computed.rows[1].cumulativeRate,.024);assert.equal(output.quality.level,'partial');assert.equal(output.interpretationStatus,'failed');assert.doesNotMatch(output.documents[0].content,/90%|900人/);assert.match(output.documents[0].content,/2\.40%/);
});
test('bound fact references resolve across body, summary and structured data without permitting altered numbers',()=>{
 const bound=bindComputedFacts({...result('# 结果\n转化率{{fact:rows.1.cumulativeRate|percent}}，付费{{fact:rows.1.users}}人。'),summary:'转化率{{fact:rows.1.cumulativeRate|percent}}',structuredData:{paid:'{{fact:rows.1.users}}'}},funnel);
 assert.match(bound.documents[0].content,/2\.4%/);assert.equal(bound.structuredData.paid,'24');assert.throws(()=>bindComputedFacts({...result('# 报告'),structuredData:{paid:900}},funnel),e=>e.code==='DOCUMENT_FACTS');assert.throws(()=>bindComputedFacts(result('# 报告\n{{fact:unknown}}'),funnel),/不存在/);assert.throws(()=>bindComputedFacts(result('# 报告\n{{fact:rows.1.cumulativeRate}}%'),funnel),/百分号/);
});
test('statistical success produces both bound interpretation and deterministic table/chart',async()=>{
 const output=await executeNode({...ctx,definition:registry.snapshot('analysis.funnel'),node:{config:{outline:'# 漏斗\n## 结论'}},upstream:[{materials:[{title:'test.csv',content:'step,users\n访问,1000\n付费,24',evidence:'test_data'}]}],runtime:{invoke:async()=>({finalResponse:JSON.stringify(result('# 漏斗\n## 结论\n付费人数{{fact:rows.1.users}}，转化率{{fact:rows.1.cumulativeRate|percent}}。'))})}});
 assert.equal(output.interpretationStatus,'completed');assert.equal(output.documents.length,2);assert.match(output.documents[0].content,/2\.4%/);assert.match(output.documents[1].content,/```chart/);
});
for(const mode of ['returned','thrown'])test('long document truncation enters bounded split recovery: '+mode,async()=>{
 let calls=0;const phases=[];
 const out=await generateDocuments({run:{outlineSnapshot:'# 报告\n## 甲\n## 乙',enforceOutline:true},prompt:'只做测试',onProgress:p=>phases.push(p.phase),invoke:async()=>{calls++;if(calls===1){if(mode==='thrown')throw Object.assign(new Error('truncated'),{code:'OUTPUT_TRUNCATED'});return{finalResponse:'部分内容',events:[{type:'turn/end',data:{reason:{kind:'max-tokens'}}}]};}return{finalResponse:JSON.stringify(result('# 报告\n## '+(calls===2?'甲':'乙')+'\n已有材料。'))};}});
 assert.equal(calls,3);assert.ok(phases.includes('splitting'));assert.match(out.result.documents[0].content,/## 甲/);assert.match(out.result.documents[0].content,/## 乙/);
});
test('structured-only analysis is usable by a report and preserves computed/partial evidence',async()=>{
 let saw=false;const upstream=[{kind:'analysis',analysis:{facts:[{content:'用户访谈痛点'}]},quality:{level:'partial',missing:['样本少']},materials:[],documents:[]}];
 assert.match(collectMaterials(upstream)[0].content,/用户访谈痛点/);
 const output=await executeNode({...ctx,definition:registry.snapshot('report.research'),node:{config:{outline:'# 报告\n## 结论'}},upstream,runtime:{invoke:async(_,p)=>{saw ||= p.includes('用户访谈痛点');return{finalResponse:JSON.stringify(p.includes('本轮只做报告输入检查')?{related:true,sufficient:true,missing:[],summary:'相关'}:result('# 报告\n## 结论\n整理访谈成果。'))};}}});
 assert.ok(saw);assert.equal(output.quality.level,'partial');assert.ok(output.quality.missing.includes('样本少'));
});
test('each edge selects its output packet and exposes its input port without cross-contamination',()=>{
 const graph={edges:[{from:'a',to:'b',output:'users',input:'evidence'},{from:'a',to:'b',output:'sales',input:'numbers'}]};
 const upstream=routeUpstream(graph,{a:{status:'succeeded',output:{ports:{users:{kind:'analysis',analysis:{topic:'users'}},sales:{kind:'dataset',computed:{total:5}}}}}},'b');
 assert.equal(upstream[0].inputPort,'evidence');assert.deepEqual(upstream[0].analysis,{topic:'users'});assert.equal(upstream[0].computed,undefined);assert.equal(upstream[1].inputPort,'numbers');assert.equal(upstream[1].computed.total,5);
});
test('node reset and changed ancestors remove old results from assistant prompts',async()=>{
 const graph={nodes:[{id:'input',type:'input.text',config:{content:'旧输入'}},{id:'user',type:'analysis.user',config:{}}],edges:[{from:'input',to:'user',input:'materials',output:'data'}]};
 const f={id:'f',graph,messages:[],nodeEpochs:{},runs:[{id:'r',graph:structuredClone(graph),nodes:{input:{status:'succeeded',definition:registry.snapshot('input.text'),output:{materials:[{title:'旧材料',content:'OLD-INPUT'}]}},user:{status:'succeeded',definition:registry.snapshot('analysis.user'),output:{summary:'OLD-RESULT'}}}}]};
 assert.ok(currentOutput(f,'user',registry));
 f.runs.push({id:'failed',graph:structuredClone(graph),nodes:{user:{status:'failed',definition:registry.snapshot('analysis.user')}}});assert.equal(currentOutput(f,'user',registry),null);f.runs.pop();
 f.graph.nodes[0].config.content='新输入';assert.equal(currentOutput(f,'user',registry),null);f.graph.nodes[0].config.content='旧输入';
 const state={projects:[{id:'p',workflows:[f]}],models:[{id:'m'}],settings:{activeModelId:'m'}};let prompt='';
 const flow=new FlowService({store:{directory:'/tmp',read:fn=>structuredClone(fn?fn(state):state),update:async change=>change(state)},registry,cleanError:e=>e.message,runtime:{invoke:async(_,p)=>{prompt=p;return{finalResponse:'{"reply":"新的上下文","question":null}'}}}});
 await flow.reset('p','f','user');await flow.chat('p','f','user',{message:'重新开始'});await Promise.all([...flow.jobs.values()].map(j=>j.promise));assert.doesNotMatch(prompt,/OLD-RESULT/);assert.match(prompt,/OLD-INPUT/); // explicitly connected current upstream is still valid
});
test('web collection cancellation reaches in-flight pages and prevents later batches',async()=>{
 const reader=new WebResearch();let started=0;
 reader.page=(_url,{signal})=>new Promise((resolve,reject)=>{started++;signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
 const controller=new AbortController();const pending=reader.collect({}, {urls:['https://example.org/a','https://example.org/b','https://example.org/c']},{signal:controller.signal});
 await new Promise(r=>setTimeout(r,5));controller.abort();await assert.rejects(pending);assert.equal(started,2);
});
async function temporary(t,prefix){const dir=await mkdtemp(join(tmpdir(),prefix));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('HTML conversion is deduplicated, cancellable, and does not overwrite after stop',async t=>{
 const dir=await temporary(t,'html-task-');const store=new Store(dir);await store.open();
 await store.update(s=>{s.models=[{id:'m'}];s.settings.activeModelId='m';s.projects=[{id:'p',workflows:[{id:'f',messages:[],graph:{nodes:[{id:'n',config:{}}]},runs:[{id:'r',status:'succeeded',nodes:{n:{definition:{},output:{documents:[{id:'doc',title:'报告',content:'# 报告'}]}}}}]}]}];});
 let calls=0;const flows=new FlowService({store,registry,cleanError:e=>e.message,runtime:{invoke:(_m,_p,_w,{signal})=>new Promise((_resolve,reject)=>{calls++;signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});})}});
 const body={runId:'r',documentId:'doc'},a=flows.presentation('p','f','n',body),b=flows.presentation('p','f','n',body);
 const outcomes=Promise.allSettled([a,b]);await flows.presentation('p','f','n',{documentId:'doc',action:'stop'});assert.equal(calls,1);assert.ok((await outcomes).every(o=>o.status==='rejected'));assert.equal(flows.jobs.size,0);assert.equal(store.read().projects[0].workflows[0].runs[0].nodes.n.output.documents[0].htmlPresentation,undefined);
});
test('node upgrades preserve the entire customized package and remove obsolete managed resources on clean upgrade',async t=>{
 const dir=await temporary(t,'package-upgrade-'),src=join(dir,'source'),dst=join(dir,'installed');await mkdir(join(src,'node'),{recursive:true});
 await writeFile(join(src,'node/node.json'),'definition v1');await writeFile(join(src,'node/instructions.md'),'rules v1');await writeFile(join(src,'node/obsolete.txt'),'old');await installBundledNodes(src,dst);
 await writeFile(join(dst,'node/node.json'),'custom definition');await writeFile(join(src,'node/node.json'),'definition v2');await writeFile(join(src,'node/instructions.md'),'rules v2');await rm(join(src,'node/obsolete.txt'));
 assert.deepEqual((await installBundledNodes(src,dst)).conflicts,['node/node.json']);assert.equal(await readFile(join(dst,'node/instructions.md'),'utf8'),'rules v1');assert.equal(await readFile(join(dst,'node/obsolete.txt'),'utf8'),'old');
 await writeFile(join(dst,'node/node.json'),'definition v1');await installBundledNodes(src,dst);assert.equal(await readFile(join(dst,'node/instructions.md'),'utf8'),'rules v2');await assert.rejects(readFile(join(dst,'node/obsolete.txt')),{code:'ENOENT'});
});
test('interrupted package swap restores the old complete package before checking conflicts',async t=>{
 const dir=await temporary(t,'package-recover-'),src=join(dir,'source'),dst=join(dir,'installed');await mkdir(join(src,'node'),{recursive:true});await writeFile(join(src,'node/node.json'),'v1');await installBundledNodes(src,dst);
 await rename(join(dst,'node'),join(dst,'.backup-test'));await mkdir(join(dst,'.stage-test'));await writeFile(join(dst,'_upgrade-journal.json'),JSON.stringify({name:'node',backup:'.backup-test',stage:'.stage-test'}));
 await installBundledNodes(src,dst);assert.equal(await readFile(join(dst,'node/node.json'),'utf8'),'v1');await assert.rejects(readFile(join(dst,'_upgrade-journal.json')),{code:'ENOENT'});
});
test('history is separately encoded, metadata writes do not re-encrypt old documents, and restart hydrates records',async t=>{
 const dir=await temporary(t,'run-records-');const encoded=[];const codec={encode:async raw=>{encoded.push(raw);return JSON.stringify({cipher:Buffer.from(raw).toString('base64')});},decode:async raw=>Buffer.from(JSON.parse(raw).cipher,'base64').toString()};
 const store=new Store(dir,codec);await store.open();await store.update(s=>s.projects.push({id:'p',workflows:[{id:'f',graph:{},messages:[],runs:[{id:'r',status:'succeeded',nodes:{n:{output:{documents:[{content:'PRIVATE-HISTORY '+ 'x'.repeat(100000)}]}}}}]}]}));
 const disk=await readFile(join(dir,'state.json'),'utf8');assert.doesNotMatch(disk,/PRIVATE-HISTORY/);const index=JSON.parse(await codec.decode(disk));assert.ok(index.projects[0].workflows[0].runs[0].storageRef);assert.ok(disk.length<3000);
 const before=encoded.length;await store.update(s=>s.settings.activeModelId='new');assert.equal(encoded.length-before,1);assert.ok(encoded.at(-1).length<3000);
 const loaded=new Store(dir,codec);await loaded.open();assert.match(loaded.read(s=>s.projects[0].workflows[0].runs[0].nodes.n.output.documents[0].content),/PRIVATE-HISTORY/);assert.equal((await readdir(join(dir,'run-records'))).length,1);
});
test('custom file fields persist separately and lightweight status excludes document history',async t=>{
 const dir=await temporary(t,'custom-file-'),nodeRoot=join(dir,'nodes');await mkdir(join(nodeRoot,'custom'),{recursive:true});
 const def={schemaVersion:1,id:'custom.files',name:'双文件输入',version:'1.0.0',category:'input',executor:'file',inputs:[],outputs:[{id:'data',types:['materials']}],fields:[{key:'briefFiles',type:'file',label:'需求材料'},{key:'studyFiles',type:'file',label:'研究材料'}]};await writeFile(join(nodeRoot,'custom/node.json'),JSON.stringify(def));
 const app=await startServer({port:0,dataDir:join(dir,'data'),nodeRoot,bridge:{invoke:()=>assert.fail(),close:async()=>{}}});t.after(()=>app.close());
 const call=async(path,body)=>{const r=await fetch(app.url+path,{method:body===undefined?'GET':'POST',headers:{'x-aipm-token':app.token},...body===undefined?{}:{body:JSON.stringify(body)}});assert.ok(r.ok,await r.clone().text());return r.json();};
 const p=await call('/api/projects',{name:'测试'}),f=await call(`/api/projects/${p.id}/flows`,{name:'测试'}),base=`/api/projects/${p.id}/flows/${f.id}`;
 await call(base,{revision:1,graph:{nodes:[{id:'n',type:def.id,x:0,y:0,config:{}}],edges:[]}});
 for(const fieldKey of ['briefFiles','studyFiles']){
  const parsed=await app.flows.parseUpload(p.id,f.id,'n',fieldKey+'.txt',Buffer.from('测试材料 '+fieldKey),false,fieldKey);
  await call(base+'/nodes/n/confirm-file',{draftId:parsed.draftId,content:parsed.content});
 }
 const graph=(await call(base)).graph;assert.equal(graph.nodes[0].config.briefFiles.length,1);assert.equal(graph.nodes[0].config.studyFiles.length,1);assert.equal(graph.nodes[0].config.files,undefined);
 const output=await executeNode({...ctx,definition:app.registry.snapshot(def.id),node:graph.nodes[0],upstream:[]});assert.equal(output.materials.length,2);
 await app.store.update(s=>s.projects[0].workflows[0].runs.push({id:'old',status:'succeeded',nodes:{n:{status:'succeeded',output:{documents:[{content:'HISTORY '+ 'a'.repeat(100000)}]}}}}));
 const status=await call(base+'/status');assert.ok(JSON.stringify(status).length<1500);assert.doesNotMatch(JSON.stringify(status),/HISTORY/);
});

test('v1 storage migrates with a byte-preserving backup and missing run records fail closed',async t=>{
 const dir=await temporary(t,'layout-migration-');const raw=JSON.stringify({schemaVersion:1,models:[],settings:{},projects:[{id:'p',workflows:[{id:'f',runs:[{id:'r',status:'succeeded',nodes:{}}]}]}]});await writeFile(join(dir,'state.json'),raw);
 const store=new Store(dir);await store.open();assert.equal(store.read().schemaVersion,2);
 const backups=await readdir(join(dir,'storage-layout-backups'));assert.equal(await readFile(join(dir,'storage-layout-backups',backups[0]),'utf8'),raw);
 const disk=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));await rm(join(dir,disk.projects[0].workflows[0].runs[0].storageRef));await assert.rejects(new Store(dir).open(),{code:'ENOENT'});
});
test('multi-output plugins validate and route separate packets through the real executor',async t=>{
 const dir=await temporary(t,'multi-output-');await mkdir(join(dir,'split'));const d={schemaVersion:1,id:'local.split',name:'分流',version:'1.0.0',category:'analysis',executor:'plugin',entry:'execute.mjs',inputs:[],outputs:[{id:'people',types:['analysis']},{id:'totals',types:['dataset']}],fields:[]};await writeFile(join(dir,'split/node.json'),JSON.stringify(d));await writeFile(join(dir,'split/execute.mjs'),'export function execute(){return {ports:{people:{kind:"analysis",analysis:{group:"独居青年"}},totals:{kind:"dataset",computed:{users:24}}}}}');
 const r=new NodeRegistry(dir);await r.scan();const out=await executeNode({...ctx,registry:r,definition:r.snapshot(d.id),node:{config:{}},upstream:[]});assert.equal(out.ports.people.analysis.group,'独居青年');assert.equal(out.ports.people.computed,undefined);assert.equal(out.ports.totals.computed.users,24);
});

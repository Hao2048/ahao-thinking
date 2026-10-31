import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{usesDownstream,downstreamTargets,intentSignature,searchPlanState,validateSearchPlan}from'../public/node-intent.mjs';
import{NodeRegistry}from'../src/node-registry.mjs';import{executeNode,NodeNeedsInput}from'../src/node-executors.mjs';import{startServer}from'../src/server.mjs';import{nodeFingerprint}from'../src/flow-graph.mjs';
const registry=new NodeRegistry(resolve('nodes'));await registry.scan();
const graph=()=>({nodes:[{id:'web',type:'input.web',x:0,y:0,config:{topic:'AI宠物陪伴'}},{id:'users',type:'analysis.user',name:'用户研究',x:300,y:0,config:{task:'查找独居上班族的陪伴场景和真实痛点'}},{id:'market',type:'analysis.market',x:300,y:300,config:{task:'核对市场规模与竞争格局'}}],edges:[{id:'u',from:'web',to:'users',output:'data',input:'materials'},{id:'m',from:'web',to:'market',output:'data',input:'materials'}]});
const targets=g=>downstreamTargets(g,'web',registry.catalog().nodes);
test('direction context follows explicit connections, task changes and disconnections, deduplicating multiple edges',()=>{
 const g=graph();g.edges.push({...g.edges[0],id:'duplicate'});const d=targets(g);assert.equal(d.length,2);const user=d.find(t=>t.id==='users');assert.equal(user.name,'用户研究');assert.match(user.task,/独居/);assert.ok(user.outline.includes('用户痛点'));assert.ok(user.requirements.length);assert.equal(user.ports.length,1);
 const key=intentSignature('AI宠物陪伴',d);g.nodes[1].config.task='研究儿童家庭';assert.notEqual(intentSignature('AI宠物陪伴',targets(g)),key);g.edges=g.edges.filter(e=>e.to!=='users');assert.deepEqual(targets(g).map(t=>t.id),['market']);
 assert.equal(usesDownstream({executor:'web'}),true);assert.equal(usesDownstream({executor:'plugin',contextPolicy:{downstream:true}}),true);assert.equal(usesDownstream({executor:'ai'}),false);
});
test('confirmed plans cover every downstream and stale plans detect changed topic, query, rules or links',()=>{
 const g=graph(),d=targets(g),queries=[{query:'AI宠物 用户痛点',targetIds:['users']},{query:'AI宠物 市场 竞品',targetIds:['market']}];
 const config={topic:'AI宠物陪伴',queries:queries.map(q=>q.query).join('\n'),searchPlan:{...validateSearchPlan({queries},d),contextSignature:intentSignature('AI宠物陪伴',d)}};
 assert.equal(searchPlanState(config,d),'current');assert.equal(searchPlanState({...config,topic:'其他主题'},d),'stale');assert.equal(searchPlanState({...config,queries:'别的词'},d),'stale');assert.equal(searchPlanState(config,[{...d[0],ruleHash:'new'},d[1]]),'stale');assert.equal(searchPlanState({queries:'手动词'},d),'manual');assert.equal(searchPlanState({...config,searchPlan:{}},d),'stale');
 assert.throws(()=>validateSearchPlan({queries:queries.slice(0,1)},d),/覆盖/);assert.throws(()=>validateSearchPlan({queries:[{query:'词',targetIds:['other']}]},d),/未连接/);assert.throws(()=>validateSearchPlan({queries:[{query:'词\n第二行',targetIds:['users','market']}]},d),/一行/);
});
test('changed downstream planning context changes opt-in node fingerprints',()=>{
 const g=graph(),d=targets(g),node=g.nodes[0],definition=registry.snapshot(node.type);const before=nodeFingerprint(node,definition,[],null,0,d);g.nodes[1].config.task='其他任务';assert.notEqual(nodeFingerprint(node,definition,[],null,0,targets(g)),before);
});
test('web execution blocks stale plans before external search; manual and confirmed modes preserve direction provenance',async()=>{
 const g=graph(),d=targets(g),node=g.nodes[0];node.config.queries='明确公开的检索词';let calls=0;
 const ctx={definition:registry.snapshot('input.web'),node,upstream:[],downstream:d,signal:new AbortController().signal,searchSettings:{},research:{collect:async(_s,plan)=>{calls++;assert.deepEqual(plan.queries,['明确公开的检索词']);return {sources:[{url:'https://example.org',title:'来源',content:'公开正文'}],failures:[]};}}};
 const manual=await executeNode(ctx);assert.equal(manual.searchIntent.mode,'manual');assert.equal(manual.searchIntent.targets.length,2);
 node.config.searchPlan={contextSignature:intentSignature(node.config.topic,d),queries:[{query:'明确公开的检索词',targetIds:['users','market']}]};
 const confirmed=await executeNode(ctx);assert.equal(confirmed.searchIntent.mode,'confirmed-plan');assert.equal(confirmed.materials[0].intendedFor.length,2);
 node.config.topic='改变主题';await assert.rejects(executeNode(ctx),e=>e instanceof NodeNeedsInput&&/重新确认/.test(e.message));assert.equal(calls,2);
});
async function fixture(t,invoke){const dir=await mkdtemp(join(tmpdir(),'direction-suite-'));const app=await startServer({port:0,dataDir:dir,bridge:{invoke,close:async()=>{}}});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});await app.store.update(s=>{s.models=[{id:'fixture'}];s.settings.activeModelId='fixture';s.projects=[{id:'p',workflows:[{id:'f',name:'研究',revision:1,graph:graph(),messages:[],runs:[],nodeEpochs:{}}]}];});return app;}
test('planning uses the downstream tasks without searching or writing node config; target-only execution still records downstream context',async t=>{
 let calls=0;const app=await fixture(t,async(_m,p)=>{calls++;assert.match(p,/独居上班族/);assert.match(p,/市场规模/);return {finalResponse:JSON.stringify({queries:[{query:'AI宠物 用户反馈',targetIds:['users']},{query:'AI宠物 市场报告',targetIds:['market']}]})};});
 app.flows.research={collect:async()=>({sources:[{url:'https://example.org',title:'来源',content:'正文'}],failures:[]})};
 const response=await fetch(app.url+'/api/projects/p/flows/f/nodes/web/search-plan',{method:'POST',headers:{'x-aipm-token':app.token,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.targets.length,2);assert.equal(plan.queries.length,2);assert.equal(calls,1);assert.equal(app.flows.flow('p','f').graph.nodes[0].config.queries,undefined,'preview cannot silently adopt searches');
 await app.store.update(s=>{const n=s.projects[0].workflows[0].graph.nodes[0];n.config.queries=plan.queries.map(q=>q.query).join('\n');n.config.searchPlan=plan;});
 const run=await app.flows.start('p','f',{targetNodeId:'web'});await app.flows.jobs.get(run.id).promise;
 const saved=app.flows.flow('p','f').runs.at(-1);assert.equal(saved.order.length,1);assert.equal(saved.nodes.web.downstream.length,2);assert.equal(saved.nodes.web.output.searchIntent.mode,'confirmed-plan');
});
test('a changed downstream during planning rejects the response and duplicate plan requests share one model call',async t=>{
 let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);let calls=0;
 const app=await fixture(t,async()=>{calls++;started();await pending;return {finalResponse:JSON.stringify({queries:[{query:'AI宠物 公开资料',targetIds:['users','market']}]})};});
 const a=app.flows.searchPlan('p','f','web',{});await ready;const b=app.flows.searchPlan('p','f','web',{});await app.store.update(s=>s.projects[0].workflows[0].graph.nodes[1].config.task='新目标');const outcomes=Promise.allSettled([a,b]);release();const results=await outcomes;assert.equal(calls,1);assert.ok(results.every(r=>r.status==='rejected'&&/变化/.test(r.reason.message)));
});
test('planning can be stopped and never publishes queries after cancellation',async t=>{
 let started;const ready=new Promise(r=>started=r);const app=await fixture(t,(_m,_p,_w,{signal})=>new Promise((_r,reject)=>{started();signal.addEventListener('abort',()=>reject(new Error('已停止')),{once:true});}));
 const job=app.flows.searchPlan('p','f','web',{});const rejected=assert.rejects(job,/已停止/);await ready;await app.flows.searchPlan('p','f','web',{action:'stop'});await rejected;assert.equal(app.flows.jobs.size,0);assert.equal(app.flows.flow('p','f').graph.nodes[0].config.searchPlan,undefined);
});

test('stale confirmed plans are rejected before starting a run, leaving configuration editable',async t=>{
 const app=await fixture(t,()=>assert.fail('preflight must not call the model'));
 await app.store.update(s=>{const f=s.projects[0].workflows[0],n=f.graph.nodes[0],d=downstreamTargets(f.graph,n.id,app.registry.catalog().nodes);n.config.queries='旧检索词';n.config.searchPlan={contextSignature:intentSignature(n.config.topic,d),queries:[{query:'旧检索词',targetIds:['users','market']}]};f.graph.nodes[1].config.task='已经改变的下游任务';});
 await assert.rejects(app.flows.start('p','f',{targetNodeId:'web'}),/工作方向已变化/);assert.equal(app.flows.flow('p','f').runs.length,0);
});
test('opt-in custom nodes receive downstream requirements at their execution seam',async()=>{
 const downstream=targets(graph());let seen;
 const definition={id:'custom.prepare',name:'材料准备',executor:'plugin',category:'analysis',contextPolicy:{downstream:true},fields:[],outputs:[{id:'data',types:['analysis']}]};
 await executeNode({definition,node:{config:{}},upstream:[],downstream,registry:{plugin:async()=>async context=>{seen=context.downstream;return {kind:'analysis',analysis:{prepared:true}};}},signal:new AbortController().signal});assert.equal(seen.length,2);assert.match(seen.find(t=>t.id==='users').task,/独居上班族/);
});

test('immediate cancellation during plan preparation prevents a model request',async t=>{
 const app=await fixture(t,()=>assert.fail('cancelled preparation must not invoke the model'));
 const pending=app.flows.searchPlan('p','f','web',{});const rejected=assert.rejects(pending);await app.flows.searchPlan('p','f','web',{action:'stop'});await rejected;assert.equal(app.flows.jobs.size,0);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{startServer}from'../src/server.mjs';import{normalizeGaps,confirmationsFor,confirmationScope}from'../src/data-gaps.mjs';
const n=(id,type,config={})=>({id,type,name:id,x:100,y:100,config});const edge=(from,to)=>({id:from+'-'+to,from,to,input:'materials',output:'data'});
const result={summary:'## 结论\n- 按材料整理',structuredData:{facts:[]},documents:[{title:'报告',format:'markdown',content:'# 报告\n## 核心结论\n依据材料整理，假设不作为事实。'}],openQuestions:[]};
async function fixture(t,invoke,research){const dir=await mkdtemp(join(tmpdir(),'gap-contract-')),app=await startServer({port:0,dataDir:dir,bridge:{invoke:async(_,p)=>({finalResponse:JSON.stringify(await invoke(p))}),async close(){}},researchBridge:research});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});await app.store.update(s=>{s.models.push({id:'m',api:'openai-completions',baseURL:'http://localhost:1/v1',model:'test',name:'隔离模型'});s.settings.activeModelId='m';s.projects.push({id:'p',name:'测试',workflows:[]})});const f=await app.flows.create('p','缺口测试');return{app,f,async save(nodes,edges){await app.flows.save('p',f.id,{revision:1,graph:{...f.graph,nodes:[{...f.graph.nodes[0],config:{content:'AI宠物陪伴研究，产品尚未上线'}},...nodes],edges}})},async run(){const r=await app.flows.start('p',f.id,{});await app.flows.jobs.get(r.id).promise;return app.flows.flow('p',f.id).runs.at(-1)},async resume(r,body){const ans=await app.flows.resume('p',f.id,r.id,{nodeId:r.currentNodeId,...body});await app.flows.jobs.get(r.id)?.promise;return app.flows.flow('p',f.id).runs.at(-1)}}}
test('gap taxonomy deduplicates and does not block optional or inapplicable items',()=>{const g=normalizeGaps({gaps:[{title:'留存',type:'not_applicable'},{title:'留存',type:'not_applicable'},{title:'补充公开定价',type:'public',required:false,query:'公开定价'}]});assert.equal(g.length,2);assert.ok(g.every(x=>!x.required));});
test('confirmations are scoped to connected descendants and invalidate after direction changes',()=>{const graph={nodes:[n('start','input.start',{content:'宠物'}),n('a','analysis.user'),n('b','report.research'),n('other','report.research')],edges:[edge('start','a'),edge('a','b')]};const flow={confirmations:[{nodeId:'a',scope:confirmationScope(graph,'a'),title:'平台',status:'confirmed',text:'桌面'}]};assert.equal(confirmationsFor(flow,graph,'b').length,1);assert.equal(confirmationsFor(flow,graph,'other').length,0);graph.nodes[0].config.content='教育';assert.equal(confirmationsFor(flow,graph,'b').length,0);});
test('decision pause precedes generation, persists answer, flows downstream and reuses it next run',async t=>{
 let generated=0;const fx=await fixture(t,p=>{if(p.includes('本轮只做'))return{related:true,sufficient:p.includes('桌面优先'),summary:'确认首发平台',gaps:p.includes('桌面优先')?[]:[{title:'首发平台',type:'decision',required:true,impact:'影响范围'}]};generated++;return result});
 await fx.save([n('a','analysis.user'),n('b','report.research',{outline:'# 报告\n## 核心结论'})],[edge('start','a'),edge('a','b')]);let r=await fx.run();assert.equal(r.status,'waiting_input');assert.equal(generated,0);const q=r.nodes.a.gapReview;
 await assert.rejects(fx.resume(r,{gapAction:'answer',reviewId:'stale',answers:[]}),/变化/);
 r=await fx.resume(r,{gapAction:'answer',reviewId:q.id,answers:[{id:q.gaps[0].id,status:'confirmed',text:'桌面优先'}]});assert.equal(r.status,'succeeded');assert.equal(r.nodes.b.output.confirmations[0].text,'桌面优先');assert.equal(fx.app.flows.flow('p',fx.f.id).confirmations.length,1);
 r=await fx.run();assert.equal(r.status,'succeeded');assert.equal(r.nodes.a.gapReview,undefined);
});
test('report pauses before filling missing sections; pending evidence stays partial instead of becoming fact',async t=>{
 let generated=0;const fx=await fixture(t,p=>{if(p.includes('本轮只做'))return{related:true,sufficient:false,summary:'没有真实留存',gaps:[{title:'真实留存',type:'evidence',required:true,impact:'不能推断留存率'}]};generated++;return result});
 await fx.save([n('b','report.research',{outline:'# 报告\n## 核心结论'})],[edge('start','b')]);let r=await fx.run();assert.equal(r.status,'waiting_input');assert.equal(generated,0);const q=r.nodes.b.gapReview;
 await assert.rejects(fx.resume(r,{gapAction:'search',reviewId:q.id,gapIds:[q.gaps[0].id],targetNodeId:'fake',queries:'真实留存'}),/已连接/);
 r=await fx.resume(r,{gapAction:'answer',reviewId:q.id,answers:[{id:q.gaps[0].id,status:'pending',text:'尚未上线，后续用行为数据验证'}]});assert.equal(r.status,'succeeded');assert.equal(r.nodes.b.output.quality.level,'partial');assert.match(r.nodes.b.output.quality.missing.join(' '),/尚未上线/);
});
test('public gap delegates to connected web executor, keeps earlier sources and reruns only affected descendants',async t=>{
 let searches=0;const research={async collect(_s,request){searches++;if(searches===2)assert.deepEqual(request.queries,['AI宠物 官方公开价格']);return{sources:[{url:'https://example.org/'+searches,title:'来源'+searches,content:searches===1?'原始来源':'已补齐公开价格'}],failures:[]}}};
 const fx=await fixture(t,p=>p.includes('本轮只做')?{related:true,sufficient:p.includes('已补齐公开价格'),summary:'缺少公开定价',gaps:p.includes('已补齐公开价格')?[]:[{title:'公开定价',type:'public',query:'AI宠物 官方公开价格',required:true}]}:result,research);
 await fx.save([n('web','input.web',{queries:'AI宠物',clarify:false}),n('a','analysis.user'),n('b','report.research',{outline:'# 报告\n## 核心结论'}),n('side','input.text',{content:'独立分支'})],[edge('start','web'),edge('web','a'),edge('a','b')]);let r=await fx.run();assert.equal(r.status,'waiting_input');const q=r.nodes.a.gapReview;assert.equal(q.searchTargets[0].id,'web');
 r=await fx.resume(r,{gapAction:'search',reviewId:q.id,targetNodeId:'web',gapIds:[q.gaps[0].id],queries:'AI宠物 官方公开价格'});assert.equal(r.status,'succeeded');assert.equal(searches,2);assert.equal(r.gapRepairCount,1);assert.equal(r.nodes.web.output.sources.length,2);assert.equal(r.nodes.web.outputVersions.length,1);assert.equal(r.nodes.b.status,'succeeded');
});
test('repair loop is bounded at two rounds and never adds a hidden search node',async t=>{
 let searches=0;const fx=await fixture(t,p=>p.includes('本轮只做')?{related:true,sufficient:false,summary:'公开资料仍不足',gaps:[{title:'公开案例',type:'public',query:'AI宠物 公开案例',required:true}]}:result,{async collect(){searches++;return{sources:[{url:'https://example.org/'+searches,title:'来源',content:'有限资料'}],failures:[]}}});
 await fx.save([n('web','input.web',{queries:'AI宠物',clarify:false}),n('a','analysis.user')],[edge('start','web'),edge('web','a')]);let r=await fx.run();
 for(let i=0;i<2;i++){const q=r.nodes.a.gapReview;r=await fx.resume(r,{gapAction:'search',reviewId:q.id,targetNodeId:'web',gapIds:[q.gaps[0].id],queries:'AI宠物 公开案例'});assert.equal(r.status,'waiting_input');}
 const q=r.nodes.a.gapReview;await assert.rejects(fx.resume(r,{gapAction:'search',reviewId:q.id,targetNodeId:'web',gapIds:[q.gaps[0].id],queries:'AI宠物 公开案例'}),/两次/);assert.equal(searches,3);assert.equal(r.graph.nodes.length,3);
 r=await fx.resume(r,{gapAction:'draft',reviewId:q.id});assert.equal(r.status,'succeeded');assert.equal(r.nodes.a.output.quality.level,'partial');
});
test('claiming evidence confirmed cannot bypass an unresolved evidence check; inapplicable requires an explicit reason',async t=>{
 const fx=await fixture(t,p=>p.includes('本轮只做')?{related:true,sufficient:false,summary:'样本仍不足',gaps:[{title:'真实样本',type:'evidence',required:true}]}:result);
 await fx.save([n('a','analysis.user')],[edge('start','a')]);let r=await fx.run(),q=r.nodes.a.gapReview;
 r=await fx.resume(r,{gapAction:'answer',reviewId:q.id,answers:[{id:q.gaps[0].id,status:'confirmed',text:'我认为已经足够'}]});assert.equal(r.status,'waiting_input');q=r.nodes.a.gapReview;
 await assert.rejects(fx.resume(r,{gapAction:'answer',reviewId:q.id,answers:[{id:q.gaps[0].id,status:'not_applicable',text:''}]}),/理由/);
 r=await fx.resume(r,{gapAction:'answer',reviewId:q.id,answers:[{id:q.gaps[0].id,status:'not_applicable',text:'本轮仅整理访谈计划，不输出规模或验证结论'}]});assert.equal(r.status,'succeeded');assert.equal(r.nodes.a.output.quality.level,'unassessed');
 await fx.app.flows.reset('p',fx.f.id,'a');assert.equal(fx.app.flows.flow('p',fx.f.id).confirmations.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { startServer } = await import(process.env.AIPM_TEST_SERVER_MODULE || '../src/server.mjs');
import { modules } from '../src/catalog.mjs';

test('all 12 modules use real Harness SDK and preserve handoff evidence, OCR provenance and deterministic metrics', {timeout:180000}, async()=>{
  const requests=[];let htmlCalls=0;
  const provider=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    const prompt=body.messages.map(message=>JSON.stringify(message.content)).join('\n');
    const rawPrompt=body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:Array.isArray(m.content)?m.content.filter(b=>b.type==='text').map(b=>b.text):[]).join('\n'),scope=JSON.parse(rawPrompt.match(/本轮文档任务（JSON）：([^\n]+)/)?.[1]||'null');
    const module=modules.find(module=>prompt.includes(`当前任务：${module.name}`));
    const isCheck=prompt.includes('本轮只检查'),isHtml=prompt.includes('用户已手动请求');if(isHtml)htmlCalls++;
    if(!module&&!isCheck&&!isHtml&&!prompt.includes('本轮仅准备调研计划')){res.writeHead(400);res.end();return;}
    if(module)requests.push({module:module.id,body});
    const answer=JSON.stringify(isCheck?{sufficient:true,summary:'测试材料充分',suggestions:[]}:isHtml?{html:'<!doctype html><html><body>离线交互原型</body></html>'}:!module?{questions:null,plan:{content:'# 调研计划\n市场、用户、机会；材料不足标为假设。',queries:['AI宠物陪伴 用户需求']}}:{summary:`${module.name}：测试供应商返回`,structuredData:{moduleId:module.id,evidence:'test_data',market:'待验证'},documents:module.id==='idea'?(scope?[scope.title]:['市场调研','用户画像','机会点与风险']).map(title=>({title,format:'markdown',content:'# '+title+'\n受限资料测试'})):[{title:module.name,format:'markdown',content:`# ${module.name}\n仅为连通性测试，市场事实待验证。`}],openQuestions:['需要真实模型验收']});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({id:'workflow',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'workflow',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const dir=await mkdtemp(join(tmpdir(),'aipm-complete-workflow-'));
  let app=await startServer({port:0,dataDir:dir});
  const call=async(path,body)=>{
    const response=await fetch(app.url+path,{method:body?'POST':'GET',headers:{'X-AIPM-Token':app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
  };
  try {
    await call('/api/models',{name:'测试连接',model:'workflow-model',api:'openai-completions',apiKey:'test-workflow-key',baseURL:`http://127.0.0.1:${provider.address().port}/v1`});
    const project=await call('/api/projects',{name:'完整项目回归（测试）'});
    const capability=(await call('/api/state')).capabilities.ocr;
    if(capability){
      const params=new URLSearchParams({filename:'访谈.png',projectId:project.id,moduleId:'idea'});
      const response=await fetch(`${app.url}/api/files/parse?${params}`,{method:'POST',headers:{'X-AIPM-Token':app.token},body:await readFile(new URL('./fixtures/ocr-sample.png',import.meta.url))});
      assert.equal(response.status,200);const draft=await response.json();
      await call(`/api/projects/${project.id}/inputs`,{moduleId:'idea',kind:'file',fileDraftId:draft.id,title:'OCR 访谈测试',content:draft.content,evidence:'test_data'});
    } else await call(`/api/projects/${project.id}/inputs`,{moduleId:'idea',kind:'manual',title:'测试想法',content:'电脑手机同步的 AI 宠物养成。',evidence:'test_data'});
    const prepared=await call(`/api/projects/${project.id}/research/prepare`,{mode:'idea',core:'AI宠物陪伴',depth:'standard'});
    const datasets={funnel:'step,users\n访问,1000\n创建,500\n使用,200',retention:'cohort,cohort_users,day,retained_users\n2026-10-01,100,1,60\n2026-10-01,100,7,30',ab:'variant,users,conversions\nA,1000,100\nB,1000,140'};
    for(let index=0;index<modules.length;index++){
      const module=modules[index];
      if(datasets[module.id])await call(`/api/projects/${project.id}/inputs`,{moduleId:module.id,kind:'manual',title:'手工测试数据',content:datasets[module.id],evidence:'test_data'});
      const check=await call(`/api/projects/${project.id}/assistant/${module.id}/preflight`,{});assert.equal(check.sufficient,true);
      const launched=await call(`/api/projects/${project.id}/work`,{preflightId:check.id,moduleId:module.id,...(module.id==='idea'?{planId:prepared.plan.id,confirmPlan:true,limitedResearch:true}:module.id==='initiation'?{entryContext:{productStage:'new'}}:{}),...(module.id==='retention'?{analyticsOptions:{observationEnd:'2026-10-09',days:[1,7]}}:{})});
      let run;
      const deadline=Date.now()+30000;
      do{run=(await call('/api/state')).projects[0].runs.find(run=>run.id===launched.runId);if(run.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
      assert.equal(run.status,'succeeded',run.error||module.id);
      assert.equal(run.skillSnapshot.name,module.skill);assert.equal(run.skillSnapshot.sha256.length,64);
      assert.equal(run.modelSnapshot.model,'workflow-model');assert.equal(run.result.structuredData.moduleId,module.id);
      assert.ok(run.result.documents.every(document=>document.format!=='html'));
      if(module.id==='prototype'){assert.equal(htmlCalls,0);const body={runId:run.id,documentId:run.result.documents[0].id};await call(`/api/projects/${project.id}/assistant/prototype/html`,body);await call(`/api/projects/${project.id}/assistant/prototype/html`,body);assert.equal(htmlCalls,1);}
      if(datasets[module.id]){assert.equal(run.result.charts[0].type,module.id);assert.ok(run.result.documents.some(document=>document.title==='指标计算明细与口径'));}
      if(index>0&&capability)assert.equal(run.inputSnapshot[0].source.fileReferences[0].method,'apple-vision-ocr');
      if(index+1<modules.length){
        const inherited=await call(`/api/projects/${project.id}/inherit`,{runId:run.id,artifactId:'data',targetModuleId:modules[index+1].id});
        assert.equal(inherited.source.moduleId,module.id);assert.equal(inherited.source.version,1);assert.equal(inherited.evidence,'ai_hypothesis');
        assert.ok(inherited.source.inputEvidence.some(input=>input.evidence=== (index===0?'test_data':'ai_hypothesis')));
      }
    }
    assert.deepEqual(requests.map(request=>request.module),modules.flatMap(module=>module.id==='idea'?['idea','idea','idea']:[module.id]));
    await app.close();app=await startServer({port:0,dataDir:dir});
    const restored=(await call('/api/state')).projects[0];
    assert.equal(restored.runs.length,modules.length);assert.ok(restored.runs.every(run=>run.status==='succeeded'));assert.equal(restored.runs.at(-1).moduleId,'review');
  }finally{await app.close();await new Promise(resolve=>provider.close(resolve));await rm(dir,{recursive:true,force:true});}
});

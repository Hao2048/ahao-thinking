import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';

const result = {summary:'测试报告',structuredData:{facts:['原数据']},documents:[{id:'doc-1',title:'测试文档',format:'markdown',content:'# 原数据'}],charts:[],openQuestions:[]};
test('project isolation, model selection, immutable handoff and failed-version retention',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aipm-test-'));
  let fail=false;const routes=[];
  const bridge={async generate(model,run){routes.push({model: model.model, inputs: run.inputSnapshot});if(fail)throw new Error(`模型失败 ${model.apiKey}`);return {result,sessionId:'session-real'};},async chat(){return{reply:'请确认',proposedInput:{title:'描述',content:'用户说的想法'}};},async close(){}};
  const app=await startServer({port:0,dataDir:dir,bridge});
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(app.url+path,{method,headers:{'X-AIPM-Token':app.token,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
    return{status:response.status,value:await response.json()};
  };
  const read=async()=> (await call('/api/state')).value;
  async function waitRun(id){for(let i=0;i<60;i++){const r=(await read()).projects[0].runs.find(r=>r.id===id);if(r?.status!=='running')return r;await new Promise(r=>setTimeout(r,10));}throw new Error('test timeout');}
  try{
    assert.equal((await fetch(app.url+'/api/state')).status,403);
    assert.equal((await fetch(app.url+'/api/projects',{method:'POST',headers:{Origin:'https://evil.test','X-AIPM-Token':app.token},body:'{}'})).status,403);
    const p=(await call('/api/projects',{name:'项目A'})).value;
    await call('/api/projects',{name:'项目B'});
    assert.equal((await call(`/api/projects/${p.id}/runs`,{moduleId:'mvp'})).status,400);
    const first=(await call('/api/models',{name:'模型A',model:'model-a',api:'openai-completions',baseURL:'http://localhost:1/v1',apiKey:'secret-one'})).value;
    const second=(await call('/api/models',{name:'模型B',model:'model-b',api:'openai-completions',baseURL:'http://localhost:1/v1',apiKey:'secret-two'})).value;
    assert.ok(!JSON.stringify(await read()).includes('secret-one'));
    await call(`/api/projects/${p.id}/inputs`,{moduleId:'mvp',title:'想法',kind:'manual',evidence:'user_statement',content:'AI宠物陪伴'});
    await call('/api/settings',{activeModelId:second.id});
    const r=(await call(`/api/projects/${p.id}/runs`,{moduleId:'mvp'})).value;
    const run=await waitRun(r.runId);assert.equal(run.status,'succeeded');assert.equal(routes[0].model,'model-b');
    assert.equal((await read()).projects[1].inputs.length,0);
    const inherited=(await call(`/api/projects/${p.id}/inherit`,{runId:run.id,artifactId:'doc-1',targetModuleId:'initiation'})).value;
    assert.equal(inherited.content,'# 原数据');assert.equal(inherited.source.version,1);
    fail=true;await call('/api/settings',{activeModelId:first.id});
    const failedId=(await call(`/api/projects/${p.id}/runs`,{moduleId:'mvp'})).value.runId;
    const failed=await waitRun(failedId);assert.equal(failed.status,'failed');assert.ok(!failed.error.includes('secret-one'));
    const state=await read();assert.equal(state.projects[0].runs[0].result.documents[0].content,'# 原数据');
    assert.equal(state.projects[0].inputs.find(i=>i.id===inherited.id).content,'# 原数据');
    const before=state.projects[0].inputs.length;
    const chat=await call(`/api/projects/${p.id}/chat`,{moduleId:'mvp',message:'想法补充'});
    assert.equal(chat.value.proposedInput.content,'用户说的想法');assert.equal((await read()).projects[0].inputs.length,before);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('running task freezes model/inputs, rejects duplicate and keeps later inputs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aipm-concurrent-'));let finish;let captured;
  const bridge={async generate(model,run){captured={model,run};await new Promise(resolve=>finish=resolve);return{result,sessionId:'session'};},async close(){finish?.();}};
  const app=await startServer({port:0,dataDir:dir,bridge});
  const call=async(path,body)=>{const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{'X-AIPM-Token':app.token,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{}});return{status:r.status,data:await r.json()};};
  try{
    const p=(await call('/api/projects',{name:'并发项目'})).data;
    const a=(await call('/api/models',{name:'A',model:'model-a',api:'openai-completions',baseURL:'http://localhost:1',apiKey:'secret-a'})).data;
    const b=(await call('/api/models',{name:'B',model:'model-b',api:'openai-completions',baseURL:'http://localhost:1',apiKey:'secret-b'})).data;
    const add=content=>call(`/api/projects/${p.id}/inputs`,{moduleId:'mvp',title:'材料',content,kind:'manual',evidence:'material'});
    await add('原材料');await call(`/api/projects/${p.id}/runs`,{moduleId:'mvp'});
    while(!captured)await new Promise(r=>setTimeout(r,5));
    assert.equal((await call(`/api/projects/${p.id}/runs`,{moduleId:'mvp'})).status,400);
    await call('/api/settings',{activeModelId:b.id});await add('运行中新材料');
    assert.equal(captured.model.id,a.id);assert.equal(captured.run.inputSnapshot.length,1);
    finish();
    for(let i=0;i<30;i++){const state=(await call('/api/state')).data;if(state.projects[0].runs[0].status==='succeeded')break;await new Promise(r=>setTimeout(r,5));}
    const state=(await call('/api/state')).data;assert.equal(state.projects[0].inputs.length,2);assert.equal(state.projects[0].runs[0].modelSnapshot.id,a.id);
    const edited=await call(`/api/models/${b.id}`,{name:'B更新',model:'model-b-new',api:'openai-completions',baseURL:'http://localhost:2',apiKey:'secret-b-replacement'});
    assert.equal(edited.data.configured,true);assert.equal(edited.data.id,b.id);assert.equal('apiKey' in edited.data,false);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

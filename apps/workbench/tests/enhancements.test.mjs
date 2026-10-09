import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
test('parsed and researched materials require confirmation, isolate projects and preserve citations and computed results',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aipm-enhanced-'));
  const bridge={async generate(){return{result:{summary:'fixture',structuredData:{},documents:[{id:'fixture',title:'报告',format:'markdown',content:'# fixture'}],charts:[],openQuestions:[]}};},async close(){}};
  const researchBridge={async collect(){return{sources:[{title:'官方资料',url:'https://example.org/report',content:'研究材料正文',retrievedAt:'2026-10-09T00:00:00Z',status:'page',sha256:'fixturehash'}],queries:['公开词'],failures:[],createdAt:'2026-10-09T00:00:00Z'};}};
  const app=await startServer({port:0,dataDir:dir,bridge,researchBridge});
  const call=async(path,body)=>{const response=await fetch(app.url+path,{method:body?'POST':'GET',headers:{'X-AIPM-Token':app.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};};
  const state=async()=>(await call('/api/state')).data;
  try{
    const project=(await call('/api/projects',{name:'A'})).data,other=(await call('/api/projects',{name:'B'})).data;
    await call('/api/search/settings',{provider:'tavily',apiKey:'research-secret'});assert.ok(!JSON.stringify(await state()).includes('research-secret'));
    const params=new URLSearchParams({filename:'data.csv',projectId:project.id,moduleId:'ab'});
    const response=await fetch(`${app.url}/api/files/parse?${params}`,{method:'POST',headers:{'X-AIPM-Token':app.token},body:'variant,users,conversions\nA,1000,100\nB,1000,140'});const draft=await response.json();assert.equal(response.status,200);
    assert.equal((await state()).projects[0].inputs.length,0);
    const material={fileDraftId:draft.id,moduleId:'ab',title:'data.csv',content:draft.content,evidence:'test_data',kind:'file'};
    assert.equal((await call(`/api/projects/${other.id}/inputs`,material)).status,400);
    assert.equal((await call(`/api/projects/${project.id}/inputs`,material)).data.fileSource.edited,false);
    await call('/api/models',{name:'模拟',model:'fixture',api:'openai-completions',apiKey:'fixture-key',baseURL:'http://127.0.0.1:1'});
    const runId=(await call(`/api/projects/${project.id}/runs`,{moduleId:'ab'})).data.runId;
    let run;for(let count=0;count<30;count++){run=(await state()).projects[0].runs.find(run=>run.id===runId);if(run.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(run.status,'succeeded');assert.equal(run.result.charts[0].type,'ab');assert.equal(run.result.structuredData.computedAB.significant,true);assert.ok(run.result.documents.some(doc=>doc.title==='指标计算明细与口径'));
    const webDraft=(await call(`/api/projects/${project.id}/research`,{moduleId:'idea',queries:['公开词']})).data;
    assert.equal((await state()).projects[0].inputs.length,1);
    assert.equal((await call(`/api/projects/${other.id}/research/${webDraft.id}`,{moduleId:'idea',selected:[0]})).status,400);
    const confirmed=(await call(`/api/projects/${project.id}/research/${webDraft.id}`,{moduleId:'idea',selected:[0]})).data;
    assert.equal(confirmed[0].webSource.url,'https://example.org/report');
    await call(`/api/projects/${project.id}/research/${webDraft.id}`,{moduleId:'idea',selected:[0]});assert.equal((await state()).projects[0].inputs.length,2);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

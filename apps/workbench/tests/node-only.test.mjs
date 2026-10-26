import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {startServer} from '../src/server.mjs';

test('retire module data once with original encrypted backup; retain workflows, settings and models',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'node-only-'));
 const codec={encode:async s=>JSON.stringify({payload:Buffer.from(s).toString('base64')}),decode:async s=>Buffer.from(JSON.parse(s).payload,'base64').toString()};
 try{
  const workflow={id:'f',graph:{nodes:[],edges:[]},runs:[{id:'r',status:'succeeded',nodes:{}}],messages:[{id:'m',content:'保留节点对话'}]};
  const original={schemaVersion:1,settings:{appearance:{theme:'light'},activeModelId:'model'},models:[{id:'model',apiKey:'secret-fixture'}],projects:[{id:'p',name:'保留项目',workflows:[workflow],inputs:[{content:'旧材料'}],messages:[],runs:[],researchWorkflow:{phase:'ready'},researchDrafts:[],moduleContexts:{}}]};
  const raw=await codec.encode(JSON.stringify(original));await writeFile(join(dir,'state.json'),raw);
  const store=new Store(dir,codec);await store.open();
  assert.deepEqual(store.read().projects,[{id:'p',name:'保留项目',workflows:[workflow]}]);assert.deepEqual(store.read().models,original.models);assert.deepEqual(store.read().settings,original.settings);
  const backups=await readdir(join(dir,'retired-module-backups'));assert.equal(backups.length,1);assert.equal(await readFile(join(dir,'retired-module-backups',backups[0]),'utf8'),raw);
  assert.ok(!(await readFile(join(dir,'state.json'),'utf8')).includes('secret-fixture'));
  await new Store(dir,codec).open();assert.equal((await readdir(join(dir,'retired-module-backups'))).length,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('only node UI and endpoints are exposed; old page, modules and scripts are gone',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'node-only-http-'));const app=await startServer({port:0,dataDir:dir,bridge:{async close(){}}});
 try{
  const call=(path,body)=>fetch(app.url+path,{method:body?'POST':'GET',headers:{'x-aipm-token':app.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  for(const path of ['/legacy.html','/app.mjs','/chat.mjs','/style.css','/api/projects/p/inputs','/api/projects/p/runs','/api/projects/p/chat','/api/projects/p/assistant/idea/outline'])assert.equal((await call(path)).status,404,path);
  const state=await (await call('/api/state')).json();assert.equal(state.stages,undefined);assert.equal(state.outlines,undefined);assert.ok(!(await(await fetch(app.url)).text()).includes('legacy'));
  const project=await(await call('/api/projects',{name:'节点项目'})).json();assert.deepEqual(project.workflows,[]);assert.equal(project.runs,undefined);
  assert.equal((await call('/api/nodes')).status,200);assert.equal((await fetch(app.url+'/api/state')).status,403);
 }finally{await app.close();await rm(dir,{recursive:true,force:true})}
});

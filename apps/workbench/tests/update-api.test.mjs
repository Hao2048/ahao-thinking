import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer} from '../src/server.mjs';
test('desktop install replies before applying shutdown and refuses a running task',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'aipm-update-api-'));let app,apply;
  try{
    app=await startServer({port:0,dataDir:dir,bridge:{async close(){}},updateBridge:async action=>{
      if(action==='apply'){apply=app.close();await apply;return{status:'installing'};}
      assert.equal(action,'install');return{status:'installing'};
    }});
    await app.store.update(state=>state.projects.push({id:'running',workflows:[{runs:[{status:'running'}]}]}));
    const install=()=>fetch(app.url+'/api/desktop/updates',{method:'POST',headers:{'Content-Type':'application/json','X-AIPM-Token':app.token},body:JSON.stringify({action:'install'}),signal:AbortSignal.timeout(3000)});
    let response=await install();assert.equal(response.status,400);assert.match((await response.json()).error,/任务正在运行/);assert.equal(apply,undefined);
    await app.store.update(state=>{state.projects[0].workflows[0].runs[0].status='succeeded';});
    response=await install();assert.equal(response.status,200);assert.equal((await response.json()).status,'installing');await apply;app=undefined;
  }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {providers} from '../src/providers.mjs';
import {validateModel,publicModel} from '../src/domain.mjs';
import {startServer} from '../src/server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('only provider and key resolve official defaults and permit advanced overrides',()=>{
  for(const preset of providers){const model=validateModel({provider:preset.id,apiKey:'fixture-key'});assert.equal(model.api,preset.api);assert.equal(model.baseURL,preset.baseURL);assert.equal(model.model,preset.model);assert.equal(model.name,preset.name);assert.equal(publicModel(model).apiKey,undefined);}
  assert.throws(()=>validateModel({provider:'unlisted',apiKey:'test'}));
  assert.throws(()=>validateModel({provider:'deepseek'}));
  const custom=validateModel({provider:'deepseek',apiKey:'test',model:'private',baseURL:'https://internal.example/v1',api:'openai-completions'});assert.equal(custom.model,'private');
});
test('editing does not carry a stored key to a different destination',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aipm-provider-')),app=await startServer({port:0,dataDir:dir,bridge:{async close(){}}});
 const call=async(path,body)=>{const response=await fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json','X-AIPM-Token':app.token},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};};
 try{const created=(await call('/api/models',{provider:'deepseek',apiKey:'original-key'})).value;
  assert.equal((await call('/api/models/'+created.id,{provider:'openai'})).status,400);
  assert.equal(app.store.read().models[0].apiKey,'original-key');
  assert.equal((await call('/api/models/'+created.id,{provider:'deepseek',model:'deepseek-flash'})).status,200);
  assert.equal(app.store.read().models[0].apiKey,'original-key');
  assert.equal((await call('/api/models/'+created.id,{provider:'openai',apiKey:'replacement-key'})).status,200);
  assert.equal(app.store.read().models[0].apiKey,'replacement-key');
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../src/server.mjs';

test('production HTTP routes serve the complete frontend module graph as JavaScript',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'ahao-assets-'));
 const host=await startServer({port:0,dataDir,bridge:{async close(){}}});
 try{
  const visited=new Set();
  async function visit(path){
   if(visited.has(path))return;visited.add(path);
   const response=await fetch(host.url+path);
   assert.equal(response.status,200,`frontend import unavailable: ${path}`);
   assert.match(response.headers.get('content-type'),/javascript/,`wrong module MIME: ${path}`);
   const source=await response.text();
   for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+\.mjs)['"]/g)){
    await visit(new URL(match[1],host.url+path).pathname);
   }
  }
  await visit('/node-app.mjs');
  assert.ok(visited.has('/document-toc.mjs'));
 }finally{await host.close();await rm(dataDir,{recursive:true,force:true});}
});

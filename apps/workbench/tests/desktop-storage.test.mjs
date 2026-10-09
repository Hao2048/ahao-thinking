import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLegacyData, createDesktopCodec } from '../desktop/storage.mjs';
import { Store } from '../src/store.mjs';

test('desktop import preserves original, skips existing store and copies session history',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aipm-migration-'));
  const source=join(root,'web'),destination=join(root,'desktop');
  const raw=JSON.stringify({schemaVersion:1,projects:[{id:'p',inputs:[],messages:[],runs:[]}],models:[],settings:{activeModelId:null}});
  try{
    await mkdir(join(source,'harness-home/sessions/s'),{recursive:true});await writeFile(join(source,'state.json'),raw);await writeFile(join(source,'harness-home/sessions/s/session.v4.jsonl'),'session fixture');
    const result=await importLegacyData(source,destination);assert.equal(result.projects,1);
    assert.equal(await readFile(join(source,'state.json'),'utf8'),raw);
    assert.equal(await readFile(join(destination,'harness-home/sessions/s/session.v4.jsonl'),'utf8'),'session fixture');
    await writeFile(join(source,'state.json'),'invalid');assert.equal((await importLegacyData(source,destination)).reason,'already-exists');
    assert.equal(await readFile(join(destination,'state.json'),'utf8'),raw);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('desktop store encodes through parent IPC and reloads without plaintext credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'aipm-codec-'));
  const channel=new EventEmitter();channel.connected=true;
  channel.send=(request,callback)=>{queueMicrotask(()=>{channel.emit('message',{type:'storage-result',id:request.id,value:request.operation==='encrypt'?Buffer.from(request.value).toString('base64'):Buffer.from(request.value,'base64').toString()});callback?.();});};
  try{
    const codec=createDesktopCodec(channel);const store=new Store(root,codec);await store.open();
    await store.update(state=>state.models.push({apiKey:'private-test-secret'}));
    const disk=await readFile(join(root,'state.json'),'utf8');assert.equal(JSON.parse(disk).storage,'macos-safe-storage');assert.ok(!disk.includes('private-test-secret'));
    const loaded=new Store(root,codec);await loaded.open();assert.equal(loaded.read().models[0].apiKey,'private-test-secret');
    assert.equal(await codec.decode('{"schemaVersion":1}'),'{"schemaVersion":1}');
    await assert.rejects(codec.decode('{"invalid":true}'));
  }finally{await rm(root,{recursive:true,force:true});}
});

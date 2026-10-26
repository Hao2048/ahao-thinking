import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopCodec } from '../desktop/storage.mjs';
import { Store } from '../src/store.mjs';

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

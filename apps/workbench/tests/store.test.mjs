import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';

test('restart preserves projects and marks interrupted tasks failed',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'aipm-restart-'));
  try{
    const first=new Store(directory);await first.open();
    await first.update(state=>{state.projects.push({id:'p',name:'保留项目',inputs:[{content:'原材料'}],messages:[],runs:[],workflows:[{id:'f',runs:[{id:'r',status:'running',nodes:{}}]}]});});
    const second=new Store(directory);await second.open();
    assert.equal(second.read().projects[0].inputs,undefined);
    assert.equal(second.read().projects[0].workflows[0].runs[0].status,'failed');
    assert.match(second.read().projects[0].workflows[0].runs[0].error,/中断/);
    assert.equal((await stat(join(directory,'state.json'))).mode & 0o777,0o600);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('serialized writes preserve both updates and a failed transaction does not poison the store',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'aipm-writes-'));
  try{
    const store=new Store(directory);await store.open();
    await Promise.all([store.update(state=>state.projects.push({id:'a',runs:[]})),store.update(state=>state.projects.push({id:'b',runs:[]}))]);
    assert.equal(store.read().projects.length,2);
    await assert.rejects(store.update(state=>{state.projects=[];throw new Error('refused');}));
    await store.update(state=>state.settings.activeModelId='after-failure');
    assert.equal(store.read().projects.length,2);assert.equal(store.read().settings.activeModelId,'after-failure');
  }finally{await rm(directory,{recursive:true,force:true});}
});

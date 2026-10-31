import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/node-app.mjs',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function setup({holdSave=false}={}){
 const listeners=new Map(),response=deferred(),requestStarted=deferred(),saveStarted=deferred(),saveReply=deferred();let saveCount=0;
 let persisted={id:'f',revision:1,name:'test',graph:{nodes:[{id:'a',x:10,y:20},{id:'b',x:400,y:20}],edges:[]},runs:[],messages:[]};
 const canvas={classList:{add(){},remove(){}},getBoundingClientRect:()=>({left:0,top:0})};
 const context=vm.createContext({structuredClone,setTimeout,clearTimeout,performance,console,Set,Date,Math,JSON,
 statuses:{},window:{addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)},
 $:s=>s==='#canvas'?canvas:{},icon:()=>'',paint(){},renderInspector(){},renderSurface(){},syncRunStatus(){},paintMessages(){},busy:()=>false,latest:()=>({}),
 api:async(path,body)=>{if(body){if(holdSave&&++saveCount===1){saveStarted.resolve(structuredClone(body));await saveReply.promise;}persisted={...persisted,graph:structuredClone(body.graph),revision:persisted.revision+1};return structuredClone(persisted);}if(path.endsWith('/status'))return {signature:'s',live:[]};requestStarted.resolve();return response.promise;},
 });
 vm.runInContext(`let flow=${JSON.stringify(persisted)},projectId='p',selected=new Set(['a']),view={x:0,y:0,k:1},dirty=false,saveTimer,saveChain=Promise.resolve(),editVersion=0,activeDrag=null,polling=false,statusSignature=null,lastPollAt=0,lastNodePointer=null,tab='config',page='canvas',questionSeen=new Set();\nconst apiPath=()=>'/flow';\n${section('function changed()', 'async function refreshState()')}\n${section('function drag(', 'async function upload(')}\n${section('async function poll(', 'window.addEventListener("keydown"')}`,context);
 return {context,response,requestStarted,saveStarted,saveReply,emit:(type,event={})=>{for(const f of [...listeners.get(type)||[]])f(event);},persisted:()=>persisted};
}
for(const arrival of ['during-drag','after-release','after-save'])test('late refresh cannot revert node position: '+arrival,async()=>{
 const h=setup(),c=h.context;
 const old=structuredClone(h.persisted());const pending=vm.runInContext('poll(true)',c);await h.requestStarted.promise;
 vm.runInContext('drag({clientX:0,clientY:0},"nodes")',c);h.emit('pointermove',{clientX:120,clientY:60});
 assert.equal(vm.runInContext('flow.graph.nodes[0].x',c),130);
 if(arrival!=='during-drag')h.emit('pointerup');
 if(arrival==='after-save')await vm.runInContext('flush()',c);
 h.response.resolve({...old,live:[]});await pending;
 if(arrival==='during-drag')h.emit('pointerup');
 await vm.runInContext('flush()',c);
 // A subsequent click must not repaint from the stale server snapshot.
 vm.runInContext('selected=new Set(["b"]);drag({clientX:400,clientY:20},"nodes")',c);h.emit('pointerup');
 assert.equal(vm.runInContext('flow.graph.nodes[0].x',c),130,'late refresh restored the pre-drag x coordinate');
 assert.equal(vm.runInContext('flow.graph.nodes[0].y',c),80,'late refresh restored the pre-drag y coordinate');
 assert.equal(h.persisted().graph.nodes[0].x,130,'the moved coordinate must be persisted');
 assert.equal(vm.runInContext('statusSignature',c),null,'discarding a response must not consume its status signature');
});
for(const event of ['pointercancel','blur'])test('interrupted drag finalizes coordinates and removes old gesture listeners: '+event,async()=>{
 const h=setup(),c=h.context;
 vm.runInContext('drag({clientX:0,clientY:0},"nodes")',c);h.emit('pointermove',{clientX:80,clientY:40});h.emit(event);
 assert.equal(vm.runInContext('activeDrag',c),null);await vm.runInContext('flush()',c);
 h.emit('pointermove',{clientX:300,clientY:300});h.emit('pointerup');
 assert.equal(h.persisted().graph.nodes[0].x,90);assert.equal(vm.runInContext('flow.graph.nodes[0].x',c),90);
});
test('a second drag while an earlier save is pending preserves and saves the latest coordinates',async()=>{
 const h=setup({holdSave:true}),c=h.context;
 vm.runInContext('drag({clientX:0,clientY:0},"nodes")',c);h.emit('pointermove',{clientX:50,clientY:20});h.emit('pointerup');
 const first=vm.runInContext('flush()',c);
 const oldSave=await h.saveStarted.promise;assert.equal(oldSave.graph.nodes[0].x,60);
 vm.runInContext('drag({clientX:0,clientY:0},"nodes")',c);h.emit('pointermove',{clientX:40,clientY:30});h.emit('pointerup');
 h.saveReply.resolve();await first;assert.equal(vm.runInContext('dirty',c),true);await vm.runInContext('flush()',c);
 assert.equal(h.persisted().graph.nodes[0].x,100);assert.equal(h.persisted().graph.nodes[0].y,70);
});

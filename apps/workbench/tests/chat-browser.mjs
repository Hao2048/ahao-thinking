import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.mjs';
const root=resolve(import.meta.dirname,'../../..'),{chromium}=createRequire(join(root,'deepseek-harness/apps/web/package.json'))('playwright');
const dir=await mkdtemp(join(tmpdir(),'chat-ui-'));let finish,hook,calls=0;
const bridge={async close(){finish?.();},async chat(model,module,inputs,message,history,workspace,options){calls++;hook=options;options.onText('第一段实时回复');await new Promise(resolve=>finish=resolve);return{reply:'第一段实时回复\n'+('后续内容\n'.repeat(100)),question:calls===1?{title:'确定陪伴场景',questions:[{prompt:'你希望先做哪一端？',options:['电脑','手机']}]}:null};}};
const app=await startServer({port:0,dataDir:dir,bridge});
const call=async(path,body)=>{const r=await fetch(app.url+path,{method:'POST',headers:{'X-AIPM-Token':app.token,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
const p=await call('/api/projects',{name:'对话验证'});await call('/api/models',{provider:'openai',apiKey:'fixture-only'});
await app.store.update(s=>{s.projects[0].messages=Array.from({length:30},(_,i)=>({id:`history-${i}`,role:i%2?'assistant':'user',moduleId:'idea',content:`历史消息${i}\n`+'材料\n'.repeat(5)}));});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 page.setDefaultTimeout(8000);console.log('navigate');await page.goto(app.url);const input=page.locator('#chat-message'),list=page.locator('#chat-list');
 await page.waitForFunction(()=>{const x=document.querySelector('#chat-list');return x&&x.scrollHeight-x.clientHeight-x.scrollTop<5;});
 console.log('send');await input.fill('我想做陪伴宠物');await input.press('Enter');await page.getByText('我想做陪伴宠物',{exact:true}).waitFor();await page.getByText('第一段实时回复',{exact:true}).waitFor();assert.equal(await input.inputValue(),'');assert.equal(app.store.read().projects[0].messages.at(-1).status,'streaming');
 await page.waitForFunction(()=>{const x=document.querySelector('#chat-list');return x.scrollHeight-x.clientHeight-x.scrollTop<5;});
 console.log('scroll');await list.hover();await page.mouse.wheel(0,-2000);await page.waitForFunction(()=>document.querySelector('#chat-list').scrollTop<document.querySelector('#chat-list').scrollHeight-document.querySelector('#chat-list').clientHeight-100);
 const top=await list.evaluate(x=>x.scrollTop);hook.onText('第一段实时回复\n'+('实时新内容\n'.repeat(80)));await page.getByRole('button',{name:'回到最新',exact:false}).waitFor();assert.ok(Math.abs(await list.evaluate(x=>x.scrollTop)-top)<5);
 await page.getByRole('button',{name:'回到最新',exact:false}).click();await page.waitForFunction(()=>{const x=document.querySelector('#chat-list');return x.scrollHeight-x.clientHeight-x.scrollTop<5;});
 console.log('question');finish();await page.locator('#chat-question-modal[open]').waitFor();await page.screenshot({path:join(root,'产品经理工作台/原型截图/chat-question-v120.png')});await page.getByRole('button',{name:'稍后回答'}).click();await page.getByRole('button',{name:'回答问题',exact:true}).click();await page.locator('#chat-question-modal input[value="0"]').check();await page.getByRole('button',{name:'发送回答',exact:true}).click();await page.getByRole('button',{name:'停止生成',exact:true}).waitFor();await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.getByRole('button',{name:'重新生成',exact:true}).waitFor();assert.equal(app.store.read().projects[0].messages.find(m=>m.question)?.questionState,'answered');
 console.log('retry');await page.getByRole('button',{name:'重新生成',exact:true}).click();await page.getByRole('button',{name:'停止生成',exact:true}).waitFor();finish();await page.waitForFunction(()=>!document.querySelector('#chat-send').disabled);
 await input.fill('草稿');await input.press('Shift+Enter');assert.equal(await input.inputValue(),'草稿\n');await page.getByRole('tab',{name:'总结分析',exact:true}).click();assert.equal(await input.inputValue(),'草稿\n');await page.screenshot({path:join(root,'产品经理工作台/原型截图/chat-stream-v120.png')});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS immediate send, live deltas, follow bottom, preserve history scroll, jump latest, questions, stop, retry, draft, mobile');
}finally{finish?.();await browser.close();await app.close();await rm(dir,{recursive:true,force:true});}

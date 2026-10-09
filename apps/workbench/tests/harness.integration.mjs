import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateModel } from '../src/domain.mjs';
import { HarnessBridge, skillSnapshot } from '../src/harness.mjs';

for(const suffix of ['/v1','/api/coding/paas/v4']) test(`real SDK sends model and key to ${suffix} and persists session`, {timeout:90000}, async()=>{
  const requests=[];
  const answer=JSON.stringify({summary:'模拟供应商返回的研究报告',structuredData:{market:'待验证'},documents:[{title:'研究报告',format:'markdown',content:'# 研究报告\n已有材料不足以验证市场接受度。'}],openQuestions:['用户访谈样本待补充']});
  const provider=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());requests.push({path:req.url,body,auth:req.headers.authorization});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'chatcmpl-test',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:10,total_tokens:22}})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const dataDir=await mkdtemp(join(tmpdir(),'aipm-harness-'));
  const bridge=new HarnessBridge(dataDir,{timeoutMs:45000});
  try{
    const model=suffix==='/v1'?{name:'本地测试供应商',model:'test-pm-model',api:'openai-completions',baseURL:`http://127.0.0.1:${provider.address().port}${suffix}`,apiKey:'test-not-real'}:validateModel({provider:'zhipu-coding',baseURL:`http://127.0.0.1:${provider.address().port}${suffix}`,apiKey:'test-not-real'});
    const run={moduleId:'idea',skillSnapshot:await skillSnapshot('idea'),inputSnapshot:[{title:'产品想法',content:'电脑手机同步宠物养成',evidence:'user_statement'}]};
    const output=await bridge.generate(model,run,dataDir);
    assert.equal(output.result.summary,'模拟供应商返回的研究报告');
    assert.equal(requests[0].body.model,model.model);assert.notEqual(requests[0].body.max_tokens,12000);assert.notEqual(requests[0].body.max_completion_tokens,12000);
    assert.equal(requests[0].path,`${suffix}/chat/completions`);
    assert.equal(requests[0].auth,'Bearer test-not-real');
    assert.ok(requests[0].body.messages.some(m=>JSON.stringify(m).includes('电脑手机同步宠物养成')));
    const sessions=await readdir(join(dataDir,'harness-home','sessions'),{recursive:true});
    assert.ok(sessions.some(name=>name.endsWith('.jsonl')));
    const sessionFile=sessions.find(name=>name.endsWith('.jsonl'));
    const log=await readFile(join(dataDir,'harness-home','sessions',sessionFile),'utf8');
    assert.ok(log.includes(model.model));
    assert.ok(log.includes('电脑手机同步宠物养成'));
  }finally{await bridge.close();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});}
});

for (const api of ['deepseek-messages', 'anthropic-messages']) test(`${api} route passes model and API-key header through Harness`, {timeout:90000}, async()=>{
  const requests=[];
  const provider=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));requests.push({path:req.url,body,key:req.headers['x-api-key']});
    const events=[{type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',content:[],stop_reason:null,stop_sequence:null,model:body.model,usage:{input_tokens:10,output_tokens:1}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'连接成功'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}},{type:'message_stop'}];
    res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const dir=await mkdtemp(join(tmpdir(),'aipm-native-'));const bridge=new HarnessBridge(dir,{timeoutMs:45000});
  try{
    const output=await bridge.invoke({name:'Native',model:'test-native-model',api,baseURL:`http://127.0.0.1:${provider.address().port}`,apiKey:'native-test-key'},'只回复连接成功',dir);
    assert.equal(output.finalResponse,'连接成功');assert.equal(new URL(requests[0].path,'http://localhost').pathname,'/v1/messages');assert.equal(requests[0].body.model,'test-native-model');assert.equal(requests[0].key,'native-test-key');
  }finally{await bridge.close();await new Promise(resolve=>provider.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('real Harness delivers escaped JSON reply before provider finishes',{timeout:30000},async()=>{
 let release,received;const seen=new Promise(r=>received=r);
 const provider=createServer(async(req,res)=>{for await(const chunk of req){}res.writeHead(200,{'Content-Type':'text/event-stream'});const delta=text=>`data: ${JSON.stringify({id:'stream-test',object:'chat.completion.chunk',model:'test',choices:[{index:0,delta:{content:text},finish_reason:null}]})}\n\n`;res.write(delta('{"reply":"你好\\n第一段'));await new Promise(r=>release=r);res.end(delta('第二段","question":null,"proposedInput":null}')+`data: ${JSON.stringify({id:'stream-test',object:'chat.completion.chunk',model:'test',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})}\n\ndata: [DONE]\n\n`);});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));const dir=await mkdtemp(join(tmpdir(),'real-chat-')),bridge=new HarnessBridge(dir,{timeoutMs:20000});
 try{let complete=false;const task=bridge.chat({name:'fixture',model:'test',api:'openai-completions',apiKey:'fixture-key',baseURL:`http://127.0.0.1:${provider.address().port}/v1`},'idea',[],'想法',[],dir,{onText:text=>{if(text==='你好\n第一段')received(text);}}).then(x=>{complete=true;return x;});assert.equal(await Promise.race([seen,task.then(()=>{throw new Error('No live delta');})]),'你好\n第一段');assert.equal(complete,false);release();assert.equal((await task).reply,'你好\n第一段第二段');}finally{release?.();await bridge.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true});}
});

test('real SDK recovers completed invalid JSON as Markdown and separately summarizes',{timeout:90000},async()=>{
 let count=0;const progress=[];const provider=createServer(async(req,res)=>{for await(const chunk of req){}const answer=++count===1?' {"summary":"未转义的"引号"","documents":[]}':count===2?'# 用户画像\n## 证据边界\n英文分类"9–60 岁"只是弱证据。\n```mermaid\ngraph LR\nA-->B\n```':'{"summary":"画像是假设，需要访谈。","structuredData":{"status":"hypothesis"},"openQuestions":[]}';res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'format-test',object:'chat.completion.chunk',model:'test',choices:[{index:0,delta:{content:answer},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'format-test',object:'chat.completion.chunk',model:'test',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));const dir=await mkdtemp(join(tmpdir(),'aipm-format-')),bridge=new HarnessBridge(dir);
 try{const output=await bridge.generate({name:'fixture',model:'test',api:'openai-completions',apiKey:'fixture-key',baseURL:`http://127.0.0.1:${provider.address().port}/v1`},{moduleId:'mvp',outlineSnapshot:'# 用户画像\n## 证据边界',skillSnapshot:await skillSnapshot('mvp'),inputSnapshot:[]},dir,{onProgress:p=>progress.push(p.phase)});assert.equal(count,3);assert.equal(output.result.summary,'画像是假设，需要访谈。');assert.ok(output.result.documents[0].content.endsWith('```'));assert.ok(output.result.documents[0].content.includes('"9–60 岁"'));assert.ok(progress.includes('recovering'));assert.ok(progress.includes('summarizing'));}finally{await bridge.close();provider.closeAllConnections();await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true});}
});

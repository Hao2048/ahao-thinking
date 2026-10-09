import {moduleContext,moduleBusy,defaultOutline} from './assistant-workspace.mjs';
import {randomUUID} from 'node:crypto';
import {getModule} from './catalog.mjs';
import {text,MAX_CONTEXT_BYTES} from './domain.mjs';
import {chatQuestion} from './chat-format.mjs';
const project=(state,id)=>{const value=state.projects.find(item=>item.id===id);if(!value)throw new Error('项目不存在');return value;};
export class ChatService{
 constructor(store,runtime,cleanError){this.store=store;this.runtime=runtime;this.cleanError=cleanError;this.jobs=new Map();this.closing=false;}
 message(projectId,id){const value=project(this.store.read(),projectId).messages.find(item=>item.id===id&&item.role==='assistant');if(!value)throw new Error('对话不存在');return this.jobs.get(id)?.message||value;}
 async start(projectId,body,connection,workspace){
  if(this.closing)throw new Error('服务正在关闭');getModule(body.moduleId);const content=text(body.message,'消息',12000);if(body.requestId)body.requestId=text(body.requestId,'请求编号',100);if(body.answerTo)body.answerTo=text(body.answerTo,'问题编号',100);
  const user={id:randomUUID(),requestId:body.requestId||null,moduleId:body.moduleId,role:'user',content,createdAt:new Date().toISOString()};
  const assistant={id:randomUUID(),moduleId:body.moduleId,role:'assistant',content:'',status:'streaming',replyTo:user.id,createdAt:user.createdAt,modelName:connection.name,modelId:connection.id};
  const defaults=await defaultOutline(body.moduleId);
  const snapshot=await this.store.update(state=>{
   const p=project(state,projectId);
   if(moduleBusy(p,body.moduleId))throw new Error('这段对话仍在生成，请先停止或等待完成');
   const input=p.inputs.filter(item=>item.moduleId===body.moduleId);if(Buffer.byteLength(JSON.stringify(input))>MAX_CONTEXT_BYTES)throw new Error('材料总量超过 2 MB');
   if(body.requestId&&p.messages.some(item=>item.requestId===body.requestId))throw new Error('消息已经提交，请刷新查看');
   const asked=body.answerTo?p.messages.find(item=>item.id===body.answerTo&&item.moduleId===body.moduleId&&item.status==='awaiting_input'):p.messages.findLast(item=>item.moduleId===body.moduleId&&item.status==='awaiting_input');
   if(body.answerTo&&!asked)throw new Error('这个问题已处理，请刷新对话');
   if(asked){asked.status='completed';asked.questionState=body.skipQuestion===true?'skipped':'answered';asked.answerMessageId=user.id;}
   const history=p.messages.filter(item=>item.moduleId===body.moduleId&&item.status!=='streaming').slice(-12);
   p.messages.push(user,assistant);return{inputs:input,history};
  });
  const job={projectId,message:assistant,controller:new AbortController(),listeners:new Set(),timer:null,task:null};this.jobs.set(assistant.id,job);
  const persist=async()=>{const value=structuredClone(job.message);await this.store.update(state=>Object.assign(project(state,projectId).messages.find(item=>item.id===assistant.id),value));};
  const broadcast=()=>{for(const response of job.listeners){if(response.writableLength>1024*1024){response.end();job.listeners.delete(response);}else response.write(`event: message\ndata: ${JSON.stringify(job.message)}\n\n`);}};
  job.task=(async()=>{
   try{
    const output=await Promise.race([
     this.runtime.chat(structuredClone(connection),body.moduleId,snapshot.inputs,content,snapshot.history,workspace,{signal:job.controller.signal,workspaceContext:{outline:moduleContext(project(this.store.read(),projectId),body.moduleId).outline||defaults.outline,recentResult:[...project(this.store.read(),projectId).runs].reverse().find(r=>r.moduleId===body.moduleId&&r.status==='succeeded'&&(r.contextEpoch||0)===(moduleContext(project(this.store.read(),projectId),body.moduleId).epoch||0))?.result||null},onText:value=>{
      if(job.controller.signal.aborted||job.message.status!=='streaming')return;
      if(typeof value!=='string'||value.length>20000)throw new Error('对话回复过长');
      if(job.message.content===value)return;job.message.content=value;broadcast();
      if(!job.timer)job.timer=setTimeout(()=>{job.timer=null;void persist().catch(()=>job.controller.abort());},250);
     }}),
     new Promise((_,reject)=>job.controller.signal.addEventListener('abort',()=>reject(new Error('已停止生成')),{once:true})),
    ]);
    if(job.controller.signal.aborted)throw new Error('已停止生成');
    if(typeof output.reply!=='string'||!output.reply.trim()||output.reply.length>20000)throw new Error('AI 没有返回有效答复');
    const question=chatQuestion(output.question);
    Object.assign(job.message,{content:output.reply,workAction:output.workAction||null,proposedInput:output.proposedInput||null,question,questionState:question?'pending':null,sessionId:output.sessionId,status:question?'awaiting_input':'completed'});
   }catch(error){Object.assign(job.message,{status:job.controller.signal.aborted?'stopped':'failed',error:job.controller.signal.aborted?'已停止生成':this.cleanError(error,{...this.store.read(),models:[...this.store.read().models,connection]})});}
   finally{
    clearTimeout(job.timer);job.message.completedAt=new Date().toISOString();
    try{await persist();}finally{broadcast();for(const response of job.listeners)response.end();job.listeners.clear();this.jobs.delete(assistant.id);}
   }
   return structuredClone(job.message);
  })();job.task.catch(()=>{});
  return{user,assistant:structuredClone(assistant),task:job.task};
 }
 stream(projectId,id,response){
  const value=this.message(projectId,id),job=this.jobs.get(id);
  response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});response.flushHeaders();
  if(job)job.listeners.add(response);response.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`);
  if(!job){response.end();return;}
  const heartbeat=setInterval(()=>response.write(': keepalive\n\n'),15000);
  response.on('close',()=>{clearInterval(heartbeat);job.listeners.delete(response);});
 }
 stop(projectId,id){this.message(projectId,id);this.jobs.get(id)?.controller.abort();return{ok:true};}
 async close(){this.closing=true;const jobs=[...this.jobs.values()];for(const job of jobs)job.controller.abort();await Promise.allSettled(jobs.map(job=>job.task));}
}

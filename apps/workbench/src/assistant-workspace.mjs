import {randomUUID,createHash} from 'node:crypto';
import {getModule,modules} from './catalog.mjs';
import {skillSnapshot,skillInstruction} from './harness.mjs';
import {text,parseModelJson,MAX_CONTEXT_BYTES} from './domain.mjs';
const plain=s=>s.replace(/[*`]/g,'').replace(/<[^>]+>/g,'').trim();
const section=(source,title)=>source.split(new RegExp(`^## ${title}\\s*$`,'m'))[1]?.split(/^## /m)[0]||'';
export async function defaultOutline(moduleId){
 const module=getModule(moduleId),snapshot=await skillSnapshot(moduleId);let documents=[];
 if(module.skill==='research')documents=['市场调研','用户画像','产品机会点与风险'].map(title=>{const s=section(snapshot.content,title),lines=s.split('\n').filter(l=>/^\d+\. \*\*|^- /.test(l)).map(l=>plain(l.replace(/^\d+\. |^- /,'')));return{title,headings:lines};});
 else if(module.skill==='initiation')documents=[{title:module.name,headings:[...snapshot.content.matchAll(/^## ([一二三四五六七八]、.+)$/gm)].map(m=>m[1])}];
 else{
  let headings=[];
  if(moduleId==='prd'){headings=['项目信息','版本记录','需求背景','需求目标','需求概述','业务流程图','交互流程图','详细方案','数据埋点','时序图'].filter(h=>snapshot.content.includes(h));}
  else if(['funnel','retention','ab','review'].includes(moduleId))headings=[...snapshot.content.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map(m=>m[1].replace(/：$/,''));
  else if(moduleId==='acceptance')headings=[...snapshot.content.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map(m=>m[1]);
  else {
   const workflow=snapshot.content.split('--- assets/workflows/')[1]||snapshot.content;
   const requirements={mvp:['问题/背景','目标','用户与场景','现有方案','业务规则','材料','参考/方向'],prototype:['页面状态','设计规范','原型交互增强','原型完成后一致性自查'],flow:['业务流程','规范与视觉风格','交互流程图','时序图','交付前必须逐项核对'],tracking:['埋点名','埋点中文名','埋点类型','埋点参数','参数值','统计口径','字典']}[moduleId]||[];
   headings=requirements.filter(h=>workflow.includes(h));
   if(moduleId==='mvp')headings.push('核心闭环与本期范围','优先级与验证指标');
  }
  headings=[...new Set(headings)].filter(h=>!h.startsWith('UI ')).slice(0,12);if(!headings.length)headings=[module.deliverables];documents=[{title:module.name,headings}];
 }
 return{moduleId,skill:snapshot.name,skillHash:snapshot.sha256,sourceFiles:snapshot.files,outlineBasis:['mvp','prototype','flow','tracking'].includes(moduleId)?'由当前 Skill 对应章节与模块交付要求整理（Skill 未指定独立固定大纲）':'当前 Skill 默认输出结构',outline:documents.map(d=>`# ${d.title}\n${d.headings.map(h=>'## '+h).join('\n')}`).join('\n\n')};
}
let blueprints;
export async function outlineCatalog(){blueprints??=Promise.all(modules.map(m=>defaultOutline(m.id)));return await blueprints;}
export function workMessage(p,moduleId,content,extra={}){const message={id:randomUUID(),moduleId,role:'assistant',status:'completed',content,createdAt:new Date().toISOString(),...extra};p.messages??=[];p.messages.push(message);return message;}
export function inputMessage(p,input){workMessage(p,input.moduleId,`已接收「${input.title}」${{artifact:'（来自上游模块）',file:'（上传文档）',web:'（联网来源）'}[input.kind]||''}。这份材料已进入当前模块上下文，将与本模块大纲一起分析。`,{workKind:'input',inputId:input.id});}
export function moduleContext(p,moduleId){return p.moduleContexts?.[moduleId]||{epoch:0};}
export function moduleBusy(p,moduleId){return p.runs.some(r=>r.moduleId===moduleId&&r.status==='running')||(p.messages||[]).some(m=>m.moduleId===moduleId&&['streaming','working'].includes(m.status))||moduleId==='idea'&&p.researchWorkflow?.phase==='preparing';}
export function userContext(p,moduleId){return (p.messages||[]).filter(m=>m.moduleId===moduleId&&m.role==='user').slice(-20).map(m=>({id:m.id,content:m.content,evidence:'user_statement'}));}
export function workDigest(p,moduleId,outline){return createHash('sha256').update(JSON.stringify({epoch:moduleContext(p,moduleId).epoch,inputs:p.inputs.filter(i=>i.moduleId===moduleId),outline,conversation:userContext(p,moduleId)})).digest('hex');}
export async function preflight({project,moduleId,outline,connection,runtime,workspace,taskContext}){
 const snapshot=await skillSnapshot(moduleId),inputs=project.inputs.filter(i=>i.moduleId===moduleId);
 if(Buffer.byteLength(JSON.stringify(inputs))>MAX_CONTEXT_BYTES)throw new Error('材料超过 2 MB，请缩小范围');
 const output=await runtime.invoke(connection,`${skillInstruction(moduleId,snapshot)}\n当前模块：${getModule(moduleId).name}。本轮只检查开始当前模块工作所需的数据是否充分，不生成报告、不联网、不默认生成 HTML。按当前模块大纲与 Skill 评估，只有想法或假设时应指出缺少事实证据；列出具体、可补充的资料。只返回 JSON {"sufficient":true 或 false,"summary":"简洁易懂的判断","suggestions":["建议补充资料"]}，最多6项建议。\n当前大纲（用户可修改，优先采用）：${outline}\n本轮任务选择：${JSON.stringify(taskContext||{})}\n用户在当前模块对话中直接陈述的信息（属于用户陈述，不能当作客观调研证据）：${JSON.stringify(userContext(project,moduleId))}\n已确认材料：${JSON.stringify(inputs)}`,workspace);
 const value=parseModelJson(output.finalResponse);if(typeof value.sufficient!=='boolean'||!Array.isArray(value.suggestions)||value.suggestions.some(s=>typeof s!=='string'))throw new Error('数据检查未返回有效判断，请重试');
 return{id:randomUUID(),moduleId,digest:workDigest(project,moduleId,outline),sufficient:(inputs.length>0||userContext(project,moduleId).length>0)&&value.sufficient,summary:text(value.summary,'检查说明',2000),suggestions:inputs.length||userContext(project,moduleId).length?value.suggestions.slice(0,6):['补充产品想法、研究目标或至少一份相关材料',...value.suggestions.slice(0,5)],createdAt:new Date().toISOString()};
}
export function authorizeWork(p,moduleId,outline,body){
 if(!body.preflightId)return; // Legacy API clients are preserved; the assistant UI always checks.
 const check=moduleContext(p,moduleId).preflight;
 if(!check||check.id!==body.preflightId||check.digest!==workDigest(p,moduleId,outline))throw new Error('材料或大纲已变化，请让助手重新检查');
 if(!check.sufficient&&body.ignoreInsufficient!==true)throw new Error('资料不足，请返回补充或明确选择忽略并运行');
}

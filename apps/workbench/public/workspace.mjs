import {escapeHtml as esc} from './document-view.mjs';
export function createWorkspace({context,api,dialog,modal,refresh,toast,clearChat,started}){
 const drafts=new Map();let checking=false;
 const key=c=>`${c.project?.id}/${c.moduleId}/${c.project?.moduleContexts?.[c.moduleId]?.epoch||0}`;
 function outline(c=context()){return drafts.get(key(c))??c.project?.moduleContexts?.[c.moduleId]?.outline??c.blueprint?.outline??'';}
 function saveDraft(value){drafts.set(key(context()),value);}
 async function saveOutline(){const c=context(),value=outline(c);if(!c.project)throw new Error('请先新建项目');if(!value.trim())throw new Error('请保留至少一个文档章节');const persisted=c.project.moduleContexts?.[c.moduleId]?.outline??c.blueprint?.outline;if(value!==persisted){await api(`/api/projects/${c.project.id}/assistant/${c.moduleId}/outline`,{outline:value});await refresh();toast('大纲已保存，助手将按此生成');}}
 async function submit(body){if(checking)throw new Error('助手正在检查材料');checking=true;const c=context(),base=`/api/projects/${c.project.id}`;
  try{await saveOutline();toast('助手正在检查材料是否充分…');const check=await api(`${base}/assistant/${c.moduleId}/preflight`,body);await refresh();const enqueue=async ignore=>{await api(`${base}/work`,{...body,moduleId:c.moduleId,preflightId:check.id,ignoreInsufficient:ignore});modal.close();started(c);await refresh();if(context().project?.id===c.project.id&&context().moduleId===c.moduleId)document.querySelector('#result-display')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});toast('助手已开始工作，结果会同步展示');return true;};
   if(check.sufficient)return await enqueue(false);
   dialog('助手提示：数据尚不充分',`<p>${esc(check.summary)}</p><h3>建议补充</h3><ul>${check.suggestions.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><p class="muted">仍然运行时，未知信息会标为待定义或假设，不会编造数据。</p><div class="tools"><button id="return-materials">返回补充数据</button><button class="primary" id="ignore-materials">忽略并运行模块</button></div><p id="gap-error" class="danger" role="alert"></p>`);
   modal.querySelector('#return-materials').onclick=()=>{modal.close();document.querySelector('#data-collection')?.scrollIntoView({block:'start'});};modal.querySelector('#ignore-materials').onclick=async e=>{e.target.disabled=true;try{await enqueue(true);}catch(error){modal.querySelector('#gap-error').textContent=error.message;e.target.disabled=false;}};return false;
  }finally{checking=false;}
 }
 function reset(){const c=context();if(!c.project)throw new Error('请先新建项目');dialog('清空当前模块上下文',`<p>清除当前模块的全部对话和已采集材料。自定义大纲、已生成的文档和历史版本保留。</p><p class="muted">重新开始时，旧结果只供查看，不自动进入新上下文；需要时可以手动承接。</p><button class="danger" id="reset-module-confirm">确认清空当前模块</button><p id="reset-error" role="alert" class="danger"></p>`);modal.querySelector('#reset-module-confirm').onclick=async e=>{e.target.disabled=true;try{await api(`/api/projects/${c.project.id}/assistant/${c.moduleId}/reset`,{});clearChat(c.project.id,c.moduleId);drafts.delete(key(c));modal.close();await refresh();toast('已清空当前模块上下文，历史结果已保留');}catch(error){modal.querySelector('#reset-error').textContent=error.message;e.target.disabled=false;}};}
 async function html(run,doc){if(!run||!doc)throw new Error('请先选择已完成的文档');const c=context();await api(`/api/projects/${c.project.id}/assistant/${c.moduleId}/html`,{runId:run.id,documentId:doc.id});await refresh();toast('HTML 展示已生成');}
 return{outline,saveDraft,saveOutline,submit,reset,html};
}

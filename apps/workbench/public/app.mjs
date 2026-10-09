import {documentSummary} from './document-summary.mjs';
import {hydrateVisuals} from './visuals.mjs';
import {captureReading,bindReading} from './reading-layout.mjs';
import {createWorkspace} from './workspace.mjs';
import {documentMarkup,frameMarkup,renderMarkdown} from './document-view.mjs';
import {entryMarkup,createWorkflow} from './workflow.mjs';
import {createChat} from './chat.mjs';
import { modelFormMarkup, bindModelForm } from './models.mjs';
import { updatesMarkup, bindUpdates } from './updates.mjs';
import { enhancedInputDialog, needsFunnelOptions, funnelRunDialog, researchDialog, searchFormMarkup, bindSearchForm, analyticsRunDialog, chartMarkup, provenanceMarkup } from './enhancements.mjs';
const token = document.querySelector('meta[name="aipm-token"]').content;
const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
let state;
const ui = { projectId: localStorage.getItem('aipm.project'), moduleId: localStorage.getItem('aipm.module') || 'idea', stageId: 'research', tab: 'documents', docId:null, settings: false, editingModelId: null, chatDraft: '', chatBusy: false, runId: null };
const evidenceNames = { material: '用户材料', user_statement: '用户陈述', test_data: '测试数据', ai_hypothesis: 'AI 生成 / 待验证' };
const kindNames = { manual: '手动输入', file: '上传文件', chat: '对话确认', artifact: '前序产物', web: '联网材料' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const percent = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function project() { return state.projects.find(item => item.id === ui.projectId); }
function moduleInfo() { return state.stages.flatMap(stage => stage.modules).find(module => module.id === ui.moduleId); }
function stageInfo() { return state.stages.find(stage => stage.modules.some(module => module.id === ui.moduleId)); }
function inputs() { return project()?.inputs.filter(input => input.moduleId === ui.moduleId) || []; }
function runs() { return project()?.runs.filter(run => run.moduleId === ui.moduleId) || []; }
function selectedRun() { return runs().find(run => run.id === ui.runId) || [...runs()].reverse().find(run => run.status === 'succeeded'); }
function activeModel() { return state.models.find(model => model.id === state.settings.activeModelId); }
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(path, { method, headers: { 'X-AIPM-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.style.display = 'none', 5000); }
async function refresh(renderPage = true) {
  state = await api('/api/state');
  chat.merge({project:project()});
  if (!project()) ui.projectId = state.projects[0]?.id;
  if (!moduleInfo()) ui.moduleId = 'idea';
  localStorage.setItem('aipm.project', ui.projectId || '');
  if (renderPage) render();
}
function setModule(id) { ui.moduleId = id; ui.runId = null; ui.settings = false; ui.chatDraft = ''; localStorage.setItem('aipm.module', id); render(); }
function sidebar() {
  return `<aside class="sidebar"><div class="brand" aria-label="好浩的产品工作台"><img class="brand-logo" src="/brand-logo.svg" alt="好浩工作台标志"><span class="brand-wordmark"><small>好浩的</small><strong>产品工作台</strong></span></div><div class="project-picker"><span class="muted small">当前项目</span><select id="project-select" aria-label="当前项目">${state.projects.length ? state.projects.map(p => `<option value="${p.id}" ${p.id === ui.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('') : '<option>尚未创建项目</option>'}</select></div><nav aria-label="产品工作流程">${state.stages.map((stage,index) => `<div><button class="stage ${!ui.settings && stage.id === stageInfo().id ? 'active' : ''}" data-module="${stage.modules[0].id}"><span class="number">${index+1}</span><span>${esc(stage.name)}</span></button>${!ui.settings && stage.id === stageInfo().id ? `<div class="submodule">${stage.modules.map(m => `<button class="${m.id === ui.moduleId ? 'selected' : ''}" data-module="${m.id}">${esc(m.name)}</button>`).join('')}</div>` : ''}</div>`).join('')}</nav><div class="sidebar-footer"><button class="link" data-action="new-project">＋ 新建项目</button><button class="link" data-action="all-documents">全部文档</button><button class="link" data-action="settings">模型设置</button><div class="footer-note">基于 DeepSeek Harness<br>本地个人工作台 · v1.4.7</div></div></aside>`;
}
function inputPanel() {
  const list = inputs(),isResearch=stageInfo().skill==='research';
  return `<section class="panel" id="data-collection"><div class="panel-head"><h3>数据采集 <span class="muted small">${list.length} 项已加入</span></h3><div class="tools">${isResearch?'':'<button data-action="inherit">承接前序</button>'}<button data-action="input">上传或填写</button><button data-action="focus-chat">对话补充</button><button data-action="research">联网取材</button></div></div>${entryMarkup({project:project(),module:{...moduleInfo(),skill:stageInfo().skill}})}<div class="inputs ${isResearch?'research-inputs':''}">${(isResearch?['manual','chat']:['artifact','manual','chat']).map(kind => {const index=['artifact','manual','chat'].indexOf(kind);
    const items = list.filter(input => kind === 'manual' ? ['manual','file','web'].includes(input.kind) : input.kind === kind);
    return `<div class="input-source"><span class="muted small">${['前序产物 / 定义与结果','手动输入 / 文件材料','AI 对话 / 用户确认'][index]}</span><h3>${esc(items[0]?.title || ['选择已有产物','加入你的材料','描述想法或补充信息'][index])}</h3><span class="muted small">${items.length ? `${items.length} 项 · 来源与性质分别保留` : ['可从任意模块承接','支持文字、PDF、Word、Excel、图片与网页','确认后才会加入本次输入'][index]}</span></div>`;
  }).join('')}</div>${list.length ? `<div class="input-list">${list.map(input => `<div class="input-item"><div><button class="link" data-view-input="${input.id}">${esc(input.title)}</button> <span class="pill ${input.evidence === 'test_data' ? 'test' : ''}">${evidenceNames[input.evidence]}</span> <span class="muted small">${kindNames[input.kind]}</span></div><button class="link danger" data-delete-input="${input.id}" aria-label="移除 ${esc(input.title)}">移除</button></div>`).join('')}</div>` : ''}</section>`;
}
function documentsMarkup(run) {
  return run.result.documents.map(doc => `<div class="document"><div><h3>${esc(doc.title)}</h3><p class="muted small">${doc.format.toUpperCase()} · v${run.version} · ${esc(run.modelSnapshot.name)}</p></div><div class="tools"><button data-view-doc="${doc.id}" data-run="${run.id}">打开文档</button><button data-export-doc="${doc.id}" data-run="${run.id}">导出</button></div></div>`).join('');
}
function blueprint(){return state.outlines?.find(b=>b.moduleId===ui.moduleId);}
function selectedDoc(){const run=selectedRun();return run?.result.documents.find(d=>d.id===ui.docId)||run?.result.documents[0];}
function moduleActivity(){const p=project(),running=runs().findLast(r=>r.status==='running');if(running)return running.progress?.label||'正在生成本模块文档';const working=p?.messages.findLast(m=>m.moduleId===ui.moduleId&&m.status==='working');if(working)return working.workKind==='html'?'正在生成 HTML 展示':'正在检查材料是否充分';if(ui.moduleId==='idea'&&p?.researchWorkflow?.phase==='preparing')return '正在准备调研计划';return null;}
function resultMarkup(){
 const run=selectedRun(),doc=selectedDoc(),latest=runs().at(-1),activity=moduleActivity(),busy=!!activity;
 const status=busy?`<div class="notice" role="status"><span class="running-dot"></span>${esc(activity)}。完成后自动展示结果。</div>`:latest?.status==='failed'?`<div class="notice error">上次运行失败：${esc(latest.error)}</div>`:'';
 return `<section class="panel results-panel" id="result-display" aria-busy="${busy}"><div class="panel-head result-heading ${busy?'is-working':''}"><div class="result-heading-title"><h2>结果展示</h2>${busy?`<span class="work-indicator" role="status">${esc(activity)}</span>`:''}</div><span class="muted small">${run?(busy?'上一完成版本 · ':'')+'v'+run.version+' · '+date(run.completedAt):busy?'已启动 · 等待本轮结果':'大纲先行，完成后展示文档'}</span></div>${status}<details class="outline-panel" ${run?'':'open'}><summary>文档大纲 · 可修改</summary><p class="muted small">${esc(blueprint()?.outlineBasis||'当前 Skill 默认结构')} · ${esc({research:'AI 产品经理研究助手',initiation:'产品立项报告',workflow:'产品经理工作流'}[blueprint()?.skill]||'')}。修改并保存后，助手按新大纲生成。</p><textarea id="module-outline" aria-label="文档大纲" ${busy?'disabled':''} maxlength="20000" rows="12">${esc(workspace.outline())}</textarea><button data-action="save-outline" ${busy||!project()?'disabled':''}>保存大纲</button></details><div class="${run?'reading-stage':'empty-reading'}"><div class="output-tabs" role="tablist" aria-label="结果展示类型">${[['documents','文档展示'],['html','HTML 展示'],['analysis','总结分析'],['data','结构化数据']].map(([key,name])=>`<button role="tab" aria-selected="${ui.tab===key}" data-tab="${key}" class="${ui.tab===key?'selected':''}">${name}</button>`).join('')}<button class="return-intake" data-action="return-intake">↑ 返回采集</button></div>${run?`<div class="document-workspace"><nav class="document-list" aria-label="本模块文档列表">${run.result.documents.map(d=>`<button data-select-doc="${d.id}" class="${d.id===doc?.id?'selected':''}" aria-pressed="${d.id===doc?.id}">${esc(d.title)}<small>${d.format.toUpperCase()}</small></button>`).join('')}</nav><div class="document-display" tabindex="0" role="region" aria-label="文档内容" data-reading-key="${esc(ui.projectId+':'+ui.moduleId+':'+run.id+':'+doc?.id+':'+ui.tab)}">${ui.tab==='analysis'?`<h3>${esc(doc?.title||'当前文档')} · 总结分析</h3><p class="muted small">${doc?.summary?'仅总结当前选中文档':'依据当前文档正文提取要点'}</p><div class="rendered-document document-summary">${renderMarkdown(documentSummary(doc))}</div>`:ui.tab==='data'?`<pre class="structured">${esc(JSON.stringify(run.result.structuredData,null,2))}</pre>`:doc?`<div class="panel-head"><h3>${esc(doc.title)}</h3><div class="tools"><button data-view-doc="${doc.id}" data-run="${run.id}">打开文档</button><button data-export-doc="${doc.id}" data-run="${run.id}">导出</button>${doc.htmlPresentation?`<button data-export-html="${doc.id}" data-run="${run.id}">导出 HTML</button>`:''}</div></div>${ui.tab==='html'?(doc.htmlPresentation||doc.format==='html'?frameMarkup(doc.htmlPresentation||doc.content):'<div class="empty"><h3>按需生成 HTML 展示</h3><p>当前文档已完成。点击后才调用模型，生成这一份文档的 HTML 展示。</p><button class="primary" data-action="generate-html">生成 HTML 展示</button></div>'):documentMarkup(doc)}`:''}</div></div><div class="handoff"><div><h3>交给下一步，或任意其他模块</h3><p class="muted small">选择数据或文档，保留版本与来源。</p></div><button data-action="handoff">选择产物并继续 →</button><button data-action="export-run">导出运行 JSON</button></div>`:`<div class="empty"><p>${busy?'正在执行本模块，文档完成后会显示在这里。':'在上方采集材料，在右侧 AI 工作助手开始本模块工作。'}</p>${ui.moduleId==='funnel'?'<button data-action="sample">试用示例 CSV</button>':['retention','ab'].includes(ui.moduleId)?`<button data-action="sample-${ui.moduleId}">试用示例 CSV</button>`:''}</div>`}</div></section>`;
}
const chat=createChat({context:()=>({project:project(),moduleId:ui.moduleId,inputs:inputs(),model:activeModel()}),api,token,render,toast,onWorkAction:()=>action('run')});
const workspace=createWorkspace({context:()=>({project:project(),moduleId:ui.moduleId,blueprint:blueprint()}),api,dialog,modal,refresh,toast,clearChat:(pid,mid)=>chat.clear(pid,mid),started:c=>{if(c.project.id===ui.projectId&&c.moduleId===ui.moduleId){ui.runId=null;ui.docId=null;ui.tab='documents';}}});
function assistant() {
 const m=chat.markup(),busy=m.busy||runs().some(r=>r.status==='running')||project()?.researchWorkflow?.phase==='preparing'&&ui.moduleId==='idea';
 return `<aside class="right"><div class="assistant-head"><h3>AI 工作助手</h3><span class="muted small">${esc(moduleInfo().name)}</span></div><div class="assistant-actions"><button class="primary" data-action="run" ${busy||!project()?'disabled':''}>${busy?'正在处理…':ui.moduleId==='idea'?'开始／继续研究':ui.moduleId==='initiation'?'制作立项报告':'运行当前模块'}</button><button class="link danger" data-action="reset-context" ${busy||!project()?'disabled':''}>清空当前模块上下文</button></div><div class="assistant-content" id="chat-list" tabindex="0" role="log" aria-label="工作助手对话"><div class="assistant-context"><p class="muted small">${inputs().length} 项输入 · ${activeModel()?esc(activeModel().name):'尚未选择模型'}</p></div><div id="chat-messages">${m.messages||'<p class="muted">告诉我你的想法、竞品或材料，我们从这里开始。</p>'}</div></div><button id="chat-latest" type="button" hidden>↓ 回到最新</button><form id="chat-form" class="composer"><label class="field-label" for="chat-message">补充材料或描述问题</label><textarea id="chat-message" placeholder="描述想法，Enter 发送，Shift + Enter 换行" maxlength="12000">${m.draft}</textarea><div class="tools"><button type="button" data-action="input">＋ 添加材料</button><button id="chat-stop" type="button" ${m.streaming?'':'hidden'}>停止生成</button><button id="chat-send" class="primary" ${busy||!project()?'disabled':''}>发送</button></div><div class="footer-note">补充内容经你确认后加入输入。</div></form></aside>`;
}
function settingsPage() {
  return `<div class="settings"><div class="title-row"><div><h1>模型设置</h1><p>选择已接入的模型，供后续模块运行与对话使用。</p></div><button data-action="back">返回工作台</button></div><section class="panel"><div class="panel-head"><h2>已接入模型</h2><span class="muted small">${state.models.length} 个连接</span></div>${state.models.length ? state.models.map(model => `<div class="model-row"><div><h3>${esc(model.name)} ${model.id === state.settings.activeModelId ? '<span class="pill">当前默认</span>' : ''}</h3><code>${esc(model.model)}</code><p class="muted small">${esc(model.api)} · ${esc(model.baseURL)}</p><span class="muted small">${model.configured ? '密钥已配置' : '密钥不可用'}</span></div><div class="tools"><button data-test-model="${model.id}">测试连接</button><button data-edit-model="${model.id}">编辑</button><button class="danger" data-remove-model="${model.id}">移除</button>${model.id === state.settings.activeModelId ? '' : `<button data-select-model="${model.id}">设为默认</button>`}</div></div>`).join('') : '<div class="empty"><h3>接入你的第一个模型</h3><p>支持 DeepSeek 原生接口、OpenAI 兼容接口和 Anthropic Messages 接口。</p></div>'}</section><section class="panel"><div class="panel-head"><h2>${ui.editingModelId ? "编辑模型连接" : "新增模型连接"}</h2></div>${modelFormMarkup(state.providers,state.models.find(model=>model.id===ui.editingModelId))}</section>${searchFormMarkup(state.settings.search)}${state.capabilities?.desktopUpdating?updatesMarkup(state.settings.updates):''}</div>`;
}
const workflow=createWorkflow({dialog,modal,api,refresh,toast,context:()=>({project:project(),search:state.settings.search}),researchDialog,runWork:body=>workspace.submit(body)});
function render() {
  captureReading();
  chat.save();
  document.body.classList.toggle('page-settings',ui.settings);
  const running = runs().some(run => run.status === 'running');
  root.innerHTML = `<div class="layout">${sidebar()}<main class="main"><header class="topbar"><span class="muted small">我的项目 / ${esc(project()?.name || '新项目')} / <strong>${ui.settings ? '设置' : esc(stageInfo().name)}</strong></span><div class="tools"><span class="muted small">${activeModel() ? esc(activeModel().name) : '未接入模型'}</span><button data-action="history">版本记录</button></div></header>${ui.settings ? settingsPage() : `<div class="content"><div class="title-row"><div><h1>${esc(moduleInfo().name)}</h1><p>在中间采集材料与查看结果，由右侧 AI 工作助手推进本模块工作。</p></div></div>${inputPanel()}${resultMarkup()}</div>`}</main>${assistant()}</div>`;
  bindForms();
  bindReading();hydrateVisuals(root);
  bindUpdates({api,toast});
}
function dialog(title,body) { modal.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button data-action="close-dialog" aria-label="关闭窗口">关闭</button></div>${body}`; if (!modal.open) modal.showModal(); }
function ensureProject() { if (!project()) throw new Error('请先新建项目'); }
function inputDialog() {
  ensureProject();
  enhancedInputDialog({dialog,api,refresh,toast,modal,projectId:ui.projectId,moduleId:ui.moduleId,token,ocrAvailable:state.capabilities?.ocr});
}
function availableArtifacts() { return project()?.runs.filter(run => run.status === 'succeeded').flatMap(run => [{ run, id: 'data', title: '结构化数据' }, ...run.result.documents.map(doc => ({ run, id: doc.id, title: doc.title }))]) || []; }
function inheritDialog() {
  ensureProject();if(stageInfo().skill==='research')throw new Error('研究是首个工作区，不支持承接前序');
  const order=state.stages.flatMap(s=>s.modules),previous=order[order.findIndex(m=>m.id===ui.moduleId)-1];
  const artifacts=availableArtifacts().sort((a,b)=>Number(b.run.moduleId===previous?.id)-Number(a.run.moduleId===previous?.id));
  dialog('承接已有产物',artifacts.length ? artifacts.map(a => `<div class="inherit-row"><div><h3>${esc(a.title)}</h3><span class="muted small">${a.run.moduleId===previous?.id?'前一步 · ':''}${esc(state.stages.flatMap(s=>s.modules).find(m=>m.id===a.run.moduleId)?.name||'旧版研究')} · v${a.run.version}</span></div><button data-inherit-run="${a.run.id}" data-inherit-artifact="${a.id}">加入本次输入</button></div>`).join('') : '<p class="muted">当前项目还没有成功生成的产物。可以先上传材料或通过对话开始。</p>');
}
function handoffDialog() {
  const run = selectedRun(); if (!run) throw new Error('请先生成产物');
  const current = state.stages.indexOf(stageInfo());
  const next = state.stages[Math.min(current+1,state.stages.length-1)].modules[0].id;
  dialog('选择产物并交接', `<form id="handoff-form"><label><span class="field-label">接收模块</span><select name="target">${state.stages.filter(stage=>stage.skill!=='research').map(stage=>`<optgroup label="${esc(stage.name)}">${stage.modules.map(module=>`<option value="${module.id}" ${module.id===next?'selected':''}>${esc(module.name)}</option>`).join('')}</optgroup>`).join('')}</select></label><p class="muted">选择要传递的产物（固定引用本次 v${run.version}）：</p>${[{id:'data',title:'结构化数据'},...run.result.documents].map(doc=>`<label class="inherit-row"><span><input style="width:auto" type="checkbox" name="artifact" value="${doc.id}" checked> ${esc(doc.title)}</span></label>`).join('')}<button class="primary">交给所选模块</button></form>`);
  modal.querySelector('form').addEventListener('submit', async event=>{event.preventDefault();await guarded(async()=>{
    const values=new FormData(event.target); const artifacts=values.getAll('artifact'); if(!artifacts.length)throw new Error('至少选择一项产物');
    for(const id of artifacts)await api(`/api/projects/${ui.projectId}/inherit`,{runId:run.id,artifactId:id,targetModuleId:values.get('target')});
    modal.close();await refresh(false);setModule(values.get('target'));toast('已交接，源版本与来源已保留');
  },event.target.querySelector('button'));});
}
function download(name,content,type='text/plain') {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function findDoc(runId,docId){const run=project().runs.find(run=>run.id===runId);const doc=run?.result?.documents.find(doc=>doc.id===docId);if(!doc)throw new Error('文档不存在');return {run,doc};}
function viewDoc(runId,docId){const {doc}=findDoc(runId,docId);dialog(doc.title,documentMarkup(doc));hydrateVisuals(modal);}
async function guarded(fn,button){if(button)button.disabled=true;try{await fn();}catch(error){toast(error.message);}finally{if(button?.isConnected)button.disabled=false;}}
function bindForms(){
  bindSearchForm({api,refresh,toast});
  document.querySelector('#project-select').addEventListener('change',event=>{ui.projectId=event.target.value;ui.runId=null;ui.chatDraft='';localStorage.setItem('aipm.project',ui.projectId);render();});
  chat.bind();
  const outline=document.querySelector('#module-outline');if(outline)outline.oninput=()=>workspace.saveDraft(outline.value);
  bindModelForm({providers:state.providers,model:state.models.find(model=>model.id===ui.editingModelId),save:async values=>{
    await api(ui.editingModelId ? `/api/models/${ui.editingModelId}` : '/api/models',{...values,makeDefault:!ui.editingModelId});
  },done:async()=>{ui.editingModelId=null;await refresh();toast('模型已保存，可以开始使用或测试连接');}});
}
async function action(name){
  switch(name){
    case 'new-project':dialog('新建产品项目','<form id="project-form"><label><span class="field-label">项目名称</span><input name="name" placeholder="例如：双端 AI 宠物陪伴" required maxlength="200" autofocus></label><p class="muted">每个项目分别保存材料、结果和版本。</p><button class="primary">创建项目</button></form>');modal.querySelector('form').addEventListener('submit',event=>{event.preventDefault();guarded(async()=>{const p=await api('/api/projects',{name:event.target.elements.name.value});ui.projectId=p.id;ui.runId=null;modal.close();await refresh();toast('项目已创建');},event.target.querySelector('button'));});break;
    case 'input':inputDialog();break;
    case 'return-intake':document.querySelector('#data-collection')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});break;
    case 'save-outline':await workspace.saveOutline();break;
    case 'reset-context':workspace.reset();break;
    case 'generate-html':await workspace.html(selectedRun(),selectedDoc());break;
    case 'research':ensureProject();researchDialog({dialog,api,refresh,toast,modal,projectId:ui.projectId,moduleId:ui.moduleId,configured:state.settings.search.configured,dynamicAvailable:state.capabilities?.dynamicResearch});break;
    case 'inherit':inheritDialog();break;
    case 'handoff':handoffDialog();break;
    case 'focus-chat':document.querySelector('#chat-message').focus();break;
    case 'close-dialog':modal.close();break;
    case 'settings':ui.settings=true;render();break;
    case 'cancel-edit':ui.editingModelId=null;render();break;
    case 'back':ui.settings=false;ui.editingModelId=null;render();break;
    case 'research-questions':workflow.questions();break;
    case 'research-plan':workflow.plan();break;
    case 'run':{
      ensureProject();if(ui.moduleId==='idea'){const w=project().researchWorkflow;if(w?.phase==='questions')workflow.questions();else if(w?.plan)workflow.plan();else workflow.start('idea');break;}const projectId=ui.projectId,moduleId=ui.moduleId;
      const run=analyticsOptions=>workspace.submit({moduleId,analyticsOptions});
      if(moduleId==='initiation'){workflow.initiation(entryContext=>workspace.submit({moduleId,entryContext}));}
      else if(moduleId==='funnel'&&needsFunnelOptions(inputs()))funnelRunDialog({dialog,modal,run});else if(['retention','ab'].includes(moduleId))analyticsRunDialog({dialog,modal,moduleId,run});else await run();
      break;
    }
    case 'sample-retention':case 'sample-ab':{
      ensureProject();const retention=name==='sample-retention';
      await api(`/api/projects/${ui.projectId}/inputs`,{moduleId:ui.moduleId,title:retention?'留存测试数据.csv':'AB测试数据.csv',content:retention?'cohort,cohort_users,day,retained_users\n2026-10-01,100,1,60\n2026-10-01,100,7,30\n2026-10-07,80,1,40\n2026-10-07,80,7,20':'variant,users,conversions\nA,1000,100\nB,1000,140',kind:'file',evidence:'test_data'});
      await refresh();toast(retention?'已加入测试数据；示例观察截至日期可填写 2026-10-08':'已加入测试数据，不能当作真实用户证据');break;
    }
    case 'sample':await api(`/api/projects/${ui.projectId}/inputs`,{moduleId:'funnel',title:'用户行为示例.csv',content:'step,users\n访问产品,1200\n创建宠物,840\n首次喂养,660\n首次发布,180',kind:'file',evidence:'test_data'});await refresh();toast('已加入测试数据，不能当作真实用户证据');break;
    case 'export-run':{const run=selectedRun();if(!run)throw new Error('尚无成功结果');download(`${moduleInfo().name}-v${run.version}.json`,JSON.stringify(run,null,2),'application/json');break;}
    case 'history':dialog('当前模块版本记录',runs().length?[...runs()].reverse().map(run=>`<div class="history-row"><h3>v${run.version} · ${run.status==='succeeded'?'已完成':run.status==='failed'?'失败':'运行中'}</h3><p class="muted small">${date(run.startedAt)} · ${esc(run.modelSnapshot.name)} · ${run.inputSnapshot.length} 项输入 · skill ${esc(run.skillSnapshot.sha256.slice(0,12))}</p>${run.status==='succeeded'?`<button data-select-run="${run.id}">查看此版本</button>`:run.error?`<p>${esc(run.error)}</p>`:''}</div>`).join(''):'<p class="muted">当前模块还没有运行记录。</p>');break;
    case 'all-documents':ensureProject();dialog('项目全部文档',availableArtifacts().filter(a=>a.id!=='data').map(a=>`<div class="inherit-row"><div>${esc(a.title)} <span class="muted small">v${a.run.version}</span></div><button data-view-doc="${a.id}" data-run="${a.run.id}">打开文档</button></div>`).join('')||'<p class="muted">还没有生成文档。</p>');break;
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  guarded(async()=>{
    if(button.dataset.researchMode){workflow.start(button.dataset.researchMode);return;}
    if(button.dataset.module){setModule(button.dataset.module);return;}
    if(button.dataset.selectDoc){ui.docId=button.dataset.selectDoc;render();return;}
    if(button.dataset.tab){ui.tab=button.dataset.tab;render();return;}
    if(button.dataset.action){await action(button.dataset.action);return;}
    if(button.dataset.deleteInput){await api(`/api/projects/${ui.projectId}/inputs/${button.dataset.deleteInput}`,undefined,'DELETE');await refresh();return;}
    if(button.dataset.viewInput){const input=inputs().find(input=>input.id===button.dataset.viewInput);dialog(input.title,`<p class="muted">${evidenceNames[input.evidence]} · ${kindNames[input.kind]}</p><pre class="structured">${esc(input.content)}</pre>${provenanceMarkup(input)}${input.source?`<p class="muted small">源运行 ${esc(input.source.runId)} · v${input.source.version}</p>`:''}`);return;}
    if(button.dataset.inheritRun){await api(`/api/projects/${ui.projectId}/inherit`,{runId:button.dataset.inheritRun,artifactId:button.dataset.inheritArtifact,targetModuleId:ui.moduleId});modal.close();await refresh();toast('已承接前序产物');return;}
    if(button.dataset.confirmMessage){const m=project().messages.find(m=>m.id===button.dataset.confirmMessage);await api(`/api/projects/${ui.projectId}/inputs`,{moduleId:ui.moduleId,title:m.proposedInput.title,content:m.proposedInput.content,evidence:'user_statement',kind:'chat',sourceMessageId:m.id});await refresh();toast('已确认并加入输入');return;}
    if(button.dataset.viewDoc){viewDoc(button.dataset.run,button.dataset.viewDoc);return;}
    if(button.dataset.exportHtml){const {doc}=findDoc(button.dataset.run,button.dataset.exportHtml);download(`${doc.title}.html`,doc.htmlPresentation,'text/html');return;}
    if(button.dataset.exportDoc){const {doc}=findDoc(button.dataset.run,button.dataset.exportDoc);download(`${doc.title}.${{markdown:'md',html:'html',json:'json'}[doc.format]}`,doc.content);return;}
    if(button.dataset.selectRun){ui.runId=button.dataset.selectRun;modal.close();render();return;}
    if(button.dataset.editModel){ui.editingModelId=button.dataset.editModel;render();document.querySelector('#model-form').scrollIntoView({block:'center'});return;}
    if(button.dataset.removeModel){dialog('移除模型连接','<p>移除后不会影响已有运行记录。后续运行需要选择其他模型。</p><button class="danger" id="confirm-remove-model">确认移除</button>');modal.querySelector('#confirm-remove-model').addEventListener('click',()=>guarded(async()=>{await api(`/api/models/${button.dataset.removeModel}`,undefined,'DELETE');ui.editingModelId=null;modal.close();await refresh();toast('模型连接已移除');}));return;}
    if(button.dataset.selectModel){await api('/api/settings',{activeModelId:button.dataset.selectModel});await refresh();toast('默认模型已切换，后续运行生效');return;}
    if(button.dataset.testModel){const old=button.textContent;button.textContent='测试中…';try{const r=await api(`/api/models/${button.dataset.testModel}/test`,{});toast(`连接成功：${r.model}`);}finally{button.textContent=old;}return;}
  },button);
});
try{await refresh();}catch(error){root.innerHTML=`<p class="loading">${esc(error.message)}，请刷新页面。</p>`;}
setInterval(async()=>{if(!state||ui.settings)return;const before=JSON.stringify(state.projects.map(p=>[p.runs.map(r=>[r.id,r.status,r.progress,r.result?.documents.map(d=>[d.id,!!d.htmlPresentation])]),p.researchWorkflow,p.moduleContexts,p.messages.map(m=>[m.id,m.status,m.questionState])]));try{await refresh(false);const after=JSON.stringify(state.projects.map(p=>[p.runs.map(r=>[r.id,r.status,r.progress,r.result?.documents.map(d=>[d.id,!!d.htmlPresentation])]),p.researchWorkflow,p.moduleContexts,p.messages.map(m=>[m.id,m.status,m.questionState])]));if(before!==after)render();}catch(error){console.warn(error.message);}},1800);

if(window.aipmDesktop){window.aipmDesktop.onAction(name=>guarded(()=>action(name)));}

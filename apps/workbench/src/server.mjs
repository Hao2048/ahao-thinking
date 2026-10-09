import {outlineCatalog,defaultOutline,workMessage,inputMessage,moduleContext,moduleBusy,userContext,workDigest,preflight,authorizeWork} from './assistant-workspace.mjs';
import {prepareResearch,approvedResearch,researchInputs,materialDigest} from './research-workflow.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providers, resolveProvider } from './providers.mjs';
import { ChatService } from './chat-service.mjs';
import { Store } from './store.mjs';
import { stages, getModule } from './catalog.mjs';
import { parseModelJson, makeInput, publicModel, validateModel, text, funnelFromInputs, MAX_CONTEXT_BYTES } from './domain.mjs';
import { HarnessBridge, skillSnapshot, skillInstruction } from './harness.mjs';
import { updateSettings as validateUpdates } from '../desktop/updater.mjs';
import { ocrAvailable } from './ocr.mjs';
import { parseFile, MAX_FILE_BYTES } from './files.mjs';
import { computedAnalysis } from './analytics.mjs';
import { WebResearch, publicSearch, searchSettings } from './research.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt':'text/plain; charset=utf-8' };
function projectOf(state, id) { const project = state.projects.find(project => project.id === id); if (!project) throw new Error('项目不存在'); return project; }
function connectionOf(state) { const model = state.models.find(model => model.id === state.settings.activeModelId); if (!model) throw new Error('请先到模型设置添加并选择一个模型'); return model; }
function referencesOf(inputs) {
  const sources=inputs.flatMap(input=>input.webSource?[{title:input.title,...input.webSource}]:input.source?.references||[]);
  return [...new Map(sources.map(source=>[source.url,{title:source.title,url:source.url,status:source.status,method:source.method||'http-fetch',retrievedAt:source.retrievedAt}])).values()];
}
function fileReferencesOf(inputs) {
  const sources=inputs.flatMap(input=>input.fileSource?[input.fileSource]:input.source?.fileReferences||[]);
  return [...new Map(sources.map(source=>[source.sha256+'|'+(source.sheet||''),source])).values()];
}
function cleanError(error, state) {
  let message = error instanceof Error ? error.message : String(error);
  for (const model of state.models) {
    const secret = model.apiKey || process.env[model.apiKeyEnv];
    if (secret) message = message.replaceAll(secret, '[已隐藏密钥]');
  }
  const search = state.settings.search;
  const searchSecret = search?.apiKey || (search?.apiKeyEnv && process.env[search.apiKeyEnv]);
  if (searchSecret) message = message.replaceAll(searchSecret, '[已隐藏密钥]');
  return message.slice(0, 2000);
}
async function bodyOf(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 3 * 1024 * 1024) throw new Error('请求超过 3 MB'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请求不是有效 JSON'); }
}
export async function startServer({ port = 4318, dataDir = process.env.AIPM_DATA_DIR || join(appRoot, 'data'), bridge, storageCodec, researchBridge, dynamicPage, updateBridge } = {}) {
  const store = new Store(dataDir, storageCodec); await store.open();
  const runtime = bridge || new HarnessBridge(dataDir);
  const chat=new ChatService(store,runtime,cleanError);
  const research = researchBridge || new WebResearch({dynamicPage});
  const fileDrafts = new Map();
  const token = randomBytes(32).toString('hex');
  const pending = new Set();
  let closing = false;
  const server = createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      const address = server.address();
      const host = `127.0.0.1:${address.port}`;
      if (req.headers.host !== host && req.headers.host !== `localhost:${address.port}`) return send(403, { error: 'Host 不允许' });
      const origin = req.headers.origin;
      if (origin && ![`http://${host}`, `http://localhost:${address.port}`].includes(origin)) return send(403, { error: '来源不允许' });
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (path.startsWith('/api/')) {
        if (req.headers['x-aipm-token'] !== token) return send(403, { error: '页面授权已过期，请刷新' });
        if (closing) return send(503, { error: '服务正在关闭' });
        if (path === '/api/files/parse' && req.method === 'POST') {
          const projectId = url.searchParams.get('projectId'), moduleId = getModule(url.searchParams.get('moduleId')).id;
          const contextEpoch=moduleContext(projectOf(store.read(),projectId),moduleId).epoch||0; getModule(moduleId);
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > MAX_FILE_BYTES) throw new Error('文件超过 20 MB'); chunks.push(chunk); }
          const parsed = await parseFile(url.searchParams.get('filename'), Buffer.concat(chunks), { ocr: url.searchParams.get('ocr') === 'true' });
          for (const [id, draft] of fileDrafts) if (draft.expires < Date.now()) fileDrafts.delete(id);
          if (fileDrafts.size >= 10) fileDrafts.delete(fileDrafts.keys().next().value);
          if((moduleContext(projectOf(store.read(),projectId),moduleId).epoch||0)!==contextEpoch)throw new Error('模块上下文已清空，请重新上传');
          const draft = { ...parsed, contextEpoch, id: randomUUID(), projectId, moduleId, expires: Date.now()+15*60*1000 };
          fileDrafts.set(draft.id, draft); return send(200, draft);
        }
        const body = ['POST', 'DELETE'].includes(req.method) && req.method !== 'DELETE' ? await bodyOf(req) : {};
        if(body.moduleId)body.moduleId=getModule(body.moduleId).id;if(body.targetModuleId)body.targetModuleId=getModule(body.targetModuleId).id;
        if (path === '/api/state' && req.method === 'GET') {
          const state = store.read();
          return send(200, { ...state, capabilities: { ocr: await ocrAvailable(), dynamicResearch:Boolean(dynamicPage), desktopUpdating:Boolean(updateBridge) }, settings: { ...state.settings, search: publicSearch(state.settings.search) }, models: state.models.map(publicModel), providers, stages, outlines:await outlineCatalog() });
        }
        if(path==='/api/desktop/updates'&&req.method==='GET'){
          if(!updateBridge)throw new Error('更新仅支持桌面版');return send(200,await updateBridge('status'));
        }
        if(path==='/api/desktop/updates'&&req.method==='POST'){
          if(!updateBridge)throw new Error('更新仅支持桌面版');
          if(body.action==='configure'){
            const settings=validateUpdates(body);const result=await updateBridge('configure',settings);
            await store.update(state=>{state.settings.updates=settings;});return send(200,result);
          }
          if(!['check','install'].includes(body.action))throw new Error('更新操作不支持');
          if(body.action==='install'&&store.read().projects.some(project=>project.runs.some(run=>run.status==='running')||project.researchWorkflow?.phase==='preparing'||(project.messages||[]).some(message=>['streaming','working'].includes(message.status))))throw new Error('有任务正在运行，请完成后再安装更新');
          const result=await updateBridge(body.action);send(200,result);
          if(body.action==='install')void updateBridge('apply').catch(()=>{});return;
        }
        if (path === '/api/search/settings'  && req.method === 'POST') {
          const saved = await store.update(state => { state.settings.search = searchSettings(body,state.settings.search); return publicSearch(state.settings.search); });
          return send(200, saved);
        }
        if (path === '/api/projects' && req.method === 'POST') {
          const project = { id: randomUUID(), name: text(body.name, '项目名称'), createdAt: new Date().toISOString(), inputs: [], runs: [], messages: [] };
          await store.update(state => state.projects.push(project)); return send(201, project);
        }
        if (path === '/api/models' && req.method === 'POST') {
          const model = validateModel(body);
          await store.update(state => { state.models.push(model); if(body.makeDefault===true||!state.settings.activeModelId)state.settings.activeModelId=model.id; });
          return send(201, publicModel(model));
        }
        if (path === '/api/settings' && req.method === 'POST') {
          await store.update(state => { if (!state.models.some(model => model.id === body.activeModelId)) throw new Error('模型不存在'); state.settings.activeModelId = body.activeModelId; });
          return send(200, { ok: true });
        }
        const modelEdit = path.match(/^\/api\/models\/([^/]+)$/);
        if (modelEdit && ['POST', 'DELETE'].includes(req.method)) {
          const modelId = modelEdit[1];
          const visible = await store.update(state => {
            const model = state.models.find(model => model.id === modelId);
            if (!model) throw new Error('模型不存在');
            if (req.method === 'DELETE') {
              if (state.projects.some(project => project.runs.some(run => run.status === 'running' && run.modelSnapshot.id === modelId)||(project.messages||[]).some(m=>['streaming','working'].includes(m.status)&&m.modelId===modelId)||(project.researchWorkflow?.phase==='preparing'&&project.researchWorkflow.modelId===modelId))) throw new Error('该模型正在运行，完成后再移除');
              state.models = state.models.filter(item => item.id !== modelId);
              if (state.settings.activeModelId === modelId) state.settings.activeModelId = state.models[0]?.id || null;
              return { ok: true };
            }
            const resolved=resolveProvider(body);
            const destinationChanged=resolved.api!==model.api || String(resolved.baseURL||'').replace(/\/$/,'')!==model.baseURL;
            if(destinationChanged&&!body.apiKey&&!body.apiKeyEnv)throw new Error('更换厂商、地址或协议时，请重新填写对应 API Key');
            const next = validateModel({ ...body, apiKey: body.apiKey || (body.apiKeyEnv ? undefined : model.apiKey) || undefined, apiKeyEnv: body.apiKeyEnv || undefined });
            Object.assign(model, next, { id: modelId, createdAt: model.createdAt });
            if (!next.apiKeyEnv) delete model.apiKeyEnv;
            return publicModel(model);
          });
          return send(200, visible);
        }
        const modelTest = path.match(/^\/api\/models\/([^/]+)\/test$/);
        if (modelTest && req.method === 'POST') {
          const model = store.read().models.find(model => model.id === modelTest[1]);
          if (!model) throw new Error('模型不存在');
          const output = await runtime.invoke(model, '只回复：连接成功', appRoot);
          if (!output.finalResponse?.trim()) throw new Error('模型没有返回内容');
          return send(200, { ok: true, model: model.model, reply: output.finalResponse, sessionId: output.sessionId });
        }
        const assistantRoute=path.match(/^\/api\/projects\/([^/]+)\/assistant\/([^/]+)\/(outline|preflight|reset|html)$/);
        if(assistantRoute){
          const [,pid,mid,operation]=assistantRoute,moduleId=getModule(mid).id,p=projectOf(store.read(),pid),workspace=join(dataDir,'projects',pid);
          await mkdir(workspace,{recursive:true,mode:0o700});const defaults=await defaultOutline(moduleId);
          if(operation==='outline'&&req.method==='GET')return send(200,{...defaults,...moduleContext(p,moduleId)});
          if(req.method!=='POST')throw new Error('助手操作不支持');
          if(moduleBusy(p,moduleId))throw new Error('助手正在处理本模块，请完成或停止后重试');
          if(operation==='reset'){
            await store.update(state=>{const p=projectOf(state,pid);if(moduleBusy(p,moduleId))throw new Error('本模块仍在工作');
              p.inputs=p.inputs.filter(i=>i.moduleId!==moduleId);p.messages=p.messages.filter(m=>m.moduleId!==moduleId);p.researchDrafts=(p.researchDrafts||[]).filter(d=>d.moduleId!==moduleId);
              p.moduleContexts??={};p.moduleContexts[moduleId]={...(moduleContext(p,moduleId).outline?{outline:moduleContext(p,moduleId).outline}:{}),epoch:(moduleContext(p,moduleId).epoch||0)+1,resetAt:new Date().toISOString()};if(moduleId==='idea')delete p.researchWorkflow;
            });for(const [id,draft]of fileDrafts)if(draft.projectId===pid&&draft.moduleId===moduleId)fileDrafts.delete(id);return send(200,{ok:true});
          }
          if(operation==='outline'){
            const outline=text(body.outline,'文档大纲',20000);await store.update(state=>{const p=projectOf(state,pid);if(moduleBusy(p,moduleId))throw new Error('助手正在处理本模块');p.moduleContexts??={};p.moduleContexts[moduleId]={...moduleContext(p,moduleId),outline};workMessage(p,moduleId,'已更新本模块文档大纲，接下来会按新大纲分析与生成。',{workKind:'outline'});});return send(200,{outline});
          }
          const connection=structuredClone(connectionOf(store.read())),outline=moduleContext(p,moduleId).outline||defaults.outline;
          const workId=await store.update(state=>{const p=projectOf(state,pid);if(moduleBusy(p,moduleId))throw new Error('助手正在处理本模块');return workMessage(p,moduleId,operation==='preflight'?'我正在结合当前大纲检查材料是否充分…':'我正在把选中文档整理为 HTML 展示…',{status:'working',workKind:operation,modelId:connection.id}).id;});
          try{
            if(operation==='preflight'){
              const frozen=structuredClone(projectOf(store.read(),pid)),check=await preflight({project:frozen,moduleId,outline,connection,runtime,workspace,taskContext:body});
              await store.update(state=>{const p=projectOf(state,pid);p.moduleContexts??={};p.moduleContexts[moduleId]={...moduleContext(p,moduleId),preflight:check};Object.assign(p.messages.find(m=>m.id===workId),{status:'completed',content:check.summary+(check.suggestions.length?'\n建议补充：\n'+check.suggestions.map(v=>'• '+v).join('\n'):''),preflight:check});});return send(200,check);
            }
            const run=p.runs.find(r=>r.id===body.runId&&r.moduleId===moduleId&&r.status==='succeeded'),doc=run?.result.documents.find(d=>d.id===body.documentId);if(!doc)throw new Error('请选择当前模块已完成的文档');
            let html=doc.htmlPresentation;if(!html){const scope=await skillSnapshot(moduleId);const out=await runtime.invoke(connection,`${skillInstruction(moduleId,scope)}\n用户已手动请求为这一份已完成文档生成 HTML 展示。只转换选中文档，不生成其他阶段，不新增事实或更改数字，保留表格、图像和图表；来源不足保持原说明。原型模块可做离线交互原型。其他模块使用静态排版。不得请求外部资源。只返回 JSON {"html":"完整自包含 HTML"}。\n原文档：${JSON.stringify(doc)}`,workspace);html=text(parseModelJson(out.finalResponse).html,'HTML',600000);}
            await store.update(state=>{const p=projectOf(state,pid),r=p.runs.find(r=>r.id===run.id);r.result.documents.find(d=>d.id===doc.id).htmlPresentation=html;Object.assign(p.messages.find(m=>m.id===workId),{status:'completed',content:`「${doc.title}」的 HTML 展示已完成，可以在中间结果面板查看。`,runId:run.id,documentId:doc.id});});return send(200,{html});
          }catch(error){await store.update(state=>Object.assign(projectOf(state,pid).messages.find(m=>m.id===workId),{status:'failed',error:cleanError(error,{...state,models:[...state.models,connection]}),content:'本次助手工作未完成，请根据错误提示重试。'}));throw error;}
        }
        const chatEvent=path.match(/^\/api\/projects\/([^/]+)\/chat\/([^/]+)\/(events|stop)$/);
        if(chatEvent){const [,pid,id,operation]=chatEvent;if(operation==='events'&&req.method==='GET'){chat.stream(pid,id,res);return;}if(operation==='stop'&&req.method==='POST')return send(200,chat.stop(pid,id));throw new Error('对话操作不支持');}
        const route = path.match(/^\/api\/projects\/([^/]+)\/(inputs|inherit|runs|work|chat|research)(?:\/([^/]+))?$/);
        if (!route) return send(404, { error: '接口不存在' });
        const [, projectId, action, itemId] = route;
        projectOf(store.read(), projectId);
        const workspace = join(dataDir, 'projects', projectId);
        await mkdir(workspace, { recursive: true, mode: 0o700 });
        if (action === 'inputs' && req.method === 'POST') {
          const input = makeInput(body);
          if (body.fileDraftId) {
            const draft = fileDrafts.get(body.fileDraftId);
            if (!draft || draft.expires < Date.now() || draft.projectId !== projectId || draft.moduleId !== body.moduleId || (draft.contextEpoch||0)!==(moduleContext(projectOf(store.read(),projectId),body.moduleId).epoch||0) || input.kind !== 'file') throw new Error('解析预览已过期，请重新上传文件');
            const sheet = body.tableName ? draft.tables.find(table => table.name === body.tableName) : null;
            if (body.tableName && !sheet) throw new Error('所选工作表不存在');
            input.fileSource = { draftId:draft.id, filename: draft.filename, sha256: draft.sha256, parsedAt: draft.parsedAt, bytes: draft.bytes, warnings: draft.warnings, method: draft.method || 'text-extraction', ocrPages: draft.ocrPages || [], sheet: sheet?.name || null, edited: input.content !== (sheet?.content || draft.content) };
          }
          const added = await store.update(state => {
            const project = projectOf(state, projectId);
            if (body.fileDraftId) {
              const previous = project.inputs.find(input=>input.fileSource?.draftId===body.fileDraftId);
              if (previous) return previous;
            }
            if (body.sourceMessageId) {
              const message = project.messages.find(message => message.id === body.sourceMessageId && message.moduleId === body.moduleId && message.role === 'assistant' && message.proposedInput);
              if (!message || input.kind !== 'chat') throw new Error('对话建议不存在');
              const previous = project.inputs.find(input => input.sourceMessageId === body.sourceMessageId);
              if (previous) return previous;
              input.sourceMessageId = message.id;
            }
            project.inputs.push(input); inputMessage(project,input); return input;
          }); return send(201, added);
        }
        if (action === 'research' && req.method === 'POST') {
          if(itemId==='prepare'){return send(200,await prepareResearch({store,projectId,body,runtime,research,connection:connectionOf(store.read()),workspace}));}

          getModule(body.moduleId);
          if (itemId === 'plan') {
            const state = store.read(), project = projectOf(state,projectId), model = connectionOf(state);
            const inputs = project.inputs.filter(input=>input.moduleId===body.moduleId);
            if (!inputs.length) throw new Error('先加入想法或竞品材料，再拟定检索词');
            const scope=await skillSnapshot(body.moduleId);
            const output = await runtime.invoke(model,`${skillInstruction(body.moduleId,scope)}\n根据下列产品材料拟定最多 3 个公开网络检索词。不要包含私人姓名、联系方式、凭据或非公开公司数据。只返回 JSON {"queries":["检索词"]}。不做调研结论。材料：${JSON.stringify(inputs).slice(0,40000)}`,workspace);
            const { parseModelJson } = await import('./domain.mjs'); const planned = parseModelJson(output.finalResponse);
            if (!Array.isArray(planned.queries) || !planned.queries.length || planned.queries.length > 3) throw new Error('模型未返回有效检索词');
            return send(200,{queries:planned.queries.map(query=>text(query,'检索词',600))});
          }
          if (itemId) {
            const added = await store.update(state=>{
              const project=projectOf(state,projectId),draft=project.researchDrafts?.find(draft=>draft.id===itemId&&draft.moduleId===body.moduleId);
              if(!draft)throw new Error('联网材料预览不存在');
              if(!Array.isArray(body.selected)||!body.selected.length||body.selected.some(index=>!Number.isInteger(index)||!draft.sources[index]))throw new Error('至少选择一项有效来源');
              const inputs=[...new Set(body.selected)].map(index=>{
                const source=draft.sources[index];
                const existing=project.inputs.find(input=>input.webSource?.draftId===itemId&&input.webSource?.index===index);
                if(existing)return existing;
                const input={id:randomUUID(),moduleId:body.moduleId,kind:'web',title:source.title.slice(0,200)||source.url,content:`来源：${source.url}\n抓取时间：${source.retrievedAt}\n性质：${source.status==='page'?'网页正文':'搜索摘要（正文未抓取）'}\n${source.truncated?'正文节选，内容已截取\n':''}${source.content}`,evidence:'material',createdAt:new Date().toISOString(),webSource:{...source,content:undefined,draftId:itemId,index}};
                project.inputs.push(input);inputMessage(project,input);return input;
              });return inputs;
            });return send(201,added);
          }
          const output=await research.collect(store.read().settings.search,body,{connection:store.read().models.find(m=>m.id===store.read().settings.activeModelId)});
          const draft={...output,id:randomUUID(),moduleId:body.moduleId};
          await store.update(state=>{const project=projectOf(state,projectId);project.researchDrafts=[...(project.researchDrafts||[]).slice(-2),draft];});
          return send(200,draft);
        }
        if (action === 'inputs' && req.method === 'DELETE') {
          await store.update(state => { const project = projectOf(state, projectId); if (!project.inputs.some(input => input.id === itemId)) throw new Error('输入不存在'); project.inputs = project.inputs.filter(input => input.id !== itemId); });
          return send(200, { ok: true });
        }
        if (action === 'inherit' && req.method === 'POST') {
          if(getModule(body.targetModuleId).skill==='research')throw new Error('研究是首个工作区，不支持承接前序');
          getModule(body.targetModuleId);
          const input = await store.update(state => {
            const project = projectOf(state, projectId);
            const run = project.runs.find(run => run.id === body.runId && run.status === 'succeeded');
            if (!run) throw new Error('来源运行不存在或未完成');
            const document = body.artifactId === 'data' ? undefined : run.result.documents.find(document => document.id === body.artifactId);
            if (body.artifactId !== 'data' && !document) throw new Error('产物不存在');
            const input = { id: randomUUID(), moduleId: body.targetModuleId, kind: 'artifact', title: `${document?.title || '结构化数据'} · v${run.version}`, content: document?.content || JSON.stringify(run.result.structuredData, null, 2), evidence: 'ai_hypothesis', source: { runId: run.id, artifactId: body.artifactId, moduleId: run.moduleId, version: run.version, references:referencesOf(run.inputSnapshot), fileReferences:fileReferencesOf(run.inputSnapshot), inputEvidence: run.inputSnapshot.map(input => ({ id: input.id, evidence: input.evidence })) }, createdAt: new Date().toISOString() };
            project.inputs.push(input); inputMessage(project,input); return input;
          });
          return send(201, input);
        }
        if (['runs','work'].includes(action) && req.method === 'POST') {
          getModule(body.moduleId);
          if(action==='work'&&!body.preflightId)throw new Error('请先让助手检查材料');
          const snapshot = await skillSnapshot(body.moduleId);
          const defaultPlan=await defaultOutline(body.moduleId);
          const runAndConnection = await store.update(state => {
            const project = projectOf(state, projectId); const connection = connectionOf(state);
            if (!publicModel(connection).configured) throw new Error('所选模型没有密钥，请到设置补充');
            if (moduleBusy(project,body.moduleId)) throw new Error('这个模块正在运行，请等待完成');
            const inputs = project.inputs.filter(input => input.moduleId === body.moduleId);
            let researchContext=null;if(body.moduleId==='idea'){researchContext=approvedResearch(project,body);project.researchWorkflow=researchContext;if(!researchContext.limitedResearch&&!publicSearch(state.settings.search).configured&&!inputs.some(i=>i.webSource?.status==='page'))throw new Error('请配置联网检索，或明确选择基于现有资料的受限分析');project.researchWorkflow.phase='researching';}
            if(body.moduleId==='initiation'){if(!['new','iteration'].includes(body.entryContext?.productStage))throw new Error('请先盘点立项材料并选择新产品或已有产品迭代');body.entryContext={productStage:body.entryContext.productStage,businessGoal:body.entryContext.businessGoal?text(body.entryContext.businessGoal,'商业目标',3000):''};}
            const outline=moduleContext(project,body.moduleId).outline||defaultPlan.outline;authorizeWork(project,body.moduleId,outline,body);
            if (!inputs.length&&!userContext(project,body.moduleId).length&&body.ignoreInsufficient!==true) throw new Error('请先加入材料或通过对话确认输入');
            if (Buffer.byteLength(JSON.stringify(inputs)) > MAX_CONTEXT_BYTES) throw new Error('本次材料总量超过 2 MB，请减少输入');
            if(body.entryContext)workMessage(project,body.moduleId,'已接收本轮工作口径：'+JSON.stringify(body.entryContext),{workKind:'entry'});
            if(body.analyticsOptions)workMessage(project,body.moduleId,'已接收计算口径：'+JSON.stringify(body.analyticsOptions),{workKind:'entry'});
            const computed = body.moduleId === 'funnel' ? funnelFromInputs(inputs,body.analyticsOptions||{}) : computedAnalysis(body.moduleId,inputs,body.analyticsOptions);
            const run = { id: randomUUID(), moduleId: body.moduleId, version: 1 + Math.max(0, ...project.runs.filter(run => run.moduleId === body.moduleId).map(run => run.version)), status: 'running', startedAt: new Date().toISOString(), inputSnapshot: structuredClone(inputs), modelSnapshot: publicModel(connection), skillSnapshot: snapshot, outlineSnapshot:outline, conversationSnapshot:userContext(project,body.moduleId), contextEpoch:moduleContext(project,body.moduleId).epoch||0, researchContext, entryContext:body.entryContext||null, analyticsOptions:body.analyticsOptions||null, ...(computed ? { computed } : {}) };
            project.runs.push(run);workMessage(project,body.moduleId,'我已开始本模块工作：按当前大纲分析材料并生成文档。结果会同步到中间面板。',{status:'working',workKind:'run',runId:run.id}); return { run, connection };
          });
          const { run, connection } = runAndConnection;
          const task = (async () => {
            try {
              if(run.researchContext&&!run.researchContext.limitedResearch){
                await store.update(state=>projectOf(state,projectId).runs.find(r=>r.id===run.id).progress={phase:'researching',label:'正在联网检索并读取公开资料'});
                const urls=run.inputSnapshot.filter(i=>i.webSource?.status==='page').map(i=>i.webSource.url).slice(0,4);
                const collected=await research.collect(store.read().settings.search,{queries:run.researchContext.plan.queries,urls},{connection});
                const added=collected.sources.map(source=>({id:randomUUID(),moduleId:'idea',kind:'web',evidence:'material',title:source.title||source.url,content:source.content,webSource:{...source,content:undefined},createdAt:source.retrievedAt}));
                if(!added.length)throw new Error('联网研究未取得可用来源。'+collected.failures.slice(0,2).map(f=>f.error).join('；')+' 请重试、补充公开网页或明确选择受限分析。');
                run.inputSnapshot.push(...added);run.researchContext.collection={failures:collected.failures,collectedAt:collected.createdAt};
                if(Buffer.byteLength(JSON.stringify(run.inputSnapshot))>MAX_CONTEXT_BYTES)throw new Error('研究材料超过 2 MB，请缩小研究范围');
                await store.update(state=>Object.assign(projectOf(state,projectId).runs.find(item=>item.id===run.id),{inputSnapshot:run.inputSnapshot,researchContext:run.researchContext}));
              }
              const output = await runtime.generate(connection,run,workspace,{onProgress:progress=>store.update(state=>{const p=projectOf(state,projectId),r=p.runs.find(r=>r.id===run.id);if(r.status!=='running')return;r.progress={...progress,updatedAt:new Date().toISOString()};const m=p.messages.find(m=>m.runId===run.id&&m.workKind==='run');if(m)m.content=progress.label;})});
              if(run.researchContext){if(!['市场','用户','机会'].every(word=>output.result.documents.some(doc=>doc.title.includes(word))))throw new Error('研究结果必须包含市场调研、用户画像和机会点与风险');output.result.documents.unshift({id:randomUUID(),title:'用户确认的调研计划',format:'markdown',content:run.researchContext.plan.content});}
              if (run.computed) {
                output.result.charts = [run.computed];
                const key = {funnel:'computedFunnel',retention:'computedRetention',ab:'computedAB'}[run.computed.type];
                output.result.structuredData[key] = run.computed;
                output.result.documents.push({id:randomUUID(),title:'指标计算明细与口径',format:'json',content:JSON.stringify(run.computed,null,2)});
              }
              const sources=referencesOf(run.inputSnapshot);
              const label=value=>String(value).replace(/[\[\]\\]/g,'\\$&');
              if(sources.length)output.result.documents.push({id:randomUUID(),title:'联网来源与证据边界',format:'markdown',content:'# 联网来源\n\n'+sources.map(source=>`- [${label(source.title)}](${source.url}) · ${source.status==='page'?'正文':'仅搜索摘要'} · 抓取 ${source.retrievedAt}`).join('\n')+'\n\n网页资料只能支持研究判断，不能代替用户访谈、真实需求验证或市场规模核验。'});
              await store.update(state=>{const p=projectOf(state,projectId);Object.assign(p.runs.find(item=>item.id===run.id),{status:'succeeded',completedAt:new Date().toISOString(),...output});const message=p.messages.find(m=>m.runId===run.id&&m.workKind==='run');Object.assign(message,{status:'completed',content:output.result.summary+'\n\n已生成：'+output.result.documents.map(d=>d.title).join('、')+'。可以在中间结果展示面板切换查看。'});});
              if(run.researchContext)await store.update(state=>{const p=projectOf(state,projectId);p.researchWorkflow.phase='completed';p.researchWorkflow.runId=run.id;});
            } catch (error) {
              await store.update(state => Object.assign(projectOf(state, projectId).runs.find(item => item.id === run.id), { status: 'failed', completedAt: new Date().toISOString(), error: cleanError(error, {...state,models:[...state.models,connection]}) }));
              await store.update(state=>{const p=projectOf(state,projectId);Object.assign(p.messages.find(m=>m.runId===run.id&&m.workKind==='run'),{status:'failed',content:'本模块未完成，已保留已有结果。',error:cleanError(error,{...state,models:[...state.models,connection]})});});
              if(run.researchContext)await store.update(state=>projectOf(state,projectId).researchWorkflow.phase='failed');
            }
          })();
          pending.add(task); task.finally(() => pending.delete(task)).catch(() => {});
          return send(202, { runId: run.id });
        }
        if (action === 'chat' && req.method === 'POST') {
          const connection=connectionOf(store.read());
          const started=await chat.start(projectId,body,connection,workspace);
          if(body.stream===true)return send(202,{user:started.user,assistant:started.assistant});
          const answer=await started.task;if(answer.status==='failed'||answer.status==='stopped')throw new Error(answer.error);return send(200,answer);
        }
        return send(404, { error: '接口不存在' });
      }
      if (req.method !== 'GET') return send(405, { error: '方法不允许' });
      const allowed = new Set(['/', '/index.html', '/app.mjs', '/enhancements.mjs', '/updates.mjs', '/models.mjs', '/chat.mjs', '/workflow.mjs', '/workspace.mjs', '/document-view.mjs', '/document-summary.mjs', '/style.css', '/brand-logo.svg', '/chart-model.mjs', '/legacy-diagram.mjs', '/visuals.mjs', '/reading-layout.mjs']);
      if (!allowed.has(path) && !/^\/vendor\/[A-Za-z0-9._-]+\.(?:mjs|txt)$/.test(path)) return send(404, { error: '页面不存在' });
      const file = path === '/' ? 'index.html' : path.slice(1);
      let contents = await readFile(join(appRoot, 'public', file));
      if (file === 'index.html') contents = Buffer.from(contents.toString().replace('__AIPM_TOKEN__', token));
      res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(contents);
    } catch (error) { send(400, { error: cleanError(error, store.read()) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, store, token, updateSettings:()=>store.read().settings.updates||{}, url: `http://127.0.0.1:${server.address().port}`, async close() { closing = true; await chat.close(); await runtime.close(); await Promise.allSettled([...pending]); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ port: Number(process.env.AIPM_PORT || 4318) });
  console.log(`好浩的产品工作台：${app.url}`);
  if (process.env.AIPM_OPEN_BROWSER === '1' && process.platform === 'darwin') {
    const browser = spawn('open', [app.url], { stdio: 'ignore' });
    browser.on('error', error => console.error(`浏览器打开失败：${error.message}，请手动访问 ${app.url}`));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}

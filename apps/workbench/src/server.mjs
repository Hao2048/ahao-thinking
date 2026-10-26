import {NodeRegistry} from './node-registry.mjs';
import {FlowService} from './flow-service.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providers, resolveProvider } from './providers.mjs';
import { Store } from './store.mjs';
import { publicModel, validateModel, text } from './domain.mjs';
import { HarnessBridge } from './harness.mjs';
import { updateSettings as validateUpdates } from '../desktop/updater.mjs';
import { ocrAvailable } from './ocr.mjs';
import { MAX_FILE_BYTES } from './files.mjs';
import { WebResearch, publicSearch, searchSettings } from './research.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt':'text/plain; charset=utf-8' };
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
export async function startServer({ port = 4318, dataDir = process.env.AIPM_DATA_DIR || join(appRoot, 'data'), bridge, storageCodec, researchBridge, dynamicPage, updateBridge, nodeRoot = process.env.AIPM_NODE_ROOT || join(appRoot, 'nodes') } = {}) {
  const store = new Store(dataDir, storageCodec); await store.open();
  const runtime = bridge || new HarnessBridge(dataDir);
  const research = researchBridge || new WebResearch({dynamicPage});
  const registry=new NodeRegistry(nodeRoot); await registry.scan();
  const flows=new FlowService({store,registry,runtime,research,cleanError});
  const token = randomBytes(32).toString('hex');
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
        if(path === '/api/flow-files/parse' && req.method === 'POST'){
          const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_FILE_BYTES)throw new Error('文件超过20 MB');chunks.push(chunk);}
          return send(200,await flows.parseUpload(url.searchParams.get('projectId'),url.searchParams.get('flowId'),url.searchParams.get('nodeId'),url.searchParams.get('filename'),Buffer.concat(chunks),url.searchParams.get('ocr')==='true',url.searchParams.get('fieldKey')||'files'));
        }
        const body = ['POST', 'DELETE'].includes(req.method) && req.method !== 'DELETE' ? await bodyOf(req) : {};
        if(await flows.handle({path,req,body,send}))return;
        if (path === '/api/state' && req.method === 'GET') {
          const state = store.read();
          return send(200, { ...state, capabilities: { ocr: await ocrAvailable(), dynamicResearch:Boolean(dynamicPage), desktopUpdating:Boolean(updateBridge) }, settings: { ...state.settings, search: publicSearch(state.settings.search) }, models: state.models.map(publicModel), providers });
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
          if(body.action==='install'&&store.read().projects.some(project=>(project.workflows||[]).some(f=>(f.runs||[]).some(r=>['running','waiting_input'].includes(r.status))||(f.messages||[]).some(m=>m.status==='streaming'))))throw new Error('有任务正在运行，请完成后再安装更新');
          const result=await updateBridge(body.action);send(200,result);
          if(body.action==='install')void updateBridge('apply').catch(()=>{});return;
        }
        if (path === '/api/search/settings'  && req.method === 'POST') {
          const saved = await store.update(state => { state.settings.search = searchSettings(body,state.settings.search); return publicSearch(state.settings.search); });
          return send(200, saved);
        }
        if (path === '/api/projects' && req.method === 'POST') {
          const project = { id: randomUUID(), name: text(body.name, '项目名称'), createdAt: new Date().toISOString(), workflows: [] };
          await store.update(state => state.projects.push(project)); return send(201, project);
        }
        if (path === '/api/models' && req.method === 'POST') {
          const model = validateModel(body);
          await store.update(state => { state.models.push(model); if(body.makeDefault===true||!state.settings.activeModelId)state.settings.activeModelId=model.id; });
          return send(201, publicModel(model));
        }
        if (path === '/api/appearance' && req.method === 'POST') {
          if (!['dark', 'light'].includes(body.theme)) throw new Error('请选择深色或银白主题');
          const appearance = await store.update(state => { state.settings.appearance = { theme: body.theme }; return state.settings.appearance; });
          return send(200, appearance);
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
              if (state.projects.some(p => (p.workflows || []).some(f =>
                ((f.runs || []).some(r => ['running','waiting_input'].includes(r.status)) || (f.messages || []).some(m => m.status === 'streaming')) &&
                (f.graph?.nodes || []).some(n => (n.config.modelId || state.settings.activeModelId) === modelId)
              ))) throw new Error('该模型正在运行，完成后再移除');
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
        return send(404, { error: '接口不存在' });
      }
      if (req.method !== 'GET') return send(405, { error: '方法不允许' });
      const allowed = new Set(['/diagram-source.mjs','/node-app.mjs','/node-outline.mjs','/node-palette.mjs','/node-style.css','/node-themes.css', '/', '/index.html', '/models.mjs', '/document-view.mjs', '/document-summary.mjs', '/document-charts.mjs', '/brand-logo.svg', '/chart-model.mjs', '/legacy-diagram.mjs', '/visuals.mjs']);
      if (!allowed.has(path) && !/^\/vendor\/[A-Za-z0-9._-]+\.(?:mjs|txt)$/.test(path)) return send(404, { error: '页面不存在' });
      const file = path === '/' ? 'index.html' : path.slice(1);
      let contents = await readFile(join(appRoot, 'public', file));
      if (file === 'index.html') contents = Buffer.from(contents.toString().replace('__AIPM_TOKEN__', token).replace('__AIPM_THEME__', store.read().settings.appearance?.theme === 'light' ? 'light' : 'dark'));
      res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(contents);
    } catch (error) { send(400, { error: cleanError(error, store.read()) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, store, token, flows, registry, updateSettings:()=>store.read().settings.updates||{}, url: `http://127.0.0.1:${server.address().port}`, async close() { closing = true; await flows.close(); await runtime.close(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ port: Number(process.env.AIPM_PORT || 4318) });
  console.log(`阿浩Thinking：${app.url}`);
  if (process.env.AIPM_OPEN_BROWSER === '1' && process.platform === 'darwin') {
    const browser = spawn('open', [app.url], { stdio: 'ignore' });
    browser.on('error', error => console.error(`浏览器打开失败：${error.message}，请手动访问 ${app.url}`));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}

import {installBundledNodes} from "./node-installation.mjs";
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, access, readFile, writeFile, cp } from 'node:fs/promises';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdater } from './updater.mjs';
import { createDynamicReader } from './dynamic-research.mjs';

// Electron's ESM named exports eagerly evaluate safeStorage. Load the CommonJS
// getters so the historical app name is set before Keychain initialization.
const electron = createRequire(import.meta.url)('electron');
const { app, BrowserWindow, Menu, dialog, shell, session, autoUpdater } = electron;

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = '阿浩Thinking';
// Keep the original Keychain identity so a display-name change does not select
// a different safeStorage key for existing encrypted projects and model keys.
// The bundle, window, menu and About panel use the public display name above.
app.setName('产品经理工作台');
const safeStorage = electron.safeStorage;
const dataDir = process.env.AIPM_DESKTOP_DATA_DIR || join(app.getPath('appData'), 'AIPM Workbench');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
app.setPath('userData', dataDir);
const ownsInstance = app.requestSingleInstanceLock();
if (process.env.AIPM_DESKTOP_TEST === '1') console.error(`Desktop instance lock: ${ownsInstance}`);
let window;
let host;
let origin;
let shuttingDown;
let ready;
let log;
let boundsTimer;
let hostExited;
let dynamicReader;
const researchJobs=new Map();
let updater;
const isOwnPage = url => Boolean(origin && (url === origin || url === `${origin}/` || url.startsWith(`${origin}/#`)));

if (!ownsInstance) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else void ready?.then(createWindow); });
  app.on('activate', () => { if (!shuttingDown) void ready?.then(() => { if (window) window.show(); else return createWindow(); }); });
  // macOS keeps the application and in-progress work alive when its last window closes.
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (shuttingDown === 'complete') return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = 'running';
    void stopHost().finally(() => { shuttingDown = 'complete'; log?.end(); app.exit(0); });
  });
  ready = app.whenReady().then(boot).catch(async error => {
    await dialog.showMessageBox({ type: 'error', title: '工作台启动失败', message: '桌面工作台未能启动', detail: error.message, buttons: ['退出'] });
    app.quit();
  });
}

async function boot() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(join(dataDir, 'logs'), { recursive: true, mode: 0o700 });
  log = createWriteStream(join(dataDir, 'logs', 'desktop.log'), { flags: 'a', mode: 0o600 });
  log.write('Desktop starting\n');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS 钥匙串加密不可用。请解锁登录钥匙串后重试；工作台不会以明文保存桌面数据。');
  const runtimeRoot = app.isPackaged ? join(process.resourcesPath, 'runtime') : resolve(appRoot, '.desktop-build/runtime');
  const bundledNode = join(runtimeRoot, 'node');
  await access(bundledNode);
  const modules = join(runtimeRoot, 'node_modules');
  process.env.AIPM_HARNESS_NODE_MODULES=modules;
  dynamicReader=createDynamicReader({BrowserWindow,session});
  let distributable=false;
  if(app.isPackaged){try{distributable=JSON.parse(await readFile(join(process.resourcesPath,'aipm-desktop-build.json'),'utf8')).signing==='developer-id';}catch{}}
  updater=createUpdater({autoUpdater,supported:distributable,version:app.getVersion(),prepareInstall:async()=>{shuttingDown='running';dynamicReader.close();await stopHost();shuttingDown='complete';log?.end();}});
  await startHost(bundledNode, modules);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (_event, item) => item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) }));
  installMenu();
  await createWindow();
}

async function startHost(node, modules) {
  const nodeRoot=app.isPackaged?join(dataDir,'nodes'):join(appRoot,'nodes');
  if(app.isPackaged){const installed=await installBundledNodes(join(appRoot,'nodes'),nodeRoot);if(installed.conflicts.length)log?.write('Preserved customized node files: '+installed.conflicts.join(', ')+'\n');}
  host = spawn(node, [join(appRoot, 'desktop/host.mjs')], {
    cwd: dataDir, detached: true,
    env: { ...process.env, AIPM_DATA_DIR: dataDir, AIPM_HARNESS_NODE_MODULES: modules, AIPM_NODE_ROOT: nodeRoot },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  host.stdout.pipe(log, { end: false }); host.stderr.pipe(log, { end: false });
  hostExited = new Promise(resolve => host.once('exit', resolve));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超过 30 秒，请查看工作台日志。')), 30000);
    const failed = error => { clearTimeout(timer); reject(error); };
    host.once('error', failed);
    host.once('exit', () => failed(new Error('本地服务在启动过程中退出，请查看工作台日志。')));
    host.on('message', message => {
      if(message?.type==='update-request'&&typeof message.id==='string'&&['status','configure','check','install','apply'].includes(message.action)){
        void Promise.resolve().then(()=>updater[message.action==='install'?'requestInstall':message.action==='apply'?'install':message.action](message.value)).then(result=>{if(host.connected)host.send({type:'update-result',id:message.id,result});}).catch(error=>{if(host.connected)host.send({type:'update-result',id:message.id,error:error.message});});
      }
      if(message?.type==='research-cancel'){researchJobs.get(message.id)?.abort();return;}
      if(message?.type==='research-request'&&typeof message.id==='string'&&typeof message.url==='string'){
        const controller=new AbortController();researchJobs.set(message.id,controller);
        void dynamicReader.page(message.url,{signal:controller.signal}).then(result=>{if(host.connected)host.send({type:'research-result',id:message.id,result});}).catch(error=>{if(host.connected)host.send({type:'research-result',id:message.id,error:error.message});}).finally(()=>researchJobs.delete(message.id));
      }
      if (message?.type === 'storage-request') {
        try {
          if (typeof message.id !== 'string' || typeof message.value !== 'string') throw new Error('存储请求格式错误');
          let value;
          if (message.operation === 'encrypt') value = safeStorage.encryptString(message.value).toString('base64');
          else if (message.operation === 'decrypt') value = safeStorage.decryptString(Buffer.from(message.value, 'base64'));
          else throw new Error('不支持的存储操作');
          if (host.connected) host.send({ type: 'storage-result', id: message.id, value });
        } catch {
          if (host.connected) host.send({ type: 'storage-result', id: message.id, error: '无法通过 macOS 钥匙串读取或保存数据，请检查登录钥匙串。' });
        }
      }
      if (message?.type === 'ready') {
        try {
          const url = new URL(message.url);
          if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('本地服务地址不合法');
          origin = url.origin;
          try{updater.configure(message.updates||{});}catch{log.write('Update preferences unavailable.\n');}
          clearTimeout(timer); host.removeListener('error', failed); resolve();
        } catch (error) { failed(error); }
      }
    });
  });
  host.on('exit', async () => {
    if (shuttingDown) return;
    await dialog.showMessageBox(window, { type: 'error', message: '本地服务已停止', detail: '已保存的数据仍在本机。请退出并重新打开工作台。', buttons: ['退出'] });
    app.quit();
  });
}

async function createWindow() {
  if (window || shuttingDown) return;
  let bounds = { width: 1500, height: 980 };
  try {
    const saved = JSON.parse(await readFile(join(dataDir, 'window.json'), 'utf8'));
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) bounds = { width: Math.max(1000, Math.min(saved.width, 2600)), height: Math.max(700, Math.min(saved.height, 1800)) };
  } catch (error) { if (error.code !== 'ENOENT') log?.write('Window preferences unavailable; using defaults.\n'); }
  window = new BrowserWindow({ ...bounds, minWidth: 1000, minHeight: 700, show: false, title: name, titleBarStyle: 'hiddenInset', backgroundColor: '#171c26', webPreferences: { preload: join(appRoot, 'desktop/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged || process.env.AIPM_DESKTOP_TEST === '1' } });
  window.webContents.setWindowOpenHandler(({url}) => {
    try {
      const target = new URL(url);
      if (['http:','https:'].includes(target.protocol) && !target.username && !target.password && target.origin !== origin) void shell.openExternal(target.href);
    } catch {}
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isOwnPage(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Keep the one workbench window alive while hidden, including pending UI state.
  window.on('close', event => {
    if (!shuttingDown) { event.preventDefault(); window?.hide(); }
  });
  window.webContents.on('render-process-gone', async () => {
    if (shuttingDown || !window) return;
    const response = await dialog.showMessageBox(window, { type: 'error', message: '工作台窗口意外停止', detail: '本地服务和已保存的数据不受影响。', buttons: ['重新加载', '退出'] });
    if (response.response === 0) window?.reload(); else app.quit();
  });
  window.on('resize', () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => { if (window && !window.isFullScreen()) { const { width, height } = window.getBounds(); void writeFile(join(dataDir, 'window.json'), JSON.stringify({ width, height }), { mode: 0o600 }).catch(() => log?.write('Window preferences save failed.\n')); } }, 400);
  });
  window.on('closed', () => { window = undefined; clearTimeout(boundsTimer); });
  await window.loadURL(origin);
  window.show(); window.focus();
  log.write(`Desktop ready ${app.getVersion()}\n`);
}

function installMenu() {
  const action = name => { void (async () => {
    if (shuttingDown) return;
    if (!window) await createWindow();
    window?.show();
    window?.webContents.send('workbench-action', name);
  })().catch(error => log?.write(`Menu action failed: ${error.message}\n`)); };
  app.setAboutPanelOptions({ applicationName: name, applicationVersion: app.getVersion(), copyright: '基于 DeepSeek Harness · 本地个人产品工作台' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: name, submenu: [
      { label: `关于${name}`, role: 'about' }, { type: 'separator' },
      { label: '模型设置…', accelerator: 'CmdOrCtrl+,', click: () => action('settings') },
      { label: '打开数据目录', click: () => { void shell.openPath(dataDir); } },
      { type: 'separator' }, { label: '隐藏工作台', role: 'hide' }, { label: '隐藏其他应用', role: 'hideOthers' }, { label: '显示全部', role: 'unhide' },
      { type: 'separator' }, { label: '退出工作台', role: 'quit' },
    ] },
    { label: '文件', submenu: [ { label: '新建产品项目…', accelerator: 'CmdOrCtrl+N', click: () => action('new-project') }, { label: '全部文档', click: () => action('all-documents') }, { type: 'separator' }, { label: '关闭窗口', role: 'close' } ] },
    { label: '编辑', submenu: [ { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' } ] },
    { label: '视图', submenu: [ { label: '重新加载', role: 'reload' }, { label: '实际大小', role: 'resetZoom' }, { label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { type: 'separator' }, { label: '进入全屏', role: 'togglefullscreen' } ] },
    { label: '窗口', submenu: [ { label: '最小化', role: 'minimize' }, { label: '缩放', role: 'zoom' }, { label: '显示工作台', click: () => { if (window) window.show(); else void createWindow(); } }, { role: 'front', label: '前置全部窗口' } ] },
    { label: '帮助', submenu: [ {label:'检查更新…',click:()=>{void Promise.resolve().then(()=>updater.check()).then(status=>dialog.showMessageBox(window,{message:'应用更新',detail:status.error||'请在设置页查看更新进度或配置更新服务。',buttons:['知道了']})).catch(error=>dialog.showMessageBox(window,{message:error.message,buttons:['知道了']}));}}, { label: '使用说明', click: () => { void dialog.showMessageBox(window, { type: 'info', message: '开始使用阿浩Thinking', detail: '1. 新建产品项目\n2. 模型设置：添加服务地址、模型 ID 与密钥，测试连接\n3. 选择任意模块并加入材料，或对话补充后确认\n4. 运行、查看版本并交接产物\n\n关闭窗口后任务继续；⌘Q 退出时停止服务。桌面项目数据通过 macOS 钥匙串加密，保存在 Application Support/AIPM Workbench。', buttons: ['知道了'] }); } }, { label: 'DeepSeek Harness 文档', click: () => { void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'); } } ] },
  ]));
}

async function stopHost() {
  updater?.close();
  dynamicReader?.close();
  if (!host || host.exitCode !== null || host.signalCode !== null) return;
  if (host.connected) host.send({ type: 'shutdown' });
  let timer;
  const graceful = await Promise.race([hostExited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 12000); })]);
  clearTimeout(timer);
  if (!graceful) {
    try { process.kill(-host.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const terminated = await Promise.race([hostExited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); })]);
    clearTimeout(timer);
    if (!terminated) { try { process.kill(-host.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } await hostExited; }
  }
}

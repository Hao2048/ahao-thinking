import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'deepseek-harness/apps/web/package.json'));
const { _electron }=require('playwright');
const bundle=process.env.AIPM_TEST_APP || join(root,'产品经理工作台/桌面安装包/好浩的产品工作台.app');
const executable=join(bundle,'Contents/MacOS/ProductWorkbench');
const dataDir=await mkdtemp(join(tmpdir(),'aipm-desktop-test-'));
const errors=[];const requests=[];let finishChat;
const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const request=JSON.parse(Buffer.concat(chunks));requests.push(request);
  const isChat=JSON.stringify(request.messages).includes('reply 必须为第一字段');
  if(isChat){
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk=content=>`data: ${JSON.stringify({id:'desktop-chat',object:'chat.completion.chunk',model:request.model,choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`;
    res.write(chunk('{"reply":"桌面实时第一段'));
    await new Promise(resolve=>finishChat=resolve);
    res.end(chunk('，已收到你的想法。","proposedInput":null,"question":{"title":"选择首发端","questions":[{"prompt":"先做哪端？","options":["电脑","手机"]}]}}')+`data: ${JSON.stringify({id:'desktop-chat',object:'chat.completion.chunk',model:request.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return;
  }
  const rawPrompt=request.messages.flatMap(m=>typeof m.content==='string'?[m.content]:Array.isArray(m.content)?m.content.filter(b=>b.type==='text').map(b=>b.text):[]).join('\n'),scope=JSON.parse(rawPrompt.match(/本轮文档任务（JSON）：([^\n]+)/)?.[1]||'null');
  const isPlan=JSON.stringify(request.messages).includes('本轮仅准备调研计划');
  const isPreflight=JSON.stringify(request.messages).includes('本轮只检查');
  const visualFixture='\n```chart\n'+JSON.stringify({schema:'pm-chart-v1',id:'desktop-chart',type:'bar',title:'桌面图表验收',evidenceStatus:'测试数据',sources:[{id:'test',title:'本地测试'}],data:[{name:'A',value:3,sourceIds:['test']},{name:'B',value:5,sourceIds:['test']}],encoding:{x:{field:'name',scale:'category',categories:['A','B'],label:'测试分类'},y:{field:'value',scale:'quantitative',label:'测试数值'}}})+'\n```\n```mermaid\ngraph LR\nA["想法<br/>宠物陪伴"]-->B[分析]\n```';
  const response=isPreflight?{sufficient:true,summary:'测试资料齐备',suggestions:[]}:isPlan?{questions:null,plan:{content:'# 桌面调研计划\n市场、用户、机会，结合上传材料；本次为受限分析。',queries:['AI宠物 用户需求']}}:{summary:'桌面端验收：材料已通过打包的 Harness 生成报告。',structuredData:{source:'desktop-test',market:'待验证'},documents:[...(scope?[scope.title]:['市场调研','用户画像','机会点与风险']).map(title=>({title,format:'markdown',content:'# '+title+'\n模拟测试资料，仅验证流程。'+visualFixture})),...(scope?[]:[{title:'桌面验证报告',format:'markdown',content:'# 桌面验证报告\n本测试使用模拟模型，仅验证独立应用的运行链路。'}])],openQuestions:['真实市场需求仍需调研。']};
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'desktop-test',object:'chat.completion.chunk',created:1,model:request.model,choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(response)},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'desktop-test',object:'chat.completion.chunk',created:1,model:request.model,choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
let desktop;let mainPage;
const env={...process.env,AIPM_DESKTOP_DATA_DIR:dataDir,AIPM_IMPORT_FROM:join(dataDir,'no-legacy'),AIPM_SKILL_ROOT:join(bundle,'Contents/Resources/skills'),AIPM_DESKTOP_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;
async function launch(){const application=await _electron.launch({executablePath:executable,env,timeout:30000});application.process().on('exit',(code,signal)=>console.log('Electron process exit',code,signal));application.process().stderr.on('data',data=>process.stderr.write(data));return application;}
try{
  desktop=await launch();
  const page=await desktop.firstWindow();mainPage=page;page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('heading',{name:'市场、用户与机会研究',level:1}).waitFor({timeout:30000});
  const packaged=await desktop.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),name:app.getName()}));
  assert.equal(packaged.packaged,true);assert.equal(packaged.name,'好浩的产品工作台');
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await page.evaluate(()=>window.aipmDesktop.platform),'darwin');
  const native=await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(native.nodeIntegration,false);assert.equal(native.contextIsolation,true);assert.equal(native.sandbox,true);
  await desktop.evaluate(({Menu})=>{const item=Menu.getApplicationMenu().items[1].submenu.items.find(item=>item.label.startsWith('新建'));item.click();});
  await page.locator('#project-form input').fill('Mac 桌面验收项目');await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open&&document.querySelector('#project-select').textContent.includes('Mac 桌面验收项目'));
  await page.getByRole('button',{name:'上传或填写',exact:true}).click();
  await page.locator('#input-form [name=ocr]').check();
  await page.locator('#input-form [name=file]').setInputFiles({name:'桌面OCR验收.pdf',mimeType:'application/pdf',buffer:await readFile(new URL('./fixtures/ocr-sample.pdf',import.meta.url))});
  await page.locator('.parse-status').filter({hasText:'提取完成'}).waitFor({timeout:30000});
  assert.match(await page.locator('#input-form [name=content]').inputValue(),/宠物陪伴/);
  assert.match(await page.locator('.parse-status').textContent(),/Apple Vision OCR/);
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  if(process.env.AIPM_TEST_LIVE_SEARCH==='1'){
    await page.getByRole('button',{name:'联网取材',exact:true}).click();
    await page.locator('#research-form [name=queries]').fill('DeepSeek official website');
    await page.getByRole('button',{name:'检索并读取网页',exact:true}).click();
    await page.getByText(/已抓取正文/).first().waitFor({timeout:120000});
    assert.ok(await page.locator('.source-card a').count());
    console.log('Installed keyless live search: '+await page.locator('.source-card a').allTextContents());
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  }
  if(process.env.AIPM_TEST_LIVE_WEB==='1'){
    await page.getByRole('button',{name:'联网取材',exact:true}).click();
    await page.locator('#research-form [name=dynamic]').check();
    await page.locator('#research-form [name=urls]').fill('https://docs.searxng.org/dev/search_api.html');
    await page.getByRole('button',{name:'检索并读取网页',exact:true}).click();
    await page.getByText(/已读取动态正文/).waitFor({timeout:60000});
    await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
    console.log('Packaged IPC dynamic public page passed');
  }
  await desktop.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.find(item=>item.label==='模型设置…').click());
  await page.getByRole('button',{name:'检查更新',exact:true}).click();
  await page.locator('#update-status').filter({hasText:'本地开发签名'}).waitFor();
  assert.equal(await page.locator('#model-form input:visible').count(),1);
  assert.equal(await page.locator('#model-advanced').getAttribute('open'),null);
  const codingPreset=process.env.AIPM_TEST_PROVIDER==='zhipu-coding';
  await page.locator('#model-form [name=provider]').selectOption(codingPreset?'zhipu-coding':'deepseek');
  await page.locator('#model-form [name=apiKey]').fill('desktop-preset-fixture-key');
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  const presetRow=page.locator('.model-row').filter({hasText:codingPreset?'智谱 / GLM Coding Plan':'DeepSeek'});
  await presetRow.getByRole('heading',{name:codingPreset?/GLM Coding Plan/:/DeepSeek/}).waitFor();
  assert.match(await presetRow.textContent(),codingPreset?/glm-5.3-flash/:/deepseek-v4-pro/);
  if(codingPreset)assert.match(await presetRow.textContent(),/open.bigmodel.cn\/api\/coding\/paas\/v4/);
  await presetRow.getByRole('button',{name:'移除',exact:true}).click();
  await page.getByRole('button',{name:'确认移除',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  console.log('Installed provider-and-key onboarding passed');
  await page.locator('#model-form [name=provider]').selectOption('custom');
  await page.locator('#model-form [name=name]').fill('桌面模拟模型');await page.locator('#model-form [name=model]').fill('desktop-test-model');await page.locator('#model-form [name=baseURL]').fill(`http://127.0.0.1:${provider.address().port}/v1`);await page.locator('#model-form [name=apiKey]').fill('desktop-private-test-key');
  await page.getByRole('button',{name:'保存连接',exact:true}).click();await page.getByRole('button',{name:'测试连接',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('连接成功'),{timeout:30000});
  await page.getByRole('button',{name:'返回工作台',exact:true}).click();await page.getByRole('button',{name:'上传或填写',exact:true}).click();
  await page.locator('#input-form [name=title]').fill('个人产品想法');await page.locator('#input-form [name=content]').fill('做手机和电脑同步的 AI 宠物陪伴。');await page.getByRole('button',{name:'加入当前模块',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'承接前序',exact:true}).count(),0);await page.locator('[data-research-mode=product]').click();await page.locator('#research-entry-form [name=core]').fill('桌面验收竞品');await page.getByRole('button',{name:'准备调研',exact:true}).click();await page.locator('#research-plan-form').waitFor({timeout:30000});await page.locator('#research-plan-form [name=limited]').check();await page.getByRole('button',{name:'确认计划并开始研究',exact:true}).click();await page.getByRole('button',{name:'打开文档',exact:true}).first().waitFor({timeout:30000});
  assert.equal(requests.at(-1).model,'desktop-test-model');
  await page.locator('.document-list button').filter({hasText:'市场调研'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.document-display .visual-canvas svg').length===2,{timeout:30000});
  assert.equal(await page.locator('.document-display .visual-status').first().textContent(),'测试数据');assert.ok((await page.locator('.document-display [data-visual=mermaid] svg').textContent()).includes('宠物陪伴'));console.log('Packaged offline ECharts and Mermaid passed');
  await page.locator('#chat-message').fill('验证桌面实时对话');await page.locator('#chat-message').press('Enter');
  await page.getByText('验证桌面实时对话',{exact:true}).waitFor();await page.getByText('桌面实时第一段',{exact:true}).waitFor({timeout:30000});
  assert.equal(await page.locator('#chat-send').isDisabled(),true);finishChat();
  await page.locator('#chat-question-modal[open]').waitFor();await page.getByRole('button',{name:'稍后回答'}).click();
  console.log('Packaged real Harness streaming and question popup passed');
  const persisted=await readFile(join(dataDir,'state.json'),'utf8');assert.equal(JSON.parse(persisted).storage,'macos-safe-storage');assert.ok(!persisted.includes('desktop-private-test-key'));assert.ok(!persisted.includes('Mac 桌面验收项目'));
  const port=new URL(page.url()).port;
  const shot=join(root,'产品经理工作台/原型截图/mac-desktop.png');await page.locator('#toast').evaluate(el=>el.style.display='none');await page.screenshot({path:shot});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  await desktop.evaluate(({app})=>app.emit('activate'));
  const reopened=await desktop.firstWindow();await reopened.getByRole('heading',{name:'市场、用户与机会研究',level:1}).waitFor();
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  assert.equal(new URL(reopened.url()).port,port);
  await desktop.close();desktop=undefined;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  desktop=await launch();const restored=await desktop.firstWindow();await restored.getByRole('heading',{name:'市场、用户与机会研究',level:1}).waitFor();
  if(await restored.locator('#chat-question-modal[open]').count())await restored.getByRole('button',{name:'稍后回答',exact:true}).click();
  await restored.locator('.document-list button').filter({hasText:'市场调研'}).click();assert.ok(await restored.getByRole('heading',{name:'市场调研',exact:true}).count());
  assert.ok(await restored.locator('#project-select').textContent().then(text=>text.includes('Mac 桌面验收项目')));
  await desktop.close();desktop=undefined;
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,packaged,checks:['打包应用独立启动','原生菜单','隔离渲染器','内置 Node/Harness','已签名的本机 OCR helper','真实钥匙串加密','窗口关闭/重开','退出释放端口','重启恢复项目与产物'],screenshot:shot}));
}catch(error){
  if(mainPage&&!mainPage.isClosed()){console.error(await mainPage.evaluate(()=>({toast:document.querySelector('#toast')?.textContent,heading:document.querySelector('h1')?.textContent,formValid:document.querySelector('#model-form')?.checkValidity()})));await mainPage.screenshot({path:join(root,'产品经理工作台/原型截图/mac-desktop-failure.png')});}
  try{console.error((await readFile(join(dataDir,'logs/desktop.log'),'utf8')).slice(-5000));}catch{}
  throw error;
}finally{if(desktop)await desktop.close();await new Promise(r=>provider.close(r));await rm(dataDir,{recursive:true,force:true});}

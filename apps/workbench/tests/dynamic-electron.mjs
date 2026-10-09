import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(join(root,'deepseek-harness/apps/desktop/package.json'));
const {_electron}=createRequire(join(root,'deepseek-harness/apps/web/package.json'))('playwright');
const dir=await mkdtemp(join(tmpdir(),'aipm-dynamic-'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let application;
try{
  application=await _electron.launch({executablePath:require('electron'),args:[fileURLToPath(new URL('./dynamic-fixture.cjs',import.meta.url)),`--user-data-dir=${dir}`],env});
  await application.firstWindow();
  const result=await application.evaluate(async()=>global.testDynamic());
  assert.match(result.page.content,/loaded by JavaScript/);assert.match(result.page.content,/undefined undefined/);
  assert.equal(result.page.method,'dynamic-render');assert.equal(result.page.status,'page');assert.equal(result.blocked,true);
  assert.ok(result.requests.includes('https://fixture.example/app.js'));assert.ok(result.requests.includes('https://fixture.example/data.json'));assert.ok(!result.requests.includes('https://fixture.example/write'));
  console.log(JSON.stringify({ok:true,checks:['真实 Electron 动态脚本与公开 JSON 渲染','无 Node 或工作台桥接','POST 被禁止','本机来源拒绝','来源与时间']}));
}finally{if(application)await application.close();await rm(dir,{recursive:true,force:true});}

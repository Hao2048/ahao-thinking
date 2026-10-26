import {mkdtemp,cp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startServer} from '/Users/penghao/Documents/AIProduct/AIProductControl/apps/workbench/src/server.mjs';
const root=await mkdtemp(join(tmpdir(),'ahao-ui-250-')),nodes=join(root,'nodes');await cp('/Users/penghao/Documents/AIProduct/AIProductControl/apps/workbench/nodes',nodes,{recursive:true});
await mkdir(join(nodes,'custom.files'));await writeFile(join(nodes,'custom.files/node.json'),JSON.stringify({schemaVersion:1,id:'custom.files',name:'双材料输入验收',version:'1.0.0',category:'input',executor:'file',inputs:[],outputs:[{id:'data',types:['materials']}],fields:[{key:'briefFiles',type:'file',label:'需求文档'},{key:'studyFiles',type:'file',label:'研究材料'}]}));
const bridge={async invoke(_m,p,_w,{signal,onDelta}={}){
 signal?.throwIfAborted();
 if(p.includes('本轮只做报告输入检查'))return{finalResponse:JSON.stringify({related:true,sufficient:true,missing:[],summary:'隔离验收材料匹配'})};
 if(p.includes('本轮只做输入充分性检查'))return{finalResponse:JSON.stringify({sufficient:true,summary:'验收材料完整',suggestions:[]})};
 if(p.includes('转换为完整自包含HTML')){await new Promise((resolve,reject)=>{const t=setTimeout(resolve,1500);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('已停止'))},{once:true});});return{finalResponse:JSON.stringify({html:'<!doctype html><html><body><h1>隔离验收文档</h1><p>按需展示，模型替身。</p></body></html>'})};}
 const match=p.match(/本轮文档任务（JSON）：(\{[^\n]+\})/),plan=match?JSON.parse(match[1]):{outline:'# 验收文档\n## 结论'};
 const content=plan.outline.split('\n').filter(l=>/^#/.test(l)).map(l=>l+'\n\n隔离验收数据：末步转化率{{fact:rows.1.cumulativeRate|percent}}；结论仍需结合真实业务核实。').join('\n\n');
 const out=JSON.stringify({summary:'## 核心结论\n- 末步转化率{{fact:rows.1.cumulativeRate|percent}}。\n## 证据局限\n- 使用合成样本。',structuredData:{rate:'{{fact:rows.1.cumulativeRate|percent}}'},documents:[{title:plan.title||'验收',format:'markdown',content}],openQuestions:[]});
 onDelta?.(out);return{finalResponse:out};
},async close(){}};
const app=await startServer({port:0,dataDir:join(root,'data'),nodeRoot:nodes,bridge});
await app.store.update(s=>{s.models=[{id:'fixture',name:'验收替身（不联网）',api:'openai-completions',baseURL:'http://localhost:1/v1',model:'fixture',apiKey:'fixture'}];s.settings.activeModelId='fixture';s.settings.appearance={theme:'dark'};s.projects=[{id:'qa',name:'v2.5 隔离验收',workflows:[{id:'flow',name:'统计→报告→导出验收',revision:1,nodeEpochs:{},messages:[],runs:[],graph:{nodes:[{id:'text',name:'合成数据',type:'input.text',x:80,y:180,config:{content:'step,users\n访问,1000\n付费,24'}},{id:'stats',name:'漏斗计算',type:'analysis.funnel',x:410,y:180,config:{outline:'# 漏斗解读\n## 核心结论\n## 证据局限\n## 下一步'}},{id:'report',type:'report.data',x:740,y:180,config:{outline:'# 数据报告\n## 核心结论\n## 证据局限\n## 下一步'}},{id:'files',type:'custom.files',x:80,y:480,config:{briefFiles:[{id:'a',title:'需求材料.txt',content:'需求材料',evidence:'material'}],studyFiles:[{id:'b',title:'研究笔记.txt',content:'研究材料',evidence:'material'}]}}],edges:[{id:'e1',from:'text',to:'stats',input:'materials',output:'data'},{id:'e2',from:'stats',to:'report',input:'materials',output:'data'}],groups:[]}}]}];});
console.log(JSON.stringify({url:app.url,root}));process.on('SIGTERM',async()=>{await app.close();process.exit();});

import {resolve,join} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeRegistry} from '../src/node-registry.mjs';
import {executeNode,NodeNeedsInput} from '../src/node-executors.mjs';
const root=resolve(import.meta.dirname,'../../..'),registry=new NodeRegistry(join(root,'apps/workbench/nodes'));
await registry.scan();if(registry.errors.length)throw Error(JSON.stringify(registry.errors));
const date='20261024',records=[];
const material={id:'test-material',title:'隔离验收样例',content:'测试项目：跨端宠物陪伴；测试用户：独处上班族。以下为人为构造材料，不是真实访谈或市场证据。已有方案：日常陪伴。目标、成本与指标待补。',evidence:'test_data'};
const blockers={
 'input.text':'三种研究模式仅为标签，尚无分模式追问、调研计划确认流程。',
 'input.file':'文件/OCR工具已存在，尚无业务字段映射和四类证据自动归档/逐条定位校验。',
 'input.web':'能实际搜索读取；缺多轮研究策略、来源覆盖/交叉验证/饱和度检查。本次用检索替身验证交接，不作联网质量验收。',
 'input.artifact':'已有产物引用可用；缺已确认需求/决策与研究假设的强制语义交接检查。',
 'analysis.market':'研究方法已写入；没有调研计划确认、自动补取证据、双源核验工具及研究专属验收器。',
 'analysis.user':'画像模板和逐章配图规则已迁入；缺每章证据/图表/置信度的专属自动检查器。',
 'analysis.opportunity':'机会/风险方法已迁入；缺逐条机会到证据的强制关联和条件风险检查器。',
 'analysis.demand':'聚类/情绪/词频是模型规则；尚无可复算统计、原话定位与聚类质量检查。',
 'analysis.initiation':'四类证据表、Kano和反方规则存在；没有独立证据提取/反方复核步骤和可恢复的阶段结果。',
 'analysis.mvp':'闭环和假设—功能—指标规则存在；缺逐项可追踪结构及核心假设覆盖检查器。',
 'analysis.prd':'专业方案规则存在；缺需求反向确认、章节裁剪批准和严格PRD专用校验器。',
 'analysis.prototype':'页面状态设计规则存在；缺可执行的浏览器逐页交互/PRD一致性检查。',
 'analysis.flow':'主线/异常/状态规则存在；缺真实Screen Flow、连线避障与几何零遮挡验收工具。',
 'analysis.tracking':'字典与事件规则存在；缺字典导入映射、snake_case/六列表和页面覆盖专属检查。',
 'analysis.acceptance':'四维验收设计规则存在；缺需求覆盖率、断言质量和未知规则的专属检查。',
 'analysis.funnel':'代码计算与输入口径检查可用；缺业务路径向导、分群/目标对比和专业解读质量验收。',
 'analysis.retention':'指定日留存计算可用；使用频次、活跃、渗透率等更广义使用分析尚未实现。',
 'analysis.ab':'二元/连续统计、区间和Holm计算可用；业务目标/护栏和实验设计质量仍未有专属检查。',
 'analysis.review':'复盘规则存在；缺目标—变更—数据—反馈—原因的结构化追踪和跨文档联动。',
 'report.research':'通用整理和材料检查可用；没有研究模板选择器、合并/拆分Word/PDF等交付。',
 'report.initiation':'报告职责已收紧且默认八章已修正；缺八节表格/原话/验证资源口径专用检查，飞书交付未实现。',
 'report.demand':'需求与PRD已区分；缺需求洞察成果到需求清单的覆盖、来源、优先级检查。',
 'report.mvp':'只整理已有MVP成果；缺范围/假设/指标等章节的任务专属完备性校验。',
 'report.prd':'默认章节已拆分；未集成原HTML模板、validate_prd、编辑器、复制含图、PRD/原型联动。',
 'report.prototype':'按需HTML入口存在；无专用页面hash/平铺装配、真实截图批量导出及交互验收工具。',
 'report.flow':'Mermaid可渲染；真实界面拼接Screen Flow和时序源码专用交付尚未实现。',
 'report.tracking':'只整理上游埋点方案；缺固定列、字典复用、事件命名和覆盖的专门验收。',
 'report.acceptance':'可生成清单；无专用三态操作、进度统计、筛选/保存和验收结果导出工具。',
 'report.data':'可整理计算结果与SVG图表；缺KPI/分群模板和报告数字与computed的逐值对账。',
 'report.iteration':'可整理迭代计划；缺产品决策交接包和PRD/原型/流程的同步检查。'
};
async function sample(d,mode='normal'){
 let calls=0,searchCalls=0;const config=Object.fromEntries(d.fields.filter(f=>f.default!==undefined).map(f=>[f.key,structuredClone(f.default)]));
 let upstream=[{kind:'materials',materials:[{...material}],documents:[],sources:[],assumptions:[],warnings:[]}];
 if(d.executor==='text')Object.assign(config,{content:material.content,evidence:'test_data'});
 if(d.executor==='file')config.files=[{...material,fileSource:{filename:'fixture.txt',sha256:'test-only',method:'fixture'}}];
 if(d.executor==='artifact')config.artifact='test-artifact';
 if(d.executor==='web')config.queries='隔离测试检索词';
 if(d.statistic==='funnel')upstream[0].materials=[{...material,content:'step,users\n访问,100\n注册,50\n付费,25'}];
 if(d.statistic==='retention'){upstream[0].materials=[{...material,content:'cohort,cohort_users,day,retained_users\n2026-10-01,100,1,40\n2026-10-01,100,7,20'}];config.options={days:[1,7],observationEnd:'2026-10-20'};}
 if(d.statistic==='ab')upstream[0].materials=[{...material,content:'variant,users,conversions\nA,100,20\nB,100,40'}];
 const runtime={async invoke(_model,prompt){calls++;
  if(prompt.includes('本轮只做报告输入检查'))return{finalResponse:JSON.stringify({related:mode!=='unrelated',sufficient:!['partial','unrelated'].includes(mode),missing:mode==='partial'?['指标基线与验证结果']:[],summary:'验收替身控制的判定，不代表真实模型相关性质量'})};
  if(prompt.includes('本轮只做输入充分性检查'))return{finalResponse:JSON.stringify({sufficient:mode!=='insufficient',suggestions:['补充证据和目标'],summary:'隔离样例材料检查'})};
  const task=JSON.parse(prompt.match(/本轮文档任务（JSON）：([^\n]+)/)?.[1]||'null');assert.ok(task,'生成器应下发具体文档任务');
  const content=task.outline.split('\n').map(line=>/^#{1,6}\s/.test(line)?line+'\n\n测试填充：根据传入测试材料整理，证据与未知项保持测试性质。\n':line).join('\n');
  return{events:[],finalResponse:JSON.stringify({summary:'## 验收样例\n- 测试数据，非真实产品结论',structuredData:{fixture:true},documents:[{title:task.title||d.name,format:'markdown',content}],openQuestions:[]})};
 }};
 const ctx={definition:d,node:{id:'test',name:d.name,config},upstream,runtime,connection:{id:'fixture'},workspace:'/tmp/no-real-model',onProgress:async()=>{},registry,signal:new AbortController().signal,artifacts:[{id:'test-artifact',title:'隔离历史产物',output:upstream[0]}],research:{async collect(_settings,request){searchCalls++;assert.ok(request.queries.length);return{sources:[{title:'检索替身来源',url:'https://example.invalid/test-only',content:'此数据来自测试替身，未请求互联网',status:'page',retrievedAt:'2026-10-24T00:00:00Z'}],failures:[]}}}};
 const out=await executeNode(ctx);assert.equal(out.kind,d.outputs[0].types[0]);
 if(d.category==='report'){assert.equal(out.quality.level,mode==='partial'?'partial':'complete');if(mode==='partial'){assert.match(out.documents[0].content,/信息不充分/);assert.ok(out.warnings.length);}}
 if(d.executor==='ai'||d.executor==='statistics')assert.ok(out.documents.length,'应生成文档');
 if(d.statistic==='funnel')assert.equal(out.computed.rows[2].cumulativeRate,.25);
 if(d.statistic==='retention')assert.equal(out.computed.rows[0].values[0].rate,.4);
 if(d.statistic==='ab')assert.ok(out.computed.pValue>=0&&out.computed.pValue<=1);
 if(d.executor==='web'){assert.equal(searchCalls,1);assert.equal(out.sources.length,1);assert.ok(out.materials.some(m=>/测试替身/.test(m.content)));}else assert.equal(searchCalls,0,'非联网节点不应调用检索服务');
 return{mode,status:'passed',modelCalls:calls,searchCalls,documents:out.documents.length,outputKind:out.kind};
}
for(const item of registry.catalog().nodes){
 const d=registry.snapshot(item.id),cases=[];
 try{cases.push(await sample(d));
  if(d.category==='report'){cases.push(await sample(d,'partial'));await assert.rejects(sample(d,'unrelated'),/不相关/);cases.push({mode:'unrelated',status:'passed',expected:'拒绝输出'});}
  else if(d.executor==='ai'){await assert.rejects(sample(d,'insufficient'),NodeNeedsInput);cases.push({mode:'insufficient',status:'passed',expected:'暂停并建议补充'});}
 }catch(error){cases.push({mode:'failure',status:'failed',error:error.message});}
 records.push({id:d.id,name:d.name,category:d.category,version:d.version,nodeHash:d.hash,workflowSteps:d.workflow?.length||0,rules:d.workflow?.length&&d.capabilities?'partial':'missing',tools:['text','file','artifact'].includes(d.executor)?'basic-ready':'partial',checks:'partial',samples:cases.every(c=>c.status==='passed')?'basic-passed':'failed',sampleCases:cases,blocker:blockers[d.id]||'需逐项核查',evidence:{definition:join('apps/workbench/nodes',d.id,'node.json'),instruction:d.instructions?join('apps/workbench/nodes',d.id,d.instructions):null},scope:'基础执行样例通过不代表专业语义/真实模型质量通过'});
}
const sources=['AI产品经理Skill/ai-product-manager-research/SKILL.md','pm-initiation-report/SKILL.md','edu-pm-workflow/SKILL.md'].map(rel=>join('/Users/penghao/Documents/Skills',rel));
const sourceHashes=await Promise.all(sources.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report={version:'2.4.0',reviewDate:'2026-10-24',method:'静态规则/代码检查 + 真实节点执行器的隔离样例；模型与检索为替身；未使用真实API Key/私人材料',sources:sourceHashes,total:records.length,totalCases:records.reduce((n,r)=>n+r.sampleCases.length,0),failed:records.filter(r=>r.samples==='failed').map(r=>r.id),professionalFullPass:0,records};
const directory=join(root,'产品经理工作台/开发文档');await mkdir(directory,{recursive:true});const file=join(directory,`节点能力四层验收-${date}.json`);await writeFile(file,JSON.stringify(report,null,2));
console.log(JSON.stringify({file,total:report.total,cases:report.totalCases,failed:report.failed,professionalFullPass:0},null,2));if(report.failed.length)process.exitCode=1;

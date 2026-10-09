import { resolveProvider } from './providers.mjs';
import { randomUUID } from 'node:crypto';
import { getModule } from './catalog.mjs';
import { datasetInput, parseCSV } from './analytics.mjs';

export const MAX_INPUT_BYTES = 512 * 1024;
export const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
export function text(value, label, limit = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label}不能为空，且不能超过 ${limit} 个字符`);
  return value.trim();
}
export function makeInput(body) {
  getModule(body.moduleId);
  const content = text(body.content, '材料内容', MAX_INPUT_BYTES);
  if (Buffer.byteLength(content) > MAX_INPUT_BYTES) throw new Error('材料超过 512 KB');
  if (!['user_statement', 'material', 'test_data', 'ai_hypothesis'].includes(body.evidence)) throw new Error('请选择材料性质');
  if (!['manual', 'file', 'chat'].includes(body.kind)) throw new Error('不支持的输入方式');
  return { id: randomUUID(), moduleId: body.moduleId, kind: body.kind, title: text(body.title, '材料标题'), content, evidence: body.evidence, createdAt: new Date().toISOString() };
}
export function validateModel(body) {
  body=resolveProvider(body);
  const api = body.api;
  if (!['openai-completions', 'anthropic-messages', 'deepseek-messages'].includes(api)) throw new Error('不支持的连接协议');
  const baseURL = text(body.baseURL, '服务地址', 2000);
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址需为 HTTP(S)，且不能包含账号、查询参数或片段');
  const apiKey = body.apiKey === undefined ? '' : text(body.apiKey, 'API 密钥', 8000);
  if (body.apiKey === undefined && !body.apiKeyEnv) throw new Error('请填写密钥或环境变量名称（无认证本地服务可填写占位密钥）');
  if (body.apiKeyEnv && !/^[A-Z][A-Z0-9_]{0,100}$/.test(body.apiKeyEnv)) throw new Error('密钥环境变量名称不合法');
  return { id: randomUUID(), provider:body.provider, name: text(body.name, '连接名称'), model: text(body.model, '模型 ID'), api, baseURL: baseURL.replace(/\/$/, ''), apiKey, ...(body.apiKeyEnv ? { apiKeyEnv: body.apiKeyEnv } : {}), createdAt: new Date().toISOString() };
}
export function publicModel(model) {
  const { apiKey, ...visible } = model;
  return { ...visible, configured: Boolean(apiKey || (model.apiKeyEnv && process.env[model.apiKeyEnv])) };
}
export function parseModelJson(response) {
  const stripped = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(stripped); } catch { throw new Error('模型没有返回有效 JSON，请调整材料后重试；旧版本已保留'); }
}
export function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('模型返回格式错误');
  const summary = text(result.summary, '结果摘要', 20000);
  if (!result.structuredData || typeof result.structuredData !== 'object' || Array.isArray(result.structuredData)) throw new Error('缺少结构化数据');
  if (!Array.isArray(result.documents) || !result.documents.length || result.documents.length > 12) throw new Error('模型未返回文档，或文档数超过限制');
  const documents = result.documents.map(doc => {
    if (!doc || !['markdown', 'html', 'json'].includes(doc.format)) throw new Error('文档格式不支持');
    const content = text(doc.content, '文档内容', 600000);
    if (doc.format === 'json') JSON.parse(content);
    return { id: randomUUID(), title: text(doc.title, '文档标题'), format: doc.format, content, ...(typeof doc.summary==='string'&&doc.summary.trim()?{summary:text(doc.summary,'文档摘要',20000)}:{}) };
  });
  const openQuestions = Array.isArray(result.openQuestions) ? result.openQuestions.map(item => text(item, '待验证问题', 2000)).slice(0, 50) : [];
  return { summary, structuredData: result.structuredData, documents, charts: [], openQuestions };
}

// This format represents already aggregated members of one declared cohort.
export function funnelFromInputs(inputs, options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('漏斗口径需为对象');
  const input = datasetInput(inputs,[['step','users'],['user_id','timestamp','event']]);
  if (!input) return undefined;
  const [header,...lines] = parseCSV(input.content);
  if(header.join(',')==='user_id,timestamp,event')return eventFunnel(input,lines,options);
  if (header.join(',').toLowerCase() !== 'step,users') throw new Error('漏斗数据表头应为 step,users（汇总人数）；原始事件日志需先整理');
  const rows = lines.map(values => {
    if (values.length !== 2 || !values[0] || !/^\d+$/.test(values[1])) throw new Error('CSV 每行应为步骤名称和非负整数人数');
    return { step: values[0], users: Number(values[1]) };
  });
  if (rows.length < 2 || rows.length > 30 || rows[0].users === 0 || new Set(rows.map(row => row.step)).size !== rows.length) throw new Error('漏斗需 2–30 个不重复步骤，首步人数大于 0');
  rows.forEach((row, index) => {
    if (!Number.isSafeInteger(row.users) || (index > 0 && row.users > rows[index - 1].users)) throw new Error('漏斗人数需安全整数且逐步不增加');
  });
  return { type: 'funnel', title: '转化漏斗', evidence: input.evidence, inputId: input.id, rows: rows.map((row, index) => ({ ...row, cumulativeRate: row.users / rows[0].users, stepRate: index === 0 ? 1 : rows[index - 1].users === 0 ? null : row.users / rows[index - 1].users })) };
}

function eventTime(value){
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
  if(!match)throw new Error('事件时间需带时区的 ISO 时间，例如 2026-10-01T10:00:00Z');
  const [year,month,day,hour,minute,second]=match.slice(1).map(Number),date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||hour>23||minute>59||second>59||!Number.isFinite(Date.parse(value)))throw new Error('事件日期或时间不存在');
  return Date.parse(value);
}
function eventFunnel(input,lines,options){
  const steps=options.steps,windowHours=Number(options.windowHours??24),end=eventTime(options.observationEnd||''),start=options.observationStart?eventTime(options.observationStart):-Infinity;
  if(!Array.isArray(steps)||steps.length<2||steps.length>12||steps.some(step=>typeof step!=='string'||!step.trim())||new Set(steps).size!==steps.length)throw new Error('事件漏斗需 2–12 个不同事件名称，按顺序填写');
  if(!Number.isFinite(windowHours)||windowHours<=0||windowHours>720||start>end)throw new Error('窗口应大于 0 且不超过 720 小时，开始时间不能晚于截至时间');
  const users=new Map(),seen=new Set(),windowMs=windowHours*3600000;
  for(const [id,timestamp,event]of lines){
    const time=eventTime(timestamp);if(!id||!event||time>end)throw new Error('用户/事件不能为空，事件不能晚于数据完整截至时间');
    const key=JSON.stringify([id,time,event]);if(seen.has(key))continue;seen.add(key);
    const list=users.get(id)||[];users.set(id,list);list.push({time,event});
  }
  const rows=steps.map(step=>({step,users:0}));let excludedImmatureUsers=0,usersWithoutEntry=0;
  for(const events of users.values()){
    events.sort((a,b)=>a.time-b.time);const entry=events.find(event=>event.event===steps[0]);
    if(!entry){usersWithoutEntry++;continue;}if(entry.time<start)continue;
    if(entry.time+windowMs>end){excludedImmatureUsers++;continue;}
    rows[0].users++;let previous=entry.time;
    for(let step=1;step<steps.length;step++){
      const next=events.find(event=>event.event===steps[step]&&event.time>previous&&event.time<=entry.time+windowMs);
      if(!next)break;rows[step].users++;previous=next.time;
    }
  }
  if(!rows[0].users)throw new Error('没有已完整观察转化窗口的首步用户，请调整截至时间或窗口');
  return{type:'funnel',title:'用户事件转化漏斗',evidence:input.evidence,inputId:input.id,definition:{method:'ordered-user-events',sourceFormat:input.sourceFormat,steps,windowHours,observationStart:options.observationStart||null,observationEnd:options.observationEnd,excludedImmatureUsers,usersWithoutEntry},rows:rows.map((row,index)=>({...row,cumulativeRate:row.users/rows[0].users,stepRate:index===0?1:rows[index-1].users===0?null:row.users/rows[index-1].users})),warnings:['每名用户仅按数据中首次首步事件进入，窗口内按严格递增时间完成顺序步骤；同一时刻事件不推断顺序。',`排除 ${excludedImmatureUsers} 名观察窗口未完整用户；重复事件去重，请确认原始事件覆盖完整。`]};
}

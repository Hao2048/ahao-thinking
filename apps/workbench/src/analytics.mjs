import { dependency } from './dependencies.mjs';

export function parseCSV(content) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  const source = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i+1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === '"' && !value && !closed) quoted = true;
    else if (char === ',' || char === '\n') {
      row.push(value.trim()); value = ''; closed = false;
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else {
      if (closed && !/\s/.test(char)) throw new Error('CSV 引号后有非法字符');
      value += char;
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2 || rows.length > 20001) throw new Error('CSV 需表头和数据，最多 20000 行');
  if (rows.some(row => row.length !== rows[0].length)) throw new Error('CSV 列数不一致');
  return rows;
}
export function datasetInput(inputs, schemas) {
  const files=[];
  for (const input of inputs) {
    const content=input.content.trim().replace(/^```(?:csv|json)?\s*\n/i,'').replace(/\n```$/,'');
    if (/\.csv$/i.test(input.title) || schemas.some(schema=>content.replace(/^\uFEFF/,'').split(/\r?\n/)[0]===schema.join(','))) { files.push({...input,content,sourceFormat:'csv'}); continue; }
    if (!/^[\[{]/.test(content)) continue;
    let value;try{value=JSON.parse(content);}catch{continue;}
    const records=Array.isArray(value)?value:value.events||value.rows||value.dataset?.rows||value.computedAB?.rows;
    if(!Array.isArray(records)||!records.length||!records[0]||typeof records[0]!=='object')continue;
    const schema=schemas.find(schema=>schema.every(key=>Object.hasOwn(records[0],key)));if(!schema)continue;
    const escape=value=>/[",\r\n]/.test(String(value))?`"${String(value).replaceAll('"','""')}"`:String(value);
    const rows=records.map(record=>{if(!record||schema.some(key=>!Object.hasOwn(record,key)||record[key]===null||typeof record[key]==='object'))throw new Error('JSON 数据行缺列或字段类型错误');return schema.map(key=>escape(record[key])).join(',');});
    files.push({...input,content:[schema.join(','),...rows].join('\n'),sourceFormat:'json',observationEnd:value.observationEnd});
  }
  if(!files.length)return undefined;
  if(files.length>1)throw new Error('一次指标计算请选择一份数据集，避免混合口径');
  return files[0];
}
function integer(value, label, max = 1000000000) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error(`${label}需为 0–${max} 的整数`);
  return Number(value);
}
const dayMs = 86400000;
function dateNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期应为 YYYY-MM-DD');
  const date = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0,10) !== value) throw new Error('日期不存在');
  return date / dayMs;
}
export function retentionFromInputs(inputs, options = {}) {
  const input = datasetInput(inputs,[['user_id','date','event'],['cohort','cohort_users','day','retained_users']]); if (!input) return undefined;
  const observationEnd=options.observationEnd||input.observationEnd||'';
  const end = dateNumber(observationEnd);
  const days = [...new Set(options.days || [1,7,30])].sort((a,b)=>a-b);
  if (!days.length || days.length>12 || days.some(day=>!Number.isInteger(day)||day<0||day>365)) throw new Error('最多 12 个留存天数，应为 0–365 的整数');
  const [header, ...data] = parseCSV(input.content);
  const cohorts = new Map(); const warnings = [];
  if (header.join(',') === 'user_id,date,event') {
    const signup = options.signupEvent || 'signup', active = options.activeEvent || 'active';
    if (signup === active) throw new Error('首次事件和回访事件不能相同');
    const users = new Map();
    for (const [id,date,event] of data) {
      const time = dateNumber(date); if (time > end) throw new Error('事件发生时间晚于数据截至日期');
      if (!id || !event) throw new Error('用户 ID 和事件不能为空');
      const user = users.get(id) || { start: Infinity, visits: new Set() }; users.set(id,user);
      if (event === signup) user.start = Math.min(user.start,time);
      if (event === active) user.visits.add(time);
    }
    for (const user of users.values()) {
      if (!Number.isFinite(user.start)) continue;
      const date = new Date(user.start * dayMs).toISOString().slice(0,10);
      const cohort = cohorts.get(date) || { cohort:date, start:user.start, users:0, counts:new Map() }; cohorts.set(date,cohort); cohort.users++;
      for (const day of days) if (day === 0 || user.visits.has(user.start + day)) cohort.counts.set(day,(cohort.counts.get(day)||0)+1);
    }
    for (const cohort of cohorts.values()) for (const day of days) if (!cohort.counts.has(day)) cohort.counts.set(day,0);
    warnings.push(`按首次 ${signup} 日期分组，按 UTC 自然日计算指定日 ${active} 留存；D0 代表首次事件。事件缺失会影响结果，请确认覆盖完整。`);
  } else if (header.join(',') === 'cohort,cohort_users,day,retained_users') {
    const seen = new Set();
    for (const [date,usersValue,dayValue,retainedValue] of data) {
      const start = dateNumber(date), users = integer(usersValue,'群人数'), day = integer(dayValue,'留存天数',365), retained = integer(retainedValue,'回访人数');
      if (start > end || !users || retained > users) throw new Error('群日期超出范围，或群人数/回访人数不合法');
      const key = `${date}:${day}`; if (seen.has(key)) throw new Error('同群同留存天数重复'); seen.add(key);
      const cohort = cohorts.get(date) || {cohort:date,start,users,counts:new Map()};
      if (cohort.users !== users) throw new Error('同群人数不一致');
      cohort.counts.set(day,retained); cohorts.set(date,cohort);
    }
    warnings.push('使用提供的同群汇总人数；缺少的成熟日期记为缺数据，未成熟日期不计入分母。');
  } else throw new Error('留存 CSV 表头应为 user_id,date,event 或 cohort,cohort_users,day,retained_users');
  if (!cohorts.size) throw new Error('未找到首次事件或有效用户群');
  if (cohorts.size>366) throw new Error('超过 366 个用户群，请缩小日期范围');
  const rows = [...cohorts.values()].sort((a,b)=>a.start-b.start).map(cohort=>({cohort:cohort.cohort,users:cohort.users,values:days.map(day=>{
    const mature = cohort.start + day <= end;
    const retained = mature && cohort.counts.has(day) ? cohort.counts.get(day) : null;
    return {day,mature,retained,rate:retained === null ? null : retained/cohort.users};
  })}));
  return {type:'retention',title:'指定日留存',evidence:input.evidence,inputId:input.id,observationEnd,definition:{format:header.join(','),sourceFormat:input.sourceFormat,timeZone:'UTC',method:'exact-day',signupEvent:options.signupEvent||'signup',activeEvent:options.activeEvent||'active'},days,rows,summary:days.map(day=>{
    let eligibleUsers=0,retained=0,missingCohorts=0;
    for (const row of rows) {const cell=row.values.find(value=>value.day===day);if(cell.mature&&cell.retained!==null){eligibleUsers+=row.users;retained+=cell.retained;}else if(cell.mature)missingCohorts++;}
    return {day,eligibleUsers,retained,rate:eligibleUsers?retained/eligibleUsers:null,missingCohorts};
  }),warnings};
}
function normalCDF(value) {
  const x = Math.abs(value), t = 1/(1+0.2316419*x);
  const tail = Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return value >= 0 ? 1-tail : tail;
}
function wilson(successes,n) {
  const p=successes/n,z=1.959963984540054,z2=z*z,den=1+z2/n;
  const center=(p+z2/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
function binaryPair(inputs, options = {}) {
  const input=datasetInput(inputs,[['variant','users','conversions']]);if(!input)return undefined;
  const [header,...data]=parseCSV(input.content);
  if(header.join(',')!=='variant,users,conversions'||data.length!==2)throw new Error('A/B CSV 表头应为 variant,users,conversions，且恰好两组');
  const rows=data.map(([variant,usersValue,conversionsValue])=>{
    const users=integer(usersValue,'样本人数'),conversions=integer(conversionsValue,'转化人数');
    if(!variant||!users||conversions>users)throw new Error('组名不能为空，样本大于 0，转化人数不超过样本');
    return {variant,users,conversions,rate:conversions/users,confidenceInterval:wilson(conversions,users)};
  });
  if(rows[0].variant===rows[1].variant)throw new Error('A/B 两组名称不能相同');
  const control=rows.find(row=>row.variant===(options.control||rows[0].variant));if(!control)throw new Error('对照组名称不在数据中');
  const treatment=rows.find(row=>row!==control);
  const difference=treatment.rate-control.rate;
  const interval=[difference-Math.hypot(treatment.rate-treatment.confidenceInterval[0],control.confidenceInterval[1]-control.rate),difference+Math.hypot(treatment.confidenceInterval[1]-treatment.rate,control.rate-control.confidenceInterval[0])];
  const pooled=(control.conversions+treatment.conversions)/(control.users+treatment.users);
  const eligible=rows.every(row=>row.users*pooled>=5&&row.users*(1-pooled)>=5);
  const se=Math.sqrt(pooled*(1-pooled)*(1/control.users+1/treatment.users));
  const pValue=eligible&&se>0?Math.min(1,Math.max(0,2*(1-normalCDF(Math.abs(difference/se))))):null;
  return {type:'ab',title:'二元转化 A/B 分析',evidence:input.evidence,inputId:input.id,control:control.variant,treatment:treatment.variant,rows,difference,relativeLift:control.rate?difference/control.rate:null,confidenceLevel:0.95,differenceInterval:interval,pValue,significant:pValue===null?null:pValue<0.05,method:'双侧两独立比例 pooled z 检验；Wilson 分组区间、Newcombe 差值区间',warnings:[...(pValue===null?['期望频数不足，不输出近似检验 p 值；需扩大样本或采用精确检验。']:[]),'仅适用于每名用户一次二元转化、独立且随机分组的固定样本；不适用于收入均值、多组实验或反复偷看结果。','未显著不代表无差异；统计显著不等于业务收益，需结合实验设计和最小业务效果。']};
}
export function holmAdjust(comparisons) {
  // Count all planned comparisons, including those with insufficient data.
  const ordered=comparisons.map((value,index)=>({value,index})).filter(item=>item.value.pValue!==null).sort((a,b)=>a.value.pValue-b.value.pValue);
  let previous=0;const adjusted=comparisons.map(value=>({...value,adjustedPValue:null,significant:null}));
  for(let rank=0;rank<ordered.length;rank++){
    const {value,index}=ordered[rank];previous=Math.min(1,Math.max(previous,value.pValue*(comparisons.length-rank)));
    adjusted[index]={...value,adjustedPValue:previous,significant:previous<0.05};
  }
  return adjusted;
}
const abSchemas=[['variant','users','conversions'],['variant','users','mean','stddev'],['variant','user_id','value']];
export function abFromInputs(inputs, options = {}) {
  const input=datasetInput(inputs,abSchemas);if(!input)return undefined;
  const [header,...data]=parseCSV(input.content);const format=header.join(',');
  let rows;
  if(format==='variant,users,conversions'){
    if(data.length<2||data.length>6)throw new Error('转化实验支持 2–6 组');
    rows=data.map(([variant,n,c])=>{const users=integer(n,'样本人数'),conversions=integer(c,'转化人数');if(!variant||!users||conversions>users)throw new Error('组名不能为空，样本大于 0，转化人数不超过样本');return{variant,users,conversions,rate:conversions/users,confidenceInterval:wilson(conversions,users)};});
  }else if(format==='variant,users,mean,stddev'){
    rows=data.map(([variant,n,m,s])=>{
      const users=integer(n,'样本人数'),mean=Number(m),stddev=Number(s);
      if(!variant||users<2||!m||!s||!Number.isFinite(mean)||!Number.isFinite(stddev)||stddev<0||Math.abs(mean)>1e12||stddev>1e12)throw new Error('连续指标需有效组名、至少 2 个样本、有限均值及非负样本标准差，数值绝对值不超过 1e12');
      return{variant,users,mean,stddev};
    });
  }else if(format==='variant,user_id,value'){
    const groups=new Map(),seen=new Set();
    for(const [variant,id,v]of data){
      const value=Number(v);if(!variant||!id||seen.has(id)||!v||!Number.isFinite(value)||Math.abs(value)>1e12)throw new Error('原始连续指标需有效组名、全局唯一用户 ID 和有限数值（绝对值不超过 1e12）');seen.add(id);
      const group=groups.get(variant)||{variant,users:0,mean:0,m2:0};groups.set(variant,group);
      group.users++;const delta=value-group.mean;group.mean+=delta/group.users;group.m2+=delta*(value-group.mean);
    }
    rows=[...groups.values()].map(({m2,...group})=>{if(group.users<2)throw new Error('每组至少 2 个独立用户样本');return{...group,stddev:Math.sqrt(Math.max(0,m2/(group.users-1)))};});
  }else throw new Error('实验表头不支持，请使用转化、连续指标汇总或用户级数值格式');
  if(rows.length<2||rows.length>6||new Set(rows.map(row=>row.variant)).size!==rows.length)throw new Error('实验支持 2–6 组，组名不能相同');
  const control=rows.find(row=>row.variant===(options.control||rows[0].variant));if(!control)throw new Error('对照组名称不在数据中');
  const treatments=rows.filter(row=>row!==control);
  if(format==='variant,users,conversions'){
    const pair=treatment=>binaryPair([{...input,title:'comparison.csv',content:`variant,users,conversions\n${[control,treatment].map(row=>[row.variant,row.users,row.conversions].map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\n')}`}],{control:control.variant});
    const results=treatments.map(pair);
    if(results.length===1)return{...results[0],metric:'binary',sourceFormat:input.sourceFormat};
    const comparisons=holmAdjust(results.map(result=>({treatment:result.treatment,difference:result.difference,relativeLift:result.relativeLift,differenceInterval:result.differenceInterval,pValue:result.pValue})));
    return{...results[0],title:'多组转化实验分析',rows,metric:'binary',comparisons,multipleTesting:'Holm（各实验组对同一对照组）',sourceFormat:input.sourceFormat,pValue:null,significant:null,warnings:[...new Set(results.flatMap(result=>result.warnings))].filter(value=>!value.includes('多组实验')).concat(['仅适用于独立随机分组、每名用户一次二元转化的固定样本。','差值区间为单次比较区间，多组决策使用 Holm 校正 p 值。']),familyAlpha:0.05};
  }
  const {jStat}=dependency('jstat');
  const raw=treatments.map(treatment=>{
    const a=control.stddev**2/control.users,b=treatment.stddev**2/treatment.users,se=Math.sqrt(a+b),difference=treatment.mean-control.mean;
    const degreesOfFreedom=se>0?(a+b)**2/(a*a/(control.users-1)+b*b/(treatment.users-1)):null;
    const critical=degreesOfFreedom?jStat.studentt.inv(0.975,degreesOfFreedom):null;
    const pValue=degreesOfFreedom?Math.max(0,Math.min(1,2*jStat.studentt.cdf(-Math.abs(difference/se),degreesOfFreedom))):null;
    return{treatment:treatment.variant,difference,relativeLift:control.mean===0?null:difference/control.mean,standardError:se,degreesOfFreedom,pValue,differenceInterval:critical===null?null:[difference-critical*se,difference+critical*se]};
  });
  const comparisons=holmAdjust(raw);
  return{type:'ab',title:'连续指标实验分析',metric:'continuous',evidence:input.evidence,inputId:input.id,sourceFormat:input.sourceFormat,control:control.variant,treatment:treatments[0].variant,rows,comparisons,confidenceLevel:0.95,familyAlpha:0.05,multipleTesting:comparisons.length>1?'Holm（各实验组对同一对照组）':'单次比较',method:'Welch 两独立样本 t 检验；差值 95% t 区间',...comparisons[0],warnings:['使用样本标准差（ddof=1）；适用于独立随机分组、每名用户一个观测值的固定样本，不能作为序贯实验检验。','重尾收入、极小样本或异常值可能影响均值与推断，需检查分布与实验设计。','零标准误不提供显著性结论；组间差值区间为单次比较区间，多组决策使用 Holm 校正 p 值。','统计显著不等于业务收益。']};
}
export function computedAnalysis(moduleId,inputs,options) {
  options ||= {};
  if(typeof options!=='object'||Array.isArray(options))throw new Error('计算口径需为对象');
  if(moduleId==='retention')return retentionFromInputs(inputs,options);
  if(moduleId==='ab')return abFromInputs(inputs,options);
}

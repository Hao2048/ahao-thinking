import {taskContext} from "./workflow-context.mjs";
// Shared by the configuration panel and executor: task context is not evidence.
export const usesDownstream = definition => definition?.executor === 'web' || definition?.contextPolicy?.downstream === true;
const lines=value=>String(value||'').split('\n').map(s=>s.trim()).filter(Boolean);
export function downstreamTargets(graph,nodeId,definitions){
  const get=type=>Array.isArray(definitions)?definitions.find(d=>d.id===type):definitions[type];
  const groups=new Map();
  for(const edge of graph.edges.filter(e=>e.from===nodeId)){
    const n=graph.nodes.find(n=>n.id===edge.to);if(!n)continue;
    const d=get(n.type),defaults=Object.fromEntries((d?.fields||[]).filter(f=>f.default!==undefined).map(f=>[f.key,f.default]));
    if(!groups.has(n.id))groups.set(n.id,{id:n.id,type:n.type,name:n.name||d?.name||n.type,available:!!d,taskContext:taskContext(graph,n.id),category:d?.category||'',ruleHash:d?.hash||'',task:String(n.config.task||defaults.task||d?.description||'按节点规则处理输入').slice(0,4000),requirements:(d?.requirements||[]).filter(s=>typeof s==='string').slice(0,20),outline:String(n.config.outline??defaults.outline??'').slice(0,12000),ports:[]});
    const target=groups.get(n.id),port={output:edge.output,input:edge.input};
    if(!target.ports.some(p=>p.output===port.output&&p.input===port.input))target.ports.push(port);
  }
  return [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(t=>({...t,ports:t.ports.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));
}
export const researchTopic=(config,context)=>String(config.topic||'').trim()||String(context?.content||'').trim().slice(0,600);
export const intentSignature=(topic,targets,context=null)=>JSON.stringify({topic:String(topic||'').trim(),targets,...context?{taskContext:context}:{}});
export function searchPlanState(config,targets,context=null){
  if(!config.searchPlan)return 'manual';
  return config.searchPlan.contextSignature===intentSignature(researchTopic(config,context),targets,context)&&JSON.stringify((Array.isArray(config.searchPlan.queries)?config.searchPlan.queries:[]).map(q=>q.query))===JSON.stringify(lines(config.queries))?'current':'stale';
}
export function validateSearchPlan(plan,targets){
  if(!plan||!Array.isArray(plan.queries)||!plan.queries.length||plan.queries.length>3)throw new Error('检索计划需包含1–3条检索词');
  const ids=new Set(targets.map(t=>t.id)),covered=new Set(),seen=new Set();
  const queries=plan.queries.map(q=>{
    if(!q||typeof q.query!=='string'||!q.query.trim()||q.query.length>600||/[\r\n]/.test(q.query))throw new Error('每条检索词应为一行，且不超过600个字符');
    const query=q.query.trim();if(seen.has(query))throw new Error('检索词重复，请合并');seen.add(query);
    if(!Array.isArray(q.targetIds)||q.targetIds.some(id=>!ids.has(id)))throw new Error('检索计划引用了未连接的下游节点');
    const targetIds=[...new Set(q.targetIds)];for(const id of targetIds)covered.add(id);
    return {query,targetIds};
  });
  if([...ids].some(id=>!covered.has(id)))throw new Error('检索计划未覆盖全部已连接的下游方向');
  return {queries};
}

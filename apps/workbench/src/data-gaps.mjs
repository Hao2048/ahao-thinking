import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const gapInstructions=`先检查现有材料、起点背景与用户已确认记录，已回答的问题不能重复列为缺口。按当前阶段和本次任务确定最低要求，不把默认大纲每节都当必填。未上线产品的真实留存/渠道成本是未来验证项。缺口分类：public=可公开检索的外部资料；decision=用户产品决策；evidence=需访谈、问卷、内部行为数据或实验验证；not_applicable=本阶段不适用。绝不把真实留存/付费意愿当可检索事实，不替用户确认范围。每项返回 {title,type,impact,required:boolean,query:"仅public可填写公开检索词"}。最多12项，合并重复问题。可选细节只列为建议，不阻塞生成。`;
export function normalizeGaps(check){
 const raw=Array.isArray(check.gaps)?check.gaps:(check.missing||check.suggestions||[]).map(title=>({title,type:'evidence',required:true}));
 return [...new Map(raw.filter(g=>typeof g?.title==='string'&&g.title.trim()).map(g=>{
 const type=['public','decision','evidence','not_applicable'].includes(g.type)?g.type:'evidence';
 const gap={title:g.title.trim().slice(0,500),type,impact:String(g.impact||'影响当前节点结论或章节').slice(0,500),required:g.required!==false&&type!=='not_applicable',query:type==='public'?String(g.query||'').trim().slice(0,200):''};
 return [hash(gap.title),{...gap,id:hash([type,gap.title]).slice(0,16)}];
 })).values()].slice(0,12);
}
export function ancestors(graph,id){const ids=new Set();function walk(n){for(const e of graph.edges.filter(e=>e.to===n))if(!ids.has(e.from)){ids.add(e.from);walk(e.from);}}walk(id);return ids;}
export function affectedNodes(graph,id){return graph.nodes.filter(n=>n.id===id||ancestors(graph,n.id).has(id)).map(n=>n.id);}
export function repairTargets(run,id){return [...ancestors(run.graph,id)].filter(nid=>run.nodes[nid]?.definition.executor==='web').map(nid=>({id:nid,name:run.graph.nodes.find(n=>n.id===nid).name||run.nodes[nid].definition.name}));}
export function confirmationScope(graph,id){const start=graph.nodes.find(n=>n.type==='input.start');const node=graph.nodes.find(n=>n.id===id);return hash([node?.type,node?.config?.task||'',node?.config?.outline||'',start?.config?.content||graph.nodes.filter(n=>ancestors(graph,id).has(n.id)&&n.type==='input.text').map(n=>n.config.content)]);}
export function confirmationsFor(flow,graph,id){const permitted=ancestors(graph,id);permitted.add(id);return (flow.confirmations||[]).filter(c=>permitted.has(c.nodeId)&&c.scope===confirmationScope(graph,c.nodeId)).slice(-60);}
export function validateGapAnswers(review,answers){
 if(!Array.isArray(answers)||!answers.length||answers.length>12)throw Error('请填写或选择要处理的缺口');
 const seen=new Set();return answers.map(a=>{const gap=review.gaps.find(g=>g.id===a.id);if(!gap||seen.has(a.id))throw Error('缺口已变化或重复');seen.add(a.id);
 if(!['confirmed','pending','not_applicable'].includes(a.status))throw Error('缺口处理方式无效');
 const text=String(a.text||'').trim();if(!text||text.length>4000)throw Error('请填写补充内容或处理理由（最多4000字）');
 // A user can provide evidence; a decision is never promoted to measured fact.
 return {gapId:gap.id,title:gap.title,type:gap.type,status:a.status,text,evidence:'user_statement'};
 });
}

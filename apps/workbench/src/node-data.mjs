import {createHash, randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function collectMaterials(upstream) {
  const list=[];
  for(const packet of upstream){
    const source={quality:packet.quality,handoff:packet.handoff,references:packet.sources||[],fileReferences:packet.fileReferences||[],assumptions:packet.assumptions||[]};
    list.push(...packet.materials||[]);
    for(const doc of packet.documents||[])list.push({id:doc.id||randomUUID(),title:doc.title,content:doc.content,evidence:'material',source:{...source,documentId:doc.id,quality:doc.quality||packet.quality}});
    if(packet.analysis || packet.computed || packet.handoff || packet.quality){
      const content=JSON.stringify({analysis:packet.analysis,computed:packet.computed,handoff:packet.handoff,quality:packet.quality,openQuestions:packet.openQuestions||[]});
      list.push({id:'structured:'+hash(content),title:'上游结构化成果与证据边界',content,evidence:'analysis',source});
    }
  }
  return [...new Map(list.map(m=>[hash([m.id||null,m.title,m.content,m.evidence,m.source]),m])).values()];
}
export function routeUpstream(graph,nodes,id){
  return graph.edges.filter(e=>e.to===id).map(edge=>{
    const step=nodes[edge.from];
    if(step?.status!=='succeeded')throw new Error('上游尚未成功，不能使用旧结果');
    const packet=step.output.ports ? step.output.ports[edge.output] : step.output;
    if(!packet)throw new Error('上游没有返回已连接端口的数据：'+edge.output);
    return {...packet,inputPort:edge.input,outputPort:edge.output,sourceNodeId:edge.from};
  });
}
export function contextKey(graph,id,epochs={}){
  const memo=new Map();
  function visit(id){
    if(memo.has(id))return memo.get(id);
    const n=graph.nodes.find(n=>n.id===id);if(!n)return null;
    const key=hash({type:n.type,config:n.config,epoch:epochs[id]||0,inputs:graph.edges.filter(e=>e.to===id).map(e=>({from:e.from,input:e.input,output:e.output,key:visit(e.from)}))});
    memo.set(id,key);return key;
  }return visit(id);
}
export function currentOutput(flow,id,registry){
  const key=contextKey(flow.graph,id,flow.nodeEpochs);if(!key)return null;
  for(const run of [...flow.runs].reverse()){
    const step=run.nodes?.[id];if(!step)continue;
    if(contextKey(run.graph,id,run.nodeEpochs)!==key)continue;
    if(step.status!=='succeeded'||!step.output)return null;
    const relevant=run.graph.nodes;
    const installed=registry.get(flow.graph.nodes.find(n=>n.id===id).type);
    if(step.definition?.hash!==installed.hash)continue;
    // Ancestor keys capture configuration/epoch changes; rule changes also invalidate context.
    const ancestors=new Set();function visit(nid){for(const e of run.graph.edges.filter(e=>e.to===nid)){ancestors.add(e.from);visit(e.from);}}visit(id);
    if(relevant.some(n=>ancestors.has(n.id)&&run.nodes[n.id]?.definition?.hash!==registry.get(n.type).hash))continue;
    return step.output;
  }
  return null;
}

export function inheritedComputation(upstream){
  const unique=[...new Map(upstream.filter(p=>p.computed).map(p=>[hash(p.computed),{sourceNodeId:p.sourceNodeId||null,...p.computed}])).values()];
  return unique.length>1?{type:'combined',title:'多来源计算结果',datasets:unique}:unique[0]||null;
}

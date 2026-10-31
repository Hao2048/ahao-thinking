// Task background follows graph ancestry, separate from evidence and node chat.
export function workflowStart(graph) {
  if(graph.startNodeId)return graph.nodes.find(n=>n.id===graph.startNodeId&&['input.start','input.text'].includes(n.type))||null;
  const starts=graph.nodes.filter(n=>n.type==='input.start');
  if(starts.length===1)return starts[0];
  const roots=graph.nodes.filter(n=>n.type==='input.text'&&!graph.edges.some(e=>e.to===n.id));
  return starts.length===0&&roots.length===1?roots[0]:null;
}
export function taskContext(graph,id){
  const start=workflowStart(graph);if(!start)return null;
  const seen=new Set();function reaches(n){if(n===start.id)return true;if(seen.has(n))return false;seen.add(n);return graph.edges.filter(e=>e.to===n).some(e=>reaches(e.from));}
  if(!reaches(id))return null;
  return {startNodeId:start.id,title:start.name||'开始节点',content:String(start.config.content||''),evidence:'user_statement'};
}
export function validateWorkflowStart(graph,order,definitions){
  if(graph.contextPolicy!=='start-required-v1')return; // Existing workflows remain editable and executable until explicitly upgraded.
  const start=workflowStart(graph);
  if(!start)throw new Error('请添加或指定一个开始节点（文字输入）');
  if(graph.nodes.filter(n=>n.type==='input.start').length>1)throw new Error('每个工作流只允许一个开始节点');
  if(graph.edges.some(e=>e.to===start.id))throw new Error('开始节点不能连接前置节点');
  if(!String(start.config.content||'').trim())throw new Error('请先在开始节点填写项目方向与本次任务');
  for(const id of order){const n=graph.nodes.find(n=>n.id===id);if(id!==start.id&&(n.type==='input.start'||definitions[id]?.category!=='input'||definitions[id]?.executor==='web')&&!taskContext(graph,id))throw new Error((n.name||n.type)+'尚未连接到开始节点，请补充连线');}
}

// System-owned start: one per workflow. Legacy extra starts become supplemental text,
// preserving their material and connections instead of discarding user content.
export function fixedStartGraph(graph){
  const g=structuredClone(graph),existing=workflowStart(g);
  let start=existing||g.nodes.find(n=>n.type==='input.start');
  if(!start){let id='start';while(g.nodes.some(n=>n.id===id))id+='-root';start={id,type:'input.start',name:'开始节点',x:60,y:180,config:{content:''}};g.nodes.unshift(start);}
  start.type='input.start';start.name='开始节点';delete start.color;
  for(const n of g.nodes)if(n.id!==start.id&&n.type==='input.start'){n.type='input.text';n.name=n.name==='开始节点'?'补充文字材料':n.name;}
  g.edges=g.edges.filter(e=>e.to!==start.id);
  g.startNodeId=start.id;g.contextPolicy='start-required-v1';g.fixedStart=true;
  return g;
}
export function assertFixedStart(oldGraph,next){
  if(!oldGraph.fixedStart)return;
  const start=workflowStart(oldGraph),starts=next.nodes.filter(n=>n.type==='input.start');
  if(!start||starts.length!==1||starts[0].id!==start.id||next.startNodeId!==start.id||!next.fixedStart||next.contextPolicy!=='start-required-v1'||next.edges.some(e=>e.to===start.id))throw new Error('开始节点由系统固定创建，不能新增、删除、替换或更改起点');
}
export function templateWithStart(graph,current){
  const g=fixedStartGraph(graph),old=workflowStart(current),start=workflowStart(g);
  if(old&&start.id!==old.id){const before=start.id;if(g.nodes.some(n=>n.id===old.id))throw new Error('模板节点编号与开始节点冲突');start.id=old.id;g.startNodeId=old.id;for(const e of g.edges){if(e.from===before)e.from=old.id;if(e.to===before)e.to=old.id;}for(const group of g.groups||[])group.members=group.members.map(id=>id===before?old.id:id);}
  return g;
}

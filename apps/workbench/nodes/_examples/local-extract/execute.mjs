export async function execute({config,inputs,signal,emitProgress}) {
  if(signal.aborted)throw new Error('已停止');
  await emitProgress({label:'正在按固定规则提取首行'});
  const rows=inputs.map(item=>({title:item.title,firstLine:item.content.split(/\r?\n/).find(s=>s.trim())||'（空）'}));
  return {kind:'analysis',summary:`## 核心结论\n- 提取了 ${rows.length} 份材料的首行。\n\n## 证据局限\n- 这是规则提取，不是AI研究结论。`,materials:[],documents:[{title:config.title||'材料首行摘要',format:'markdown',content:'# 材料首行摘要\n\n'+rows.map(r=>`- ${r.title}：${r.firstLine}`).join('\n')}],analysis:{rows}};
}

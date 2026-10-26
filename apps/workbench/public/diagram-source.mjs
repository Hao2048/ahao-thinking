// Theme/config directives are ignored. The host owns all Mermaid security/theme settings.
export function mermaidSource(value) {
  const source=String(value).replace(/%%\{[\s\S]*?\}%%/g,'').trim();
  if(source.length>100000)throw new Error('流程图源码过长，请拆分图表');
  if(/%%\s*\{|^\s*---|\bclick\s|<\s*(?:script|iframe|img|style)/im.test(source))throw new Error('流程图包含不支持的交互或配置，请使用纯 Mermaid 源码');
  if(!/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart)\b/.test(source))throw new Error('流程图缺少有效的 Mermaid 图种声明');
  return source;
}
export function normalizeDocumentDiagrams(content) {
  return String(content).replace(/^```mermaid[^\S\r\n]*\r?\n([\s\S]*?)^```/gm,(block,source)=>{
    try{return '```mermaid\n'+mermaidSource(source)+'\n```';}catch{return block;}
  });
}

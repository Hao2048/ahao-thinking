// A summary is always scoped to one document; never fall back to project/run text.
const sentences=s=>String(s).split(/(?<=[。！？])\s*/).map(s=>s.trim()).filter(Boolean);
export function formatSummary(text){
 const lines=String(text||'').split(/\r?\n/),out=[];
 for(const line of lines){const t=line.trim();if(!t){out.push('');continue;}if(/^#{1,6}\s|^[-*]\s|^\d+[.、]\s/.test(t)){out.push(t);continue;}out.push(...sentences(t).map(s=>'- '+s));}
 return out.join('\n');
}
function sections(doc){
 let content=String(doc.content||'');if(doc.format==='html')content=content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,'\n');
 content=content.replace(/```[\s\S]*?```/g,'');
 const groups=[];let section=null,header;
 for(const raw of content.split('\n')){
  const line=raw.trim(),heading=line.match(/^#{1,6}\s+(.+)/);
  if(heading){section={title:heading[1],lines:[]};groups.push(section);header=null;continue;}
  if(!line||/^>/.test(line)||/^(?:图表|\*\*图表)/.test(line))continue;
  if(!section){section={title:'文档要点',lines:[]};groups.push(section);}
  if(line.includes('|')){
   const cells=line.replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
   if(cells.every(x=>/^:?-+:?$/.test(x)))continue;
   if(!header){header=cells;continue;}
   section.lines.push(cells.map((v,i)=>i===0?v:`${header[i]||'值'}：${v}`).join('；'));continue;
  }
  header=null;section.lines.push(line);
 }
 return groups;
}
export function documentSummary(doc){
 if(!doc)return '暂无选中文档。';
 const groups=sections(doc),core=groups.filter(g=>g.lines.length&&/核心结论|执行摘要|核心指标|目标对比|主要发现|关键结果|需求目标|本期范围/.test(g.title));
 if(doc.summary?.trim()){
  const stored=formatSummary(doc.summary);
  const missing=core.flatMap(g=>g.lines).filter(l=>/\d/.test(l)&&!stored.includes(l)).sort((a,b)=>Number(/转化率|差距|目标.*[%％]|实际.*[%％]/.test(b))-Number(/转化率|差距|目标.*[%％]|实际.*[%％]/.test(a))).slice(0,4);
  return missing.length?'## 关键结果\n\n'+formatSummary(missing.join('\n'))+'\n\n'+stored:stored;
 }
 const selected=[...core,...groups.filter(g=>g.lines.length&&/摘要|结论|建议|下一步|风险|局限|验证/.test(g.title))];
 const chosen=[...new Set(selected.length?selected:groups.filter(g=>g.lines.length))].slice(0,4);
 if(!chosen.length)return '## 文档要点\n\n- 当前文档以图表或结构化数据为主，请结合文档展示与数据来源阅读。';
 return chosen.map(g=>'## '+g.title+'\n\n'+formatSummary(g.lines.slice(0,6).join('\n'))).join('\n\n');
}

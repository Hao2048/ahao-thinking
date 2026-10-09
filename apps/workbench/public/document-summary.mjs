// Summaries never fall back to a run/project summary: their scope is one document.
const sentences=s=>String(s).split(/(?<=[。！？；])\s*/).map(s=>s.trim()).filter(Boolean);
export function formatSummary(text){
 const lines=String(text||'').split(/\r?\n/),out=[];
 for(const line of lines){const t=line.trim();if(!t){out.push('');continue;}if(/^#{1,6}\s|^[-*]\s|^\d+[.、]\s/.test(t)){out.push(t);continue;}out.push(...sentences(t).map(s=>'- '+s));}
 return out.join('\n');
}
export function documentSummary(doc){
 if(!doc)return '暂无选中文档。';
 if(doc.summary?.trim())return formatSummary(doc.summary);
 let content=String(doc.content||'');if(doc.format==='html')content=content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,'\n');
 content=content.replace(/```[\s\S]*?```/g,'');
 const groups=[];let section=null;
 for(const raw of content.split('\n')){const line=raw.trim(),heading=line.match(/^#{1,6}\s+(.+)/);if(heading){section={title:heading[1],lines:[]};groups.push(section);continue;}if(!line||line.includes('|')||/^(?:图表|\*\*图表)/.test(line))continue;if(!section){section={title:'文档要点',lines:[]};groups.push(section);}section.lines.push(line);}
 const selected=groups.filter(g=>g.lines.length&&/摘要|结论|建议|下一步|风险|局限|验证/.test(g.title)).slice(0,4);const chosen=selected.length?selected:groups.filter(g=>g.lines.length).slice(0,3);
 if(!chosen.length)return '## 文档要点\n\n- 当前文档以图表或结构化数据为主，请结合文档展示与数据来源阅读。';
 return chosen.map(g=>'## '+g.title+'\n\n'+formatSummary(g.lines.flatMap(sentences).slice(0,6).join('\n'))).join('\n\n');
}

// Convert historical diagram formats without inventing measurements from glyph widths.
const clean=s=>s.replace(/\*\*|`/g,'').trim();
export function legacyDiagram(source,title='历史文档示意图'){
 const lines=source.split('\n').filter(s=>s.trim()),ranges=[],grades=[],points=[];
 for(const line of lines){
  const range=line.match(/^\s*(.+?)\s+[¥￥](\d+(?:\.\d+)?)\s*[-─━—–]+\s*[¥￥](\d+(?:\.\d+)?)(?:\s+(.*))?$/);
  if(range)ranges.push({name:clean(range[1]),min:Number(range[2]),max:Number(range[3]),detail:range[4]||''});
  const grade=line.match(/^\s*(.+?)\s+[█▓▒░■▇▆▅▄▃▂▁]+\s+(最高|中[–—-]高|低[–—-]中|中高|高|中|低)(.*)$/);
  if(grade)grades.push({name:clean(grade[1]),grade:grade[2].replace(/[—-]/g,'–').replace(/^中高$/,'中–高'),detail:grade[3].trim()});
  for(const m of line.matchAll(/([^│|]*?)\s*[（(](\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)[）)]/g))points.push({name:clean(m[1]),x:Number(m[2]),y:Number(m[3])});
 }
 if(ranges.length>=2&&ranges.every(r=>r.min<=r.max))return{kind:'range',title,rows:ranges,note:'使用原文明确价格区间绘图；估算不代表观测数据。右侧保留订阅接受度原文。'};
 if(grades.length>=2)return{kind:'grades',title,rows:grades,note:'使用原文明示的相对等级；字符条长度不转换为数值。等级及说明仍是原文假设。'};
 if(points.length>=2)return{kind:'points',title,rows:points,note:'保留原文明示坐标；主观评分不代表观测数据。'};
 return{kind:'source',title,source,note:'已自动转换为 SVG 示意图，保留原文文字及相对布局；未推测数据或坐标。'};
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const txt=(x,y,s,extra='')=>`<text x="${x}" y="${y}" ${extra}>${esc(s)}</text>`;
function wrap(s,count){return [...String(s)].reduce((a,c,i)=>{if(i%count===0)a.push('');a[a.length-1]+=c;return a;},[]);}
export function legacySvg(d){
 const width=1000;let content='',height=140;
 if(d.kind==='range'){
  const max=Math.max(...d.rows.map(r=>r.max)),left=300,span=370;
  content=txt(20,32,'群体')+txt(left,32,'一次性可接受价格带（元）')+txt(720,32,'月度订阅接受度');
  d.rows.forEach((r,i)=>{const y=88+i*96,x1=left+span*r.min/max,x2=left+span*r.max/max;wrap(r.name,18).forEach((s,j)=>content+=txt(20,y+j*23,s));content+=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#276850" stroke-width="8" stroke-linecap="round"/><circle cx="${x1}" cy="${y}" r="6" fill="#276850"/><circle cx="${x2}" cy="${y}" r="6" fill="#276850"/>`+txt(x1,y+30,'¥'+r.min,'text-anchor="middle"')+txt(x2,y+30,'¥'+r.max,'text-anchor="middle"');wrap(r.detail,17).forEach((s,j)=>content+=txt(720,y+j*23,s));});height=70+d.rows.length*96;
 }else if(d.kind==='grades'){
  const levels=['低','低–中','中','中–高','高','最高'];content=txt(20,32,'项目／渠道');levels.forEach((s,i)=>content+=txt(450+i*90,32,s,'text-anchor="middle"'));
  let y=80;for(const r of d.rows){const name=wrap(r.name,27),detail=wrap(r.detail,57),h=Math.max(76,name.length*23+detail.length*21+24);content+=`<rect x="0" y="${y-27}" width="1000" height="${h-8}" rx="8" fill="#f2f7f4"/>`;name.forEach((s,j)=>content+=txt(20,y+j*23,s));levels.forEach((_,i)=>content+=`<circle cx="${450+i*90}" cy="${y-6}" r="${levels[i]===r.grade?9:3}" fill="${levels[i]===r.grade?'#276850':'#cbdad2'}"/>`);detail.forEach((s,j)=>content+=txt(20,y+name.length*23+10+j*21,s,'font-size="14" fill="#65796e"'));y+=h;}height=y;
 }else if(d.kind==='points'){
  const minX=Math.min(0,...d.rows.map(r=>r.x)),maxX=Math.max(1,...d.rows.map(r=>r.x)),minY=Math.min(0,...d.rows.map(r=>r.y)),maxY=Math.max(1,...d.rows.map(r=>r.y));
  content=`<path d="M100 60 V420 H880" stroke="#a5baad" fill="none"/>`+txt(100,450,minX)+txt(880,450,maxX)+txt(65,420,minY)+txt(65,70,maxY);d.rows.forEach(r=>{const x=100+780*(r.x-minX)/(maxX-minX),y=420-350*(r.y-minY)/(maxY-minY);content+=`<circle cx="${x}" cy="${y}" r="8" fill="#276850"/>`+txt(x,y-17,r.name,'text-anchor="middle" font-size="14"')+txt(x,y+24,`(${r.x}, ${r.y})`,'text-anchor="middle" font-size="13"');});height=490;
 }else if(d.kind==='table'){
  const cols=d.headers.length,cw=960/cols;let y=20;for(const row of [d.headers,...d.rows]){const wrapped=row.map(s=>wrap(s,Math.max(5,Math.floor(cw/16)))),h=Math.max(48,...wrapped.map(a=>a.length*23+24));row.forEach((_,i)=>{content+=`<rect x="${20+i*cw}" y="${y}" width="${cw}" height="${h}" fill="${y===20?'#e9f2ec':'#fff'}" stroke="#d9e4dd"/>`;wrapped[i].forEach((s,j)=>content+=txt(30+i*cw,y+28+j*23,s,'font-size="15"'));});y+=h;}height=y+20;
 }else{
  const lines=d.source.split('\n'),max=Math.max(1,...lines.map(s=>[...s].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0))),font=Math.min(18,940/(max*.61));content=lines.map((s,i)=>txt(24,35+i*28,s,'xml:space="preserve" font-family="SFMono-Regular, Menlo, monospace" font-size="'+font+'"')).join('');height=Math.max(120,lines.length*28+45);
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(d.title)}"><rect width="100%" height="100%" fill="#fff"/><g font-family="PingFang SC, sans-serif" font-size="18" fill="#263c35">${content}</g></svg>`;
}

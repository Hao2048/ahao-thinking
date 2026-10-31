const types=new Set(['bar','line','pie','funnel','heatmap','matrix','scatter']);
const states=new Set(['已验证事实','用户观点','估算','分析推断','待验证','测试数据']);
export function validateChart(value){
 if(!value||value.schema!=='pm-chart-v1'||!types.has(value.type)||typeof value.title!=='string'||!value.title.trim()||!states.has(value.evidenceStatus)||!Array.isArray(value.data)||!value.data.length||value.data.length>5000||!value.encoding)throw new Error('图表数据结构不完整');
 if(!Array.isArray(value.sources)||value.sources.some(s=>!s||typeof s.id!=='string'||!s.id.trim()||typeof s.title!=='string'))throw new Error('缺少图表来源说明');
 if(new Set(value.sources.map(s=>s.id)).size!==value.sources.length)throw new Error('图表来源编号重复');
 for(const row of value.data)if(row&&Object.values(row).some(v=>typeof v==='number'&&!Number.isFinite(v)))throw new Error('图表包含非有限数值');
 const c=JSON.parse(JSON.stringify(value));for(const row of c.data){if(row&&typeof row==='object'&&!Array.isArray(row)&&!Array.isArray(row.sourceIds)&&typeof row.sourceId==='string')row.sourceIds=[row.sourceId];}for(const a of [c.encoding.x,c.encoding.y]){if(a&&['category','ordinal'].includes(a.scale)&&a.categories==null){a.categories=[...new Set(c.data.map(r=>r?.[a.field]).filter(v=>v!=null))];if(a.categories.every(v=>/^\d+(?:\.\d+)?$/.test(String(v))))a.categories.sort((x,y)=>Number(x)-Number(y));}}for(const axis of ['x','y']){const a=c.encoding[axis];if(a&&(!['category','ordinal','quantitative','time'].includes(a.scale)||typeof a.field!=='string'))throw new Error('坐标轴定义错误');if(a&&['category','ordinal'].includes(a.scale)&&(!Array.isArray(a.categories)||!a.categories.length))throw new Error('分类轴缺少等级顺序');if(a&&Array.isArray(a.categories)&&(a.categories.some(v=>v==null||!['string','number','boolean'].includes(typeof v))||new Set(a.categories.map(String)).size!==a.categories.length))throw new Error('分类轴类别重复或无效');}
 const refs=new Set(c.sources.map(s=>s.id));for(const row of c.data){if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('图表数据行无效');if(!Array.isArray(row.sourceIds)||row.sourceIds.some(id=>!refs.has(id)))throw new Error('数据行来源无法对应');for(const axis of ['x','y']){const a=c.encoding[axis];if(!a||row[a.field]==null)continue;if(['category','ordinal'].includes(a.scale)&&!a.categories.includes(row[a.field]))throw new Error('数据等级与坐标轴不一致');if(a.scale==='time'&&!validTime(row[a.field]))throw new Error('时间轴包含无效日期或时间');if(a.scale==='quantitative'&&(typeof row[a.field]!=='number'||!Number.isFinite(row[a.field])))throw new Error('数值轴需要真实数值');}}
 return c;
}
function validTime(v){if(typeof v==='number')return Number.isFinite(v);if(typeof v!=='string'||!/^\d{4}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?(?:[T ].*)?$/.test(v)||!Number.isFinite(Date.parse(v)))return false;const m=v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);if(m){const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[3])return false;}return true;}
const encodingField=value=>typeof value==='string'?value:value&&typeof value==='object'&&!Array.isArray(value)?value.field:undefined;
export function chartHeight(c){return c.type==='heatmap'?Math.max(320,Math.min(1200,(c.encoding.y?.categories?.length||1)*56+190)):Math.max(380,Math.min(1200,c.data.length*48+100));}
const palette=['#276850','#649e89','#e1ac62','#839dc4','#ba7884'];
export function chartOption(c,width=800){
 const e=c.encoding,axis=a=>({type:['category','ordinal'].includes(a.scale)?'category':a.scale==='time'?'time':'value',name:[a.label,a.unit&&`（${a.unit}）`].filter(Boolean).join(''),nameLocation:'middle',nameGap:36,data:a.categories,axisLabel:{color:'#536c60',hideOverlap:true},axisLine:{lineStyle:{color:'#bccdc3'}},splitLine:{lineStyle:{color:'#edf2ee'}}});
 const base={animation:false,color:palette,textStyle:{fontFamily:'PingFang SC, sans-serif',fontSize:13,color:'#263c35'},tooltip:{trigger:'item',renderMode:'richText',confine:true},grid:{left:65,right:35,top:35,bottom:65,containLabel:true}};
 if(c.type==='matrix'||c.type==='scatter'){
  if(!e.x||!e.y)throw new Error('矩阵缺少坐标轴');const rows=c.data.filter(r=>r[e.x.field]!=null&&r[e.y.field]!=null),groups=new Map();if(!rows.length)throw new Error('散点图或矩阵没有有效坐标数据');rows.forEach(r=>{const key=JSON.stringify([r[e.x.field],r[e.y.field]]);groups.set(key,(groups.get(key)||0)+1);});const indexes=new Map();
  base.xAxis=axis(e.x);base.yAxis=axis(e.y);if(c.type==='matrix'){for(const a of [base.xAxis,base.yAxis]){a.splitArea={show:true,areaStyle:{color:['#fafcfb','#f0f6f2']}};a.splitLine.show=true;}}base.series=rows.map(r=>{const key=JSON.stringify([r[e.x.field],r[e.y.field]]),n=indexes.get(key)||0;indexes.set(key,n+1);const name=String(r[encodingField(e.label)]??r.id??r.pain??''),count=groups.get(key),maxSpan=Math.max(12,Math.min(96,(Math.max(320,width)-180)/(e.x.categories?.length||4)*0.6)),spacing=Math.min(32,maxSpan/Math.max(1,count-1));return{type:'scatter',name,tooltip:{formatter:()=>[name,r.pain||'',`${e.x.label||'横轴'}：${r[e.x.field]}`,`${e.y.label||'纵轴'}：${r[e.y.field]}`,r.evidenceStatus||c.evidenceStatus].filter(Boolean).join('\n')},symbolSize:12,symbolOffset:count>1?[(n-(count-1)/2)*spacing,0]:[0,0],labelLayout:{hideOverlap:true},label:{show:true,position:count>1&&n%2?'bottom':'top',width:140,overflow:'truncate',color:'#263c35',formatter:'{b}'},data:[{name,value:[r[e.x.field],r[e.y.field]]}]};});
  return base;
 }
 if(c.type==='pie'||c.type==='funnel'){
  const field=e.value!=null?encodingField(e.value):e.y?.field,label=e.label!=null?encodingField(e.label):e.x?.field;if(!field||!label)throw new Error('占比与漏斗缺少数值或名称字段');const data=c.data.filter(r=>r[field]!=null).map(r=>{if(typeof r[field]!=='number'||!Number.isFinite(r[field])||r[field]<0)throw new Error('占比与漏斗数值无效');if(r[label]==null)throw new Error('占比与漏斗名称字段缺失');return{name:String(r[label]),value:r[field]};});
  if(!data.length)throw new Error('占比与漏斗没有有效数值数据');const total=data.reduce((sum,r)=>sum+r.value,0);if(!Number.isFinite(total)||total<=0)throw new Error('占比与漏斗需要正数总量，全零或溢出数据无法绘制');
  base.legend={bottom:0,type:'scroll'};base.series=[{type:c.type,data,...(c.type==='pie'?{radius:['35%','65%'],label:{formatter:'{b}: {c}'}}:{sort:'none',left:'12%',right:'12%',top:20,bottom:55,label:{position:'inside',formatter:'{b}: {c}'}})}];return base;
 }
 if(c.type==='heatmap'){
  const valueField=encodingField(e.value);
  if(!e.x||!e.y||typeof valueField!=='string'||!valueField.trim())throw new Error('热力图缺少行列或数值字段');
  if(![e.x,e.y].every(a=>['category','ordinal'].includes(a.scale)&&Array.isArray(a.categories)&&a.categories.length))throw new Error('热力图的横纵轴必须为分类或有序分类');
  const data=c.data.filter(r=>r[valueField]!=null).map(r=>{
    const v=r[valueField],x=e.x.categories.indexOf(r[e.x.field]),y=e.y.categories.indexOf(r[e.y.field]);
    if(typeof v!=='number'||!Number.isFinite(v))throw new Error('热力图需要数值');
    if(x<0||y<0)throw new Error('热力图的数据缺少有效行列坐标');
    return [x,y,v];
  });
  if(!data.length)throw new Error('热力图没有可显示的数值，请检查数值字段');
  if(new Set(data.map(r=>JSON.stringify(r.slice(0,2)))).size!==data.length)throw new Error('热力图存在重复行列，请先明确聚合口径');
  const min=Math.min(...data.map(r=>r[2])),max=Math.max(...data.map(r=>r[2]));
  const labelWidth=Math.max(32,Math.min(100,Math.floor((Math.max(320,width)-240)/e.x.categories.length)));
  base.xAxis=axis(e.x);base.yAxis=axis(e.y);base.yAxis.inverse=true;base.yAxis.name='';
  base.yAxis.axisLabel={...base.yAxis.axisLabel,width:160,overflow:'truncate',fontSize:12};
  base.xAxis.name=e.x.label||'';base.xAxis.nameGap=48;base.xAxis.axisLabel={...base.xAxis.axisLabel,interval:0,width:labelWidth,overflow:'break',fontSize:12};
  base.visualMap={min,max,dimension:2,seriesIndex:0,orient:'horizontal',left:'center',bottom:0,inRange:{color:['#eef6f1','#276850']}};
  base.grid={...base.grid,left:18,right:20,top:24,bottom:112};
  base.tooltip.formatter=p=>[String(e.y.categories[p.value[1]]),String(e.x.categories[p.value[0]]),`${typeof e.value==='object'?e.value.label||valueField:valueField}：${p.value[2]}`,c.evidenceStatus].join('\n');
  base.series=[{type:'heatmap',data,itemStyle:{borderColor:'#ffffff',borderWidth:2},label:{show:true,formatter:p=>`{${p.value[2]>(min+max)/2?'light':'dark'}|${p.value[2]}}`,rich:{light:{color:'#fff',fontWeight:600},dark:{color:'#263c35',fontWeight:600}}}}];return base;
 }
 if(!e.x||!e.y)throw new Error('图表缺少分类与数值轴');base.xAxis=axis(e.x);base.yAxis=axis(e.y);if(c.type==='bar'&&['category','ordinal'].includes(e.y.scale)){base.yAxis.name='';base.grid.left=12;base.grid.right=45;base.yAxis.axisLabel={...base.yAxis.axisLabel,width:Math.max(48,Math.min(220,Math.floor(width*.32))),overflow:'truncate'};base.yAxis.inverse=true;}if(c.data.some(r=>c.type==='bar'&&['category','ordinal'].includes(e.y.scale)?r[e.y.field]==null:r[e.x.field]==null))throw new Error('图表数据缺少有效分类或横轴坐标');const groupField=encodingField(e.series);if(e.series!=null&&(!groupField||c.data.some(r=>r[groupField]==null)))throw new Error('图表系列字段缺失或无效');const categoryField=['category','ordinal'].includes(e.x.scale)?e.x.field:c.type==='bar'&&['category','ordinal'].includes(e.y.scale)?e.y.field:null;if(categoryField){const keys=c.data.filter(r=>r[categoryField]!=null).map(r=>JSON.stringify([r[categoryField],groupField?r[groupField]:null]));if(new Set(keys).size!==keys.length)throw new Error('分类与系列组合重复，请先明确聚合口径');}if(!c.data.some(r=>r[e.x.field]!=null&&r[e.y.field]!=null))throw new Error('图表没有可绘制的有效数据');const series=groupField?[...new Set(c.data.map(r=>r[groupField]))]:[''];
 base.series=series.map(name=>({name:String(name),type:c.type,smooth:false,connectNulls:false,label:{show:c.type==='bar',position:['category','ordinal'].includes(e.y.scale)?'right':'top'},data:['category','ordinal'].includes(e.x.scale)?e.x.categories.map(category=>{const r=c.data.find(r=>r[e.x.field]===category&&(!groupField||r[groupField]===name));return r?.[e.y.field]??null;}):c.data.filter(r=>!groupField||r[groupField]===name).map(r=>[r[e.x.field],r[e.y.field]??null])}));if(groupField)base.legend={top:0,type:'scroll',textStyle:{width:120,overflow:'truncate'}};return base;
}
export function legacyBar(code,title='历史文档条形图'){
 const rows=code.split('\n').map(line=>line.match(/^\s*(.+?)\s+[█▓▒░■▇▆▅▄▃▂▁]+\s+(\d+(?:\.\d+)?)\s*$/)||line.match(/^\s*(.+?)\s+(\d+(?:\.\d+)?)\s+[█▓▒░■▇▆▅▄▃▂▁]+\s*$/)).filter(Boolean);
 if(rows.length<2)return null;return{schema:'pm-chart-v1',id:'legacy-bar',type:'bar',title,evidenceStatus:'分析推断',sources:[{id:'original',title:'原文字符图；证据性质以原文说明为准'}],data:rows.map(r=>({name:r[1].trim(),value:Number(r[2]),sourceIds:['original']})),encoding:{x:{field:'value',scale:'quantitative',label:'原文数值'},y:{field:'name',scale:'category',categories:rows.map(r=>r[1].trim()),label:'原文分类'}},note:'按原文明确数值重绘；主观评分不能当作真实用户统计。'};
}
export function legacyMatrix(headers,rows,title='历史文档痛点矩阵'){
 const clean=s=>String(s).replace(/<br\s*\/?\s*>|\\n|\s|\*|`/gi,''),h=headers.map(clean),xi=h.findIndex(s=>s.includes('频率')),yi=h.findIndex(s=>s.includes('严重')),idIndex=h.findIndex(s=>/编号|序号|ID/i.test(s));if(xi<0||yi<0||idIndex<0)return null;
 const categories=['低','中','中高','高'],data=[],missing=[];for(const row of rows){const id=clean(row[idIndex]);if(!/^P\d+$/.test(id))continue;const level=s=>clean(s).match(/^(中高|低|中|高)(?:$|[（(、，])/u)?.[1],x=level(row[xi]),y=level(row[yi]);if(!x||!y){missing.push(`${id}：${!x?'发生频率缺失':''}${!x&&!y?'、':''}${!y?'严重程度缺失':''}`);continue;}data.push({id,frequency:x,severity:y,pain:row[h.findIndex(s=>s==='痛点')]||id,sourceIds:['original']});}if(data.length<2)return null;return{schema:'pm-chart-v1',id:'legacy-matrix',type:'matrix',title,evidenceStatus:'待验证',sources:[{id:'original',title:'原文配套明细表，保留原文证据性质'}],data,encoding:{x:{field:'frequency',scale:'ordinal',categories,label:'发生频率',unit:'等级'},y:{field:'severity',scale:'ordinal',categories,label:'严重程度',unit:'等级'},label:'id'},note:'根据原表明确等级重绘，不把定性判断转换为精确数值。'+(missing.length?' 未绘制的待补充项：'+missing.join('；')+'。完整痛点与依据保留在下方原表。':'')};
}

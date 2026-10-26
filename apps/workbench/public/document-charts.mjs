import {validateChart,chartOption} from './chart-model.mjs';
export function chartBlocks(content){
 return [...String(content).matchAll(/^```chart[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?=\r?$)/gm)].map((m,i)=>({index:i,start:m.index,end:m.index+m[0].length,source:m[1].trim()}));
}
export function validateDocumentCharts(charts){
 if(!Array.isArray(charts)||charts.length>40)throw Error('一份文档最多40张图表');
 const ids=new Set();return charts.map(c=>{const v=validateChart(c);if(typeof v.id!=='string'||!v.id.trim()||ids.has(v.id))throw Error('图表id不能为空或重复');ids.add(v.id);chartOption(v);return v;});
}
// Editor event handlers reference the row objects. Validation must not replace
// them, otherwise edits made after a preview are written into a stale array.
export function validateChartEdits(charts){validateDocumentCharts(charts);return charts;}
export function replaceDocumentCharts(content,charts){
 const checked=validateDocumentCharts(charts),blocks=chartBlocks(content);let result=String(content);
 for(let i=blocks.length-1;i>=0;i--){const b=blocks[i];result=result.slice(0,b.start)+(checked[i]?'```chart\n'+JSON.stringify(checked[i],null,2)+'\n```':'')+result.slice(b.end);}
 for(let i=blocks.length;i<checked.length;i++)result+='\n\n```chart\n'+JSON.stringify(checked[i],null,2)+'\n```';
 return result;
}

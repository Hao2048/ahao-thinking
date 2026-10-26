const cell=v=>String(v==null?'未提供':typeof v==='object'?JSON.stringify(v):v).replaceAll('|','\\|').replaceAll('\n',' ');
export function computedDocument(computed, {interpreted = false} = {}) {
  const title=computed.title||'统计计算结果',rows=computed.rows||computed.cohorts||[];
  const labels={step:'步骤',users:'人数',cumulativeRate:'累计转化率',stepRate:'环节转化率'};
  let content=`# ${title}\n\n## 代码计算结果\n\n`;
  if(Array.isArray(rows)&&rows.length){
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    content+='| '+keys.map(k=>labels[k]||cell(k)).join(' | ')+' |\n| '+keys.map(()=>'---').join(' | ')+' |\n'+rows.map(row=>'| '+keys.map(k=>cell(/Rate$/.test(k)&&typeof row[k]==='number'?(row[k]*100).toFixed(2)+'%':row[k])).join(' | ')+' |').join('\n');
  }else content+='```json\n'+JSON.stringify(computed,null,2)+'\n```';
  if(computed.type==='funnel'&&rows.length){
    const chart={schema:'pm-chart-v1',id:'computed-funnel',type:'funnel',title:'代码计算漏斗',evidenceStatus:computed.evidence==='test_data'?'测试数据':'待验证',sources:[{id:'input',title:'已校验输入数据',locator:computed.inputId||'当前节点输入'}],data:rows.map(r=>({step:r.step,users:r.users,sourceIds:['input']})),encoding:{x:{field:'step',scale:'category',categories:rows.map(r=>r.step),label:'步骤'},y:{field:'users',scale:'quantitative',label:'人数',unit:'人'}}};
    content+='\n\n```chart\n'+JSON.stringify(chart,null,2)+'\n```';
  }
  content+='\n\n## 解读状态\n\n'+(interpreted?'计算数据由代码生成，AI解读另见分析文档；数值绑定校验不代表原因判断或输入来源已经得到验证。':'计算已完成。AI解读未完成；以上只表示输入数据的代码计算结果，不构成原因判断。')+'请核对数据来源、观察窗口和统计口径。';
  return {title,format:'markdown',content,summary:interpreted?'## 核心结论\n- 代码计算完成；此表为数值依据。\n## 证据局限\n- 输入来源和因果解释仍需核对。':'## 核心结论\n- 代码计算完成，数据已保留。\n## 证据局限\n- AI解读未完成，请先核对计算数据与口径。\n## 下一步\n- 恢复模型连接后重新运行以补充解读。'};
}

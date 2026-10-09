const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pct = value => value == null ? '—' : `${(value*100).toFixed(1)}%`;
const errorBox = '<div class="form-error" role="alert" tabindex="-1" hidden></div>';
function showError(form,error) { const box=form.querySelector('.form-error');box.hidden=false;box.textContent=error.message;box.focus(); }
function clearError(form) { form.querySelector('.form-error').hidden=true; }

export function needsFunnelOptions(inputs){
  return inputs.some(input=>{
    const content=input.content.trim().replace(/^```(?:csv|json)?\s*\n/i,'').replace(/\n```$/,'');
    if(content.split(/\r?\n/)[0].replaceAll('"','')==='user_id,timestamp,event')return true;
    try{const value=JSON.parse(content),rows=Array.isArray(value)?value:value.events||value.rows||value.dataset?.rows;return Boolean(rows?.[0]&&['user_id','timestamp','event'].every(key=>Object.hasOwn(rows[0],key)));}catch{return false;}
  });
}
export function funnelRunDialog({dialog,modal,run}){
  dialog('确认事件漏斗口径',`<form id="funnel-options">${errorBox}<label><span class="field-label">按顺序填写事件名称（每行一个）</span><textarea name="steps" rows="4" placeholder="view&#10;create&#10;active" required></textarea></label><label><span class="field-label">转化窗口（小时）</span><input name="windowHours" type="number" min="0.01" max="720" step="any" value="24" required></label><label><span class="field-label">数据完整覆盖截至时间（UTC）</span><input type="datetime-local" name="observationEnd" step="1" required></label><label><span class="field-label">首步用户开始时间（UTC，可选）</span><input type="datetime-local" name="observationStart" step="1"></label><p class="muted small">表头 user_id,timestamp,event；时间需带时区。按每名用户首次首步事件进入、窗口内严格递增时间完成步骤；未完整观察窗口的用户排除，同一时刻不推断顺序。</p><button class="primary">按此口径运行</button></form>`);
  const form=modal.querySelector('form');form.addEventListener('submit',async event=>{
    event.preventDefault();const button=form.querySelector('button');button.disabled=true;clearError(form);
    try{const values=Object.fromEntries(new FormData(form));values.steps=values.steps.split(/\r?\n/).map(step=>step.trim()).filter(Boolean);values.windowHours=Number(values.windowHours);values.observationEnd=new Date(values.observationEnd+'Z').toISOString();if(values.observationStart)values.observationStart=new Date(values.observationStart+'Z').toISOString();if(await run(values)!==false)modal.close();}catch(error){showError(form,error);}finally{if(button.isConnected)button.disabled=false;}
  });
}

export function enhancedInputDialog({dialog,api,refresh,toast,modal,projectId,moduleId,token,ocrAvailable=false}) {
  dialog('上传或填写材料',`<form id="input-form">${errorBox}<label><span class="field-label">材料标题</span><input name="title" required maxlength="200" placeholder="想法、访谈记录或数据.csv"></label><label><span class="field-label">材料性质</span><select name="evidence"><option value="material">用户材料</option><option value="user_statement">用户陈述</option><option value="test_data">测试数据</option><option value="ai_hypothesis">AI 生成 / 待验证</option></select></label><label><span class="field-label">选择文件（可选，最大 20 MB）</span><input type="file" name="file" accept=".txt,.md,.json,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"></label><label class="check-label"><input type="checkbox" name="ocr" ${ocrAvailable?'':'disabled'}>识别 PDF 中的扫描文字与图片（本机 OCR）</label><p class="muted small">${ocrAvailable?'PNG/JPG 自动识别；扫描或混合 PDF 请勾选 OCR（最多 30 页，最长 120 秒）。中英文识别后请核对文字、数字和表格。':'当前运行环境没有本机 OCR；PNG/JPG 与扫描件请先转换为文字。'} 提取结果可修改，确认后才进入材料。</p><div class="parse-status" role="status" aria-live="polite"></div><label class="sheet-field" hidden><span class="field-label">工作表</span><select name="sheet"></select></label><label><span class="field-label">材料正文 / 提取预览</span><textarea name="content" required rows="10" maxlength="524288"></textarea></label><button class="primary">加入当前模块</button></form>`);
  const form=modal.querySelector('form'),button=form.querySelector('button');let parsed,kind='manual',generation=0;
  const selectSheet=()=>{
    const sheet=parsed.tables.find(table=>table.name===form.elements.sheet.value);
    form.elements.content.value=sheet?.content||parsed.content;
    form.elements.title.value=sheet?`${parsed.filename.replace(/\.xlsx$/i,'')}-${sheet.name}.csv`:parsed.filename;
  };
  form.elements.sheet.addEventListener('change',selectSheet);
  const parseSelected = async()=>{
    const file=form.elements.file.files[0];if(!file)return;
    const current=++generation;parsed=undefined;kind='manual';button.disabled=true;clearError(form);
    form.elements.content.value='';form.querySelector('.sheet-field').hidden=true;
    const status=form.querySelector('.parse-status');const useOCR=/\.(png|jpe?g)$/i.test(file.name)||(/\.pdf$/i.test(file.name)&&form.elements.ocr.checked);
    status.textContent=useOCR?'正在本机识别文字，最多需要 120 秒；请保持此窗口打开…':'正在本机提取内容…';status.setAttribute('aria-busy','true');
    try{
      if(file.size>20*1024*1024)throw new Error('文件超过 20 MB，请拆分文件');
      const image=/\.(png|jpe?g)$/i.test(file.name);
      if((image||form.elements.ocr.checked)&&!ocrAvailable)throw new Error('当前环境不支持本机 OCR，请使用 Mac 桌面版');
      const params=new URLSearchParams({filename:file.name,projectId,moduleId,ocr:String(form.elements.ocr.checked)});
      const response=await fetch(`/api/files/parse?${params}`,{method:'POST',headers:{'X-AIPM-Token':token,'Content-Type':'application/octet-stream'},body:file});
      const result=await response.json();if(!response.ok)throw new Error(result.error);
      if(current!==generation||!form.isConnected)return;
      parsed=result;kind='file';form.elements.title.value=file.name;form.elements.content.value=result.content;
      status.textContent=`提取完成${result.pages?` · ${result.pages} 页`:''}。${result.warnings.join('；')}`;
      if(result.tables.length){
        form.querySelector('.sheet-field').hidden=false;
        form.elements.sheet.innerHTML='<option value="">完整工作簿（文字材料）</option>'+result.tables.map(table=>`<option value="${esc(table.name)}">${esc(table.name)} · ${table.rows} 行 × ${table.columns} 列</option>`).join('');
        if(result.tables.length===1&&['funnel','retention','ab'].includes(moduleId)){form.elements.sheet.value=result.tables[0].name;selectSheet();}
      }
    }catch(error){if(current===generation&&form.isConnected){status.textContent='未加入任何材料。可调整识别选项或重新选择文件。';showError(form,error);}}
    finally{if(current===generation&&form.isConnected){button.disabled=false;status.setAttribute('aria-busy','false');}}
  };
  form.elements.file.addEventListener('change',parseSelected);
  form.elements.ocr.addEventListener('change',parseSelected);
  form.addEventListener('submit',async event=>{
    event.preventDefault();button.disabled=true;clearError(form);
    try{
      await api(`/api/projects/${projectId}/inputs`,{moduleId,title:form.elements.title.value,content:form.elements.content.value,evidence:form.elements.evidence.value,kind,...(parsed?{fileDraftId:parsed.id,tableName:form.elements.sheet.value}: {})});
      modal.close();await refresh();toast('已加入材料，来源与修改状态已保留');
    }catch(error){showError(form,error);}finally{if(button.isConnected)button.disabled=false;}
  });
}

export function searchFormMarkup(search) {
  return `<section class="panel"><div class="panel-head"><h2>联网检索</h2><span class="pill">${search.builtin?'默认检索已启用':search.configured?'已配置':'未配置'}</span></div><form id="search-form" style="padding:18px">${errorBox}<p class="muted">自动复用已有 DeepSeek 模型 Key，通过 DeepSeek Harness 原生搜索获取结构化来源，无需再填检索 Key；其他模型可使用公开搜索页面或选择专业服务。只发送公开检索词。</p><div class="form-grid"><label><span class="field-label">检索服务</span><select name="provider">${[['builtin','自动检索（复用 DeepSeek Key）'],['tavily','Tavily'],['brave','Brave Search'],['searxng','自建 SearXNG']].map(([value,label])=>`<option value="${value}" ${search.provider===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="search-custom-field"><span class="field-label">检索接口完整地址</span><input name="baseURL" type="url" value="${esc(search.baseURL)}" placeholder="https://你的 SearXNG 地址/search"></label><label class="search-custom-field"><span class="field-label">检索 API 密钥</span><input name="apiKey" type="password" autocomplete="new-password" placeholder="留空保留同一服务的已有密钥"></label><label class="search-custom-field"><span class="field-label">或密钥环境变量</span><input name="apiKeyEnv" value="${esc(search.apiKeyEnv)}" placeholder="例如：TAVILY_API_KEY"></label></div><label class="check-label search-custom-field"><input type="checkbox" name="clearKey">清除已保存的检索密钥</label><button class="primary">保存检索设置</button><p class="footer-note">DeepSeek 原生检索调用搜索模型，按已有模型账户计费。公开搜索页可能受访问限制且结果需核验；专业服务按其账户计费。SearXNG 需启用 JSON 格式。</p></form></section>`;
}
export function bindSearchForm({api,refresh,toast}) {
  const form=document.querySelector('#search-form');if(!form)return;
  const visibility=()=>{for(const field of form.querySelectorAll('.search-custom-field'))field.hidden=form.elements.provider.value==='builtin';};visibility();
  form.elements.provider.addEventListener('change',()=>{visibility();form.elements.baseURL.value={tavily:'https://api.tavily.com/search',brave:'https://api.search.brave.com/res/v1/web/search'}[form.elements.provider.value]||'';form.elements.apiKey.value='';});
  form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;clearError(form);try{const body=Object.fromEntries(new FormData(form));body.clearKey=form.elements.clearKey.checked;await api('/api/search/settings',body);await refresh();toast('检索设置已保存');}catch(error){showError(form,error);}finally{if(button.isConnected)button.disabled=false;}});
}
export function researchDialog({dialog,api,refresh,toast,modal,projectId,moduleId,configured,dynamicAvailable=false}) {
  dialog('联网取材',`<form id="research-form">${errorBox}<p class="muted">检索公开资料、读取正文并保留来源。先检查结果，再选择加入本模块；网页不能替代真实需求验证。</p><label><span class="field-label">公开检索词（每行一个，最多 3 个）</span><textarea name="queries" rows="3" placeholder="例如：AI 宠物 情感陪伴 用户评价"></textarea></label><button type="button" id="plan-queries">根据当前材料拟定检索词</button><p class="small muted">${configured?'默认检索或已配置服务将查找公开网页；请检查关键词后再检索。':'尚未配置检索服务。可以在模型设置中接入服务，或只填写以下网页链接。'}</p><label><span class="field-label">指定公开网页（每行一个，最多 4 个）</span><textarea name="urls" rows="3" placeholder="https://竞品官网或报告网页"></textarea></label><label class="check-label"><input type="checkbox" name="dynamic" ${dynamicAvailable?'':'disabled'}>读取 JavaScript 渲染的动态网页</label><p class="small muted">${dynamicAvailable?'使用独立无登录状态的浏览环境，只读取公开资料；不支持登录、验证码或写入操作。':'动态网页读取需要 Mac 桌面版。'}</p><button class="primary">检索并读取网页</button><div class="research-status" role="status" aria-live="polite"></div><div id="research-results"></div></form>`);
  const form=modal.querySelector('form'),status=form.querySelector('.research-status'),submit=form.querySelector('button.primary'),planner=form.querySelector('#plan-queries');
  planner.addEventListener('click',async()=>{planner.disabled=true;clearError(form);status.textContent='正在拟定检索词…';try{const result=await api(`/api/projects/${projectId}/research/plan`,{moduleId});form.elements.queries.value=result.queries.join('\n');status.textContent='请检查检索词，点击下方按钮才会发送到检索服务。';}catch(error){showError(form,error);status.textContent='未发送检索请求。';}finally{planner.disabled=false;}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();submit.disabled=true;planner.disabled=true;clearError(form);form.querySelector('#research-results').innerHTML='';status.textContent='正在检索与抓取网页，通常需要数十秒…';
    try{
      const lines=name=>form.elements[name].value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      const draft=await api(`/api/projects/${projectId}/research`,{moduleId,queries:lines('queries'),urls:lines('urls'),dynamic:form.elements.dynamic.checked});
      if(!form.isConnected)return;
      status.textContent=`取得 ${draft.sources.length} 项来源，${draft.failures.length} 项未能完成。尚未加入材料。`;
      form.querySelector('#research-results').innerHTML=draft.sources.map((source,index)=>`<section class="source-card"><label class="check-label"><input type="checkbox" name="source" value="${index}" checked><strong>${esc(source.title)}</strong></label><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a><p class="small muted">${source.status==='page'?(source.method==='dynamic-render'?'已读取动态正文':'已抓取正文'):'仅搜索摘要，正文未取得'} · 抓取 ${esc(source.retrievedAt)}${source.publishedAt?` · 网页声明发表 ${esc(source.publishedAt)}`:''}${source.truncated?' · 正文已截取':''}</p><details><summary>查看提取内容</summary><pre>${esc(source.content)}</pre></details></section>`).join('')+(draft.failures.length?`<div class="notice"><h3>没有完成的来源</h3><ul>${draft.failures.map(failure=>`<li>${esc(failure.url||failure.query)}：${esc(failure.error)}</li>`).join('')}</ul></div>`:'')+(draft.sources.length?'<button type="button" class="primary" id="confirm-research">将所选来源加入当前模块</button>':'<p>没有可用材料。请检查检索设置、链接或访问限制后重试。</p>');
      form.querySelector('#confirm-research')?.addEventListener('click',async event=>{
        const button=event.currentTarget;button.disabled=true;clearError(form);
        try{const selected=[...form.querySelectorAll('[name=source]:checked')].map(input=>Number(input.value));await api(`/api/projects/${projectId}/research/${draft.id}`,{moduleId,selected});modal.close();await refresh();toast('已加入联网材料，引用与抓取时间已保留');}catch(error){showError(form,error);}finally{if(button.isConnected)button.disabled=false;}
      });
    }catch(error){showError(form,error);status.textContent='联网取材未完成，原有材料保持完整。';}
    finally{if(form.isConnected){submit.disabled=false;planner.disabled=false;}}
  });
}
export function analyticsRunDialog({dialog,modal,moduleId,run}) {
  const retention=moduleId==='retention';
  dialog(retention?'确认留存计算口径':'确认 A/B 计算口径',`<form id="analytics-form">${errorBox}${retention?'<label><span class="field-label">数据完整覆盖截至日期（UTC）</span><input type="date" name="observationEnd"></label><label><span class="field-label">指定日留存</span><input name="days" value="1,7,30" required></label><p class="muted small">CSV/JSON 计算需提供截至日期（或 JSON 的 observationEnd）；文字分析方案可留空。用逗号分隔天数。尚未到达观察日的用户群不会计入分母；缺数据会单独标记。</p><details><summary>事件 CSV 的口径</summary><label><span class="field-label">首次事件</span><input name="signupEvent" value="signup"></label><label><span class="field-label">回访事件</span><input name="activeEvent" value="active"></label><p>表头 user_id,date,event；按首次事件日期分组、UTC 指定自然日计算。汇总格式为 cohort,cohort_users,day,retained_users。</p></details>':'<label><span class="field-label">对照组名称</span><input name="control" placeholder="留空使用 CSV 第一组"></label><p class="muted">支持 2–6 组独立随机用户的固定样本实验，95% 区间与双侧检验；多组对同一对照使用 Holm 校正。转化表头 variant,users,conversions；连续指标为 variant,users,mean,stddev（样本标准差），或 variant,user_id,value（每名用户一次）。连续指标采用 Welch 检验。请确认指标、分组与窗口一致；不支持反复查看后提前停止的序贯实验。</p>'}<button class="primary">按此口径运行</button></form>`);
  const form=modal.querySelector('form');form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;clearError(form);try{const values=Object.fromEntries(new FormData(form));if(retention){values.days=values.days.split(',').map(day=>Number(day.trim()));if(values.days.some(day=>!Number.isInteger(day)||day<0||day>365))throw new Error('留存天数应为 0–365 的整数');}if(await run(values)!==false)modal.close();}catch(error){showError(form,error);}finally{if(button.isConnected)button.disabled=false;}});
}
const number=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:4});
const pvalue=value=>value==null?'暂不计算':value<0.0001?'＜0.0001':value.toFixed(4);
function comparisonsMarkup(chart){
  const continuous=chart.metric==='continuous',diff=value=>continuous?number(value):`${(value*100).toFixed(2)} 个百分点`;
  return `<h3>各实验组与 ${esc(chart.control)} 比较</h3><p class="small muted">${esc(chart.multipleTesting)}；区间为单次比较 95% 区间。</p><div class="table-wrap"><table><thead><tr><th>实验组</th><th>差值</th><th>95% 差值区间</th><th>原始 p 值</th><th>校正 p 值</th><th>0.05 判定</th></tr></thead><tbody>${chart.comparisons.map(value=>`<tr><td>${esc(value.treatment)}</td><td>${diff(value.difference)}</td><td>${value.differenceInterval?value.differenceInterval.map(diff).join(' 至 '):'暂不计算'}</td><td>${pvalue(value.pValue)}</td><td>${pvalue(value.adjustedPValue)}</td><td>${value.significant===null?'数据不足':value.significant?'低于阈值':'未低于阈值'}</td></tr>`).join('')}</tbody></table></div>`;
}
export function chartMarkup(chart) {
  if(chart.type==='funnel')return `<h3>转化漏斗</h3><div class="funnel">${chart.rows.map(row=>`<div class="funnel-row"><span>${esc(row.step)}</span><div class="track"><div class="bar" style="width:${row.cumulativeRate*100}%">${row.users.toLocaleString()}</div></div><span class="muted small">${pct(row.cumulativeRate)}</span></div>`).join('')}</div><p class="muted small">累计转化率；${chart.definition?`观察窗口 ${chart.definition.windowHours} 小时 · 排除 ${chart.definition.excludedImmatureUsers} 名观察未完整用户`:'同群、时间窗与步骤前提由提供者确认'}</p>${warningMarkup(chart.warnings||[])}<div class="table-wrap"><table><thead><tr><th>步骤</th><th>人数</th><th>步骤转化率</th><th>累计转化率</th></tr></thead><tbody>${chart.rows.map(row=>`<tr><td>${esc(row.step)}</td><td>${row.users}</td><td>${pct(row.stepRate)}</td><td>${pct(row.cumulativeRate)}</td></tr>`).join('')}</tbody></table></div>`;

  if(chart.type==='ab'&&chart.metric==='continuous')return `<h3>连续指标实验</h3><div class="table-wrap"><table><thead><tr><th>组别</th><th>样本</th><th>均值</th><th>样本标准差</th></tr></thead><tbody>${chart.rows.map(row=>`<tr><td>${esc(row.variant)}${row.variant===chart.control?'（对照）':''}</td><td>${row.users}</td><td>${number(row.mean)}</td><td>${number(row.stddev)}</td></tr>`).join('')}</tbody></table></div>${comparisonsMarkup(chart)}${warningMarkup(chart.warnings)}`;
  if(chart.type==='ab'&&chart.comparisons)return `<h3>多组转化实验</h3><div class="table-wrap"><table><thead><tr><th>组别</th><th>样本</th><th>转化</th><th>转化率</th></tr></thead><tbody>${chart.rows.map(row=>`<tr><td>${esc(row.variant)}</td><td>${row.users}</td><td>${row.conversions}</td><td>${pct(row.rate)}</td></tr>`).join('')}</tbody></table></div>${comparisonsMarkup(chart)}${warningMarkup(chart.warnings)}`;

  if(chart.type==='retention')return `<h3>留存观察</h3><p class="muted small">完整数据截至 ${esc(chart.observationEnd)} · UTC 指定日留存</p><div class="table-wrap"><table><thead><tr><th>用户群</th><th>人数</th>${chart.days.map(day=>`<th>D${day}</th>`).join('')}</tr></thead><tbody>${chart.rows.map(row=>`<tr><td>${esc(row.cohort)}</td><td>${row.users}</td>${row.values.map(value=>`<td class="retention-cell" style="--cell-strength:${value.rate??0}">${!value.mature?'未成熟':value.rate===null?'缺数据':`${pct(value.rate)}<small>${value.retained}/${row.users}</small>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div><h3>成熟群汇总</h3><div class="metric-grid">${chart.summary.map(value=>`<div><span>D${value.day}</span><strong>${pct(value.rate)}</strong><small>${value.retained}/${value.eligibleUsers} 人${value.missingCohorts?` · ${value.missingCohorts} 群缺数据`:''}</small></div>`).join('')}</div>${warningMarkup(chart.warnings)}`;
  if(chart.type==='ab')return `<h3>A/B 转化与区间</h3><div class="table-wrap"><table><thead><tr><th>组别</th><th>样本</th><th>转化</th><th>转化率</th><th>95% Wilson 区间</th></tr></thead><tbody>${chart.rows.map(row=>`<tr><td>${esc(row.variant)}${row.variant===chart.control?'（对照）':'（实验）'}</td><td>${row.users}</td><td>${row.conversions}</td><td>${pct(row.rate)}</td><td>${pct(row.confidenceInterval[0])} – ${pct(row.confidenceInterval[1])}</td></tr>`).join('')}</tbody></table></div><div class="metric-grid"><div><span>绝对差</span><strong>${(chart.difference*100).toFixed(2)} 个百分点</strong><small>实验减对照</small></div><div><span>相对变化</span><strong>${pct(chart.relativeLift)}</strong><small>对照为零时不计算</small></div><div><span>双侧 p 值</span><strong>${chart.pValue===null?'暂不计算':chart.pValue<0.0001?'＜0.0001':chart.pValue.toFixed(4)}</strong><small>${chart.significant===null?'期望频数不足':chart.significant?'低于 0.05':'未低于 0.05'}</small></div></div><p class="muted small">差值 95% Newcombe 区间：${(chart.differenceInterval[0]*100).toFixed(2)} 至 ${(chart.differenceInterval[1]*100).toFixed(2)} 个百分点。</p>${warningMarkup(chart.warnings)}`;
  return '';
}
function warningMarkup(warnings){return `<div class="notice"><h3>统计口径与限制</h3><ul>${warnings.map(warning=>`<li>${esc(warning)}</li>`).join('')}</ul></div>`;}
export function provenanceMarkup(input) {
  if(input.fileSource){const source=input.fileSource;return `<div class="notice"><h3>文件来源</h3><p>${esc(source.filename)}${source.sheet?` · 工作表 ${esc(source.sheet)}`:''} · ${source.method==='apple-vision-ocr'?'本机 OCR · ':''}${source.edited?'提取后已手工修改':'保持提取内容'}</p><p class="small muted">解析 ${esc(source.parsedAt)} · SHA256 ${esc(source.sha256.slice(0,12))}</p></div>`;}
  const files=input.source?.fileReferences||[];
  const fileMarkup=files.length?`<div class="notice"><h3>前序文件来源</h3>${files.map(source=>`<p>${esc(source.filename)} · ${source.method==='apple-vision-ocr'?'本机 OCR，需核对识别结果':'提取文字'}${source.edited?' · 已修改':''}</p>`).join('')}</div>`:'';
  const sources=input.webSource?[input.webSource]:input.source?.references||[];
  return fileMarkup+(sources.length?`<div class="notice"><h3>联网来源</h3>${sources.map(source=>`<p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.url)}</a> · ${source.status==='page'?'正文':'搜索摘要'} · ${esc(source.retrievedAt)}</p>`).join('')}</div>`:'');
}

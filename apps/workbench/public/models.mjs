const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function modelFormMarkup(providers,model){
  const preset=providers.find(item=>item.id===model?.provider)||providers[0];
  const custom=Boolean(model&&(!model.provider||model.provider==='custom'));
  const values=model||{name:preset.name,api:preset.api,baseURL:preset.baseURL,model:preset.model};
  return `<form id="model-form" class="model-connect"><label><span class="field-label">模型厂商</span><select name="provider">${providers.map(item=>`<option value="${item.id}" ${!custom&&item.id===preset.id?'selected':''}>${esc(item.name)}</option>`).join('')}<option value="custom" ${custom?'selected':''}>内部服务 / 自定义</option></select></label><p id="provider-summary" class="muted small"></p><label><span class="field-label">API Key</span><input name="apiKey" type="password" autocomplete="new-password" ${model?'':'required'} placeholder="${model?'留空保留当前 Key；填写则替换':'粘贴所选厂商的 API Key'}" aria-describedby="key-help"></label><p id="key-help" class="muted small">${model?'保存的 Key 不回显。':'保存后即可使用；可以再点击测试连接。'} <a id="provider-key-link" target="_blank" rel="noopener noreferrer">获取 API Key ↗</a></p><details id="model-advanced" ${custom?'open':''}><summary>高级设置 · 模型、地址与内部服务</summary><div class="form-grid"><label><span class="field-label">连接名称</span><input name="name" value="${esc(values.name)}" required maxlength="200"></label><label><span class="field-label">模型 ID</span><input name="model" value="${esc(values.model)}" required maxlength="200"></label><label><span class="field-label">接口协议</span><select name="api">${[['openai-completions','OpenAI Chat Completions / 兼容服务'],['deepseek-messages','DeepSeek 原生 Messages'],['anthropic-messages','Anthropic Messages']].map(([id,label])=>`<option value="${id}" ${values.api===id?'selected':''}>${label}</option>`).join('')}</select></label><label><span class="field-label">服务地址（Base URL）</span><input name="baseURL" type="url" value="${esc(values.baseURL)}" required></label><label class="full"><span class="field-label">或引用密钥环境变量</span><input name="apiKeyEnv" value="${esc(values.apiKeyEnv||'')}" placeholder="例如：COMPANY_AI_API_KEY"></label></div></details><div class="form-error" hidden role="alert"></div><button class="primary" type="submit">保存连接</button>${model?'<button type="button" data-action="cancel-edit">取消编辑</button>':''}<div class="footer-note">${model?'修改当前连接。':'保存后自动设为当前使用的模型。'} ${window.aipmDesktop?'Key 经 macOS 钥匙串加密保存。':'开发模式使用本机权限受限的文件保存。'}</div></form>`;
}
export function bindModelForm({providers,model,save,done}){
  const form=document.querySelector('#model-form');if(!form)return;
  const summary=form.querySelector('#provider-summary'),link=form.querySelector('#provider-key-link'),advanced=form.querySelector('details'),error=form.querySelector('[role=alert]');
  function destinationChanged(){return Boolean(model&&(form.elements.api.value!==model.api||form.elements.baseURL.value.replace(/\/$/,'')!==model.baseURL));}
  function show(){
    const preset=providers.find(item=>item.id===form.elements.provider.value);
    summary.textContent=preset?`默认使用 ${form.elements.model.value}，已自动配置接口。${preset.note||''}`:'填写你的内部服务地址、协议与模型 ID。';
    link.hidden=!preset;if(preset)link.href=preset.keyURL;else link.removeAttribute('href');
    form.elements.apiKey.required=(!model||destinationChanged())&&!form.elements.apiKeyEnv.value.trim();
    form.elements.apiKey.placeholder=destinationChanged()?'请重新填写这个厂商或服务的 Key':model?'留空保留当前 Key；填写则替换':'粘贴所选厂商的 API Key';
  }
  form.elements.provider.addEventListener('change',()=>{
    const preset=providers.find(item=>item.id===form.elements.provider.value);
    form.elements.apiKey.value='';form.elements.apiKeyEnv.value='';error.hidden=true;
    if(preset){for(const key of ['name','api','baseURL','model'])form.elements[key].value=preset[key];advanced.open=false;}
    else{form.elements.name.value='内部模型';form.elements.api.value='openai-completions';form.elements.model.value='';form.elements.baseURL.value='';advanced.open=true;}
    show();
  });
  for(const key of ['api','baseURL','model','apiKeyEnv'])form.elements[key].addEventListener('input',show);
  form.addEventListener('invalid',event=>{if(advanced.contains(event.target))advanced.open=true;},true);
  form.addEventListener('submit',async event=>{
    event.preventDefault();error.hidden=true;const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='正在保存…';
    try{const values=Object.fromEntries(new FormData(form));if(!values.apiKey)delete values.apiKey;if(!values.apiKeyEnv)delete values.apiKeyEnv;await save(values);await done();}
    catch(problem){error.textContent=problem.message;error.hidden=false;if(!advanced.open&&(form.elements.provider.value==='custom'||/地址|模型 ID|接口/.test(problem.message)))advanced.open=true;}
    finally{if(button.isConnected){button.disabled=false;button.textContent='保存连接';}}
  });show();
}

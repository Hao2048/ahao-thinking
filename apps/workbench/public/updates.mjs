const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function updatesMarkup(settings={}){
  return `<section class="panel"><div class="panel-head"><h2>应用更新</h2></div><form id="update-form" style="padding:18px"><p class="muted">正式签名版本可以检查、下载并验证更新；安装时退出应用。开发签名版本可保存配置，但不能自动安装。</p><label><span class="field-label">HTTPS 更新服务地址</span><input name="feedURL" type="url" value="${esc(settings.feedURL)}" placeholder="https://你的发布域名/latest-arm64.json"></label><label class="check-label"><input type="checkbox" name="enabled" ${settings.enabled?'checked':''}>自动检查更新（每 6 小时）</label><div class="tools"><button class="primary">保存更新设置</button><button type="button" id="check-update">检查更新</button><button type="button" id="install-update" hidden>安装并重启</button></div><p id="update-status" class="muted" role="status" aria-live="polite">正在读取更新状态…</p><p class="form-error" role="alert" hidden></p></form></section>`;
}
const names={unsupported:'本地开发签名，自动安装暂不可用',unconfigured:'尚未配置更新服务',idle:'可检查更新',checking:'正在检查更新…',downloading:'正在下载并验证更新…',current:'当前没有可用新版本',ready:'新版本已下载，可安装并重启',installing:'正在退出并安装更新…',error:'更新未完成'};
export function bindUpdates({api,toast}){
  const form=document.querySelector('#update-form');if(!form)return;
  const show=status=>{if(!form.isConnected)return;form.querySelector('#update-status').textContent=(names[status.status]||status.status)+(status.error?`：${status.error}`:'');form.querySelector('#install-update').hidden=status.status!=='ready';};
  const request=async body=>{const error=form.querySelector('.form-error');error.hidden=true;try{const result=await api('/api/desktop/updates',body);show(result);return result;}catch(cause){error.hidden=false;error.textContent=cause.message;}};
  form.addEventListener('submit',async event=>{event.preventDefault();const result=await request({action:'configure',feedURL:form.elements.feedURL.value,enabled:form.elements.enabled.checked});if(result)toast('更新设置已保存');});
  form.querySelector('#check-update').addEventListener('click',()=>request({action:'check'}));
  form.querySelector('#install-update').addEventListener('click',()=>request({action:'install'}));
  void request();
  const timer=setInterval(()=>{if(form.isConnected)void request();else clearInterval(timer);},4000);
}

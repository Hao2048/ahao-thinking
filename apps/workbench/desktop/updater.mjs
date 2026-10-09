export function updateSettings(value={}) {
  const feedURL=String(value.feedURL||'').trim();
  if(feedURL){const url=new URL(feedURL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('更新地址需为 HTTPS，不能包含账号、查询参数或片段');}
  return{feedURL,enabled:value.enabled===true};
}
export function createUpdater({autoUpdater,supported,version,prepareInstall=async()=>{}}) {
  let settings=updateSettings(),timer;
  let state={supported,version,status:supported?'unconfigured':'unsupported',error:null};
  const status=()=>({...state,...settings});
  autoUpdater.on('checking-for-update',()=>{state={...state,status:'checking',error:null};});
  autoUpdater.on('update-available',()=>{state={...state,status:'downloading',error:null};});
  autoUpdater.on('update-not-available',()=>{state={...state,status:'current',checkedAt:new Date().toISOString(),error:null};});
  autoUpdater.on('error',()=>{state={...state,status:'error',error:'更新失败，请检查服务地址、网络及更新包签名',checkedAt:new Date().toISOString()};});
  autoUpdater.on('update-downloaded',(_event,_notes,name)=>{state={...state,status:'ready',releaseName:String(name||'新版本').slice(0,200),error:null};});
  function check(){
    if(!supported){state={...state,status:'unsupported',error:'当前为本地开发签名版本，正式签名后才能启用自动安装更新'};return status();}
    if(!settings.feedURL)throw new Error('请先配置更新服务地址');
    if(['checking','downloading','ready','installing'].includes(state.status))return status();
    state={...state,status:'checking',error:null};
    try{autoUpdater.setFeedURL({url:settings.feedURL,serverType:'json'});autoUpdater.checkForUpdates();}catch{state={...state,status:'error',error:'无法启动更新检查，请核对签名和服务配置'};}
    return status();
  }
  return{
    status,
    configure(value){
      if(['checking','downloading','ready','installing'].includes(state.status))throw new Error('更新进行中，完成后再修改更新服务');
      settings=updateSettings(value);clearInterval(timer);
      state={...state,status:!supported?'unsupported':settings.feedURL?'idle':'unconfigured',error:null};
      if(supported&&settings.enabled&&settings.feedURL){timer=setInterval(()=>{check();},6*60*60*1000);timer.unref?.();check();}
      return status();
    },
    check,
    requestInstall(){
      if(!supported||state.status!=='ready')throw new Error('尚无已验证并下载完成的更新');
      return{...status(),status:'installing'};
    },
    async install(){
      if(!supported||state.status!=='ready')throw new Error('尚无已验证并下载完成的更新');
      state={...state,status:'installing'};
      try{await prepareInstall();autoUpdater.quitAndInstall();}catch{state={...state,status:'error',error:'更新安装未完成，请退出应用后重试'};}
      return status();
    },
    close(){clearInterval(timer);},
  };
}

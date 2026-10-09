import { randomUUID, createHash } from 'node:crypto';
import { fetchPublicResource, extractPage } from '../src/research.mjs';

export function createDynamicReader({BrowserWindow,session}, fetcher=fetchPublicResource) {
  const windows=new Set(),controls=new Map();
  return {
    async page(value){
      const target=new URL(value);
      if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('动态取材仅支持公开 HTTP(S) 网页');
      if(windows.size>=2)throw new Error('动态网页正在读取，请稍后重试');
      const isolated=session.fromPartition(`research-${randomUUID()}`,{cache:false});
      // Electron derives its default user agent from the Chinese app name; HTTP headers require bytes.
      isolated.setUserAgent('Mozilla/5.0 AIPM-Workbench/1.0 public-research');
      isolated.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
      isolated.setPermissionCheckHandler(()=>false);
      isolated.on('will-download',event=>event.preventDefault());
      let requests=0,total=0;
      const abort=new AbortController();
      const handler=async request=>{
        try{
          if(!['GET','HEAD'].includes(request.method)||++requests>60||total>=12*1024*1024)throw new Error('请求已限制');
          const resource=await fetcher(request.url,{signal:abort.signal});
          total+=resource.bytes.length;if(total>12*1024*1024)throw new Error('页面资源超过限制');
          if(resource.url&&resource.url!==request.url)return new Response(null,{status:302,headers:{Location:resource.url}});
          if(resource.status<200||resource.status>=300)throw new Error('网页响应失败');
          const type=resource.headers['content-type']||'';
          if(!/text\/|javascript|json|xhtml/i.test(type))return new Response('',{status:415});
          const headers={...resource.headers};
          // No cookies, authentication, frames, workers, sockets, forms or OS bridge.
          if(/html/i.test(type))headers['Content-Security-Policy']="default-src http: https: data: blob: 'unsafe-inline'; script-src http: https: 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'";
          return new Response(request.method==='HEAD'?null:resource.bytes,{status:resource.status,headers});
        }catch{return new Response('Public research request blocked',{status:403});}
      };
      isolated.protocol.handle('http',handler);isolated.protocol.handle('https',handler);
      isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['http:','https:','data:','blob:'].includes(new URL(details.url).protocol)}));
      const window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:false,backgroundThrottling:false}});
      windows.add(window);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.webContents.on('will-navigate',event=>event.preventDefault());
      let timer;const control={abort,reject:()=>{}};controls.set(window,control);
      try{
        const task=(async()=>{
          await window.loadURL(target.href);
          const rendered=await window.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>resolve({html:document.documentElement.outerHTML,url:location.href}),3000))`);
          if(Buffer.byteLength(rendered.html)>2*1024*1024)throw new Error('动态页面内容过大');
          const parsed=extractPage(rendered.html);if(parsed.content.length<80)throw new Error('动态网页正文不足，可能需要登录或访问受限');
          return{...parsed,url:rendered.url,status:'page',method:'dynamic-render',warnings:['独立无登录状态的动态页面截取；正文可能尚未完整加载，访问限制不能绕过。'],retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(rendered.html).digest('hex')};
        })();
        return await Promise.race([task,new Promise((_,reject)=>{control.reject=reject;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('动态网页读取超过 45 秒')),45000);})]);
      }finally{
        clearTimeout(timer);abort.abort();controls.delete(window);windows.delete(window);if(!window.isDestroyed())window.destroy();
        isolated.protocol.unhandle('http');isolated.protocol.unhandle('https');
        await isolated.clearStorageData().catch(()=>{});
      }
    },
    close(){for(const [window,control]of controls){control.abort.abort();control.reject(new Error('应用正在退出，动态取材已停止'));if(!window.isDestroyed())window.destroy();}controls.clear();windows.clear();},
  };
}

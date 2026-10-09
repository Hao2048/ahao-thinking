const {app,BrowserWindow,session}=require('electron');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
app.setName('产品经理工作台');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const {createDynamicReader}=await import(pathToFileURL(path.resolve(__dirname,'../desktop/dynamic-research.mjs')));
  const {fetchPublicResource}=await import(pathToFileURL(path.resolve(__dirname,'../src/research.mjs')));
  const requests=[];
  const reader=createDynamicReader({BrowserWindow,session},async(url,options)=>{
    requests.push(url);
    if(url==='https://fixture.example/research')return{status:200,bytes:Buffer.from('<html><head><title>Dynamic fixture</title></head><body><main id="root"></main><script src="/app.js"></script></body></html>'),headers:{'content-type':'text/html'}};
    if(url==='https://fixture.example/app.js')return{status:200,bytes:Buffer.from(`setTimeout(async()=>{const r=await fetch('/data.json');const data=await r.json();document.querySelector('#root').textContent=data.text+' '+(typeof require)+' '+(typeof aipmDesktop);try{await fetch('/write',{method:'POST',body:'blocked'});document.querySelector('#root').textContent+=' POST checked';}catch{}},100);`),headers:{'content-type':'application/javascript'}};
    if(url==='https://fixture.example/data.json')return{status:200,bytes:Buffer.from(JSON.stringify({text:'Dynamic research fixture content loaded by JavaScript after fetching public JSON. This content is long enough to validate extraction of rendered pages and real script execution.'})),headers:{'content-type':'application/json'}};
    return fetchPublicResource(url,options);
  });
  global.testDynamic=async()=>{
    const page=await reader.page('https://fixture.example/research');
    let blocked=false;try{await reader.page('http://127.0.0.1/');}catch{blocked=true;}
    return{page,blocked,requests};
  };
  const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  await window.loadURL('about:blank');
});

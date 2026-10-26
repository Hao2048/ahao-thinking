import {harnessSearch,nativeSearchConnection} from './harness-search.mjs';
import {builtinSearch} from './builtin-search.mjs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { dependency } from './dependencies.mjs';
import { text } from './domain.mjs';

export const searchDefaults = { provider: 'builtin', baseURL: '', apiKey: '', apiKeyEnv: '' };
const endpoints = { tavily: 'https://api.tavily.com/search', brave: 'https://api.search.brave.com/res/v1/web/search' };
export function searchSettings(body, previous = searchDefaults) {
  if (!['none','builtin','tavily','brave','searxng'].includes(body.provider)) throw new Error('检索服务不支持');
  if(['none','builtin'].includes(body.provider))return{...searchDefaults};
  const baseURL = String(body.baseURL || endpoints[body.provider] || '').trim();
  if (body.provider !== 'none') {
    const url = new URL(baseURL);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('检索服务地址需为 HTTP(S)，不能含账号、查询参数或片段');
  }
  const apiKeyEnv = String(body.apiKeyEnv || '').trim();
  if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{0,100}$/.test(apiKeyEnv)) throw new Error('检索密钥环境变量不合法');
  return { provider:body.provider, baseURL, apiKeyEnv, apiKey: body.clearKey ? '' : body.apiKey ? text(body.apiKey,'检索密钥',8000) : apiKeyEnv ? '' : previous.provider===body.provider && previous.baseURL===baseURL ? previous.apiKey || '' : '' };
}
export function publicSearch(settings = searchDefaults) {
  if(['none','builtin'].includes(settings.provider))return{provider:'builtin',baseURL:'',apiKeyEnv:'',configured:true,builtin:true};
  const { apiKey, ...rest } = settings;
  return {...rest, configured: settings.provider !== 'none' && Boolean(settings.baseURL) && (settings.provider === 'searxng' || Boolean(apiKey || (settings.apiKeyEnv && process.env[settings.apiKeyEnv])))};
}
export function publicAddress(address) {
  if (isIP(address) === 6) {
    // IPv4-mapped, loopback, link-local and unique-local addresses are not web sources.
    const lower=new URL(`http://[${address}]/`).hostname.slice(1,-1).toLowerCase();
    return /^2[0-9a-f]{3}:/.test(lower) && !/^2001:(?:db8|[0-9a-f]{1,2}|1[0-9a-f]{2}):/.test(lower);
  }
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||address.startsWith('192.0.2.')||address.startsWith('198.51.100.')||address.startsWith('203.0.113.'));
}
export async function publicTarget(value, {resolveAddresses=lookup, resolveFetch=fetch} = {}) {
  const url = new URL(value);
  if(url.protocol!=='https:'&&url.protocol!=='http:'||url.username||url.password)throw new Error('网页仅接受无账号的 HTTP(S) 地址');
  if(url.port&&!['80','443'].includes(url.port))throw new Error('网页来源只允许标准 HTTP(S) 端口');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  let addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolveAddresses(hostname,{all:true});
  const proxyFake = !isIP(hostname) && addresses.length && addresses.every(item=>/^198\.(18|19)\./.test(item.address) || (isIP(item.address)===6 && new URL(`http://[${item.address}]/`).hostname.startsWith('[2001:2:')));
  if (proxyFake) {
    // Clash fake-IP occupies the benchmarking range. Resolve only these fake
    // answers through a fixed HTTPS resolver; validate and pin the real answers.
    const endpoint=new URL('https://cloudflare-dns.com/dns-query');endpoint.searchParams.set('name',hostname);endpoint.searchParams.set('type','A');
    const response=await resolveFetch(endpoint,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();throw new Error('代理 DNS 返回虚拟 IP，公共 DNS 解析未能完成');}
    const result=JSON.parse((await boundedBody(response,65536)).toString('utf8'));
    addresses=(result.Answer||[]).filter(answer=>answer.type===1&&isIP(answer.data)===4).map(answer=>({address:answer.data,family:4}));
    if(!addresses.length || addresses.some(item=>!publicAddress(item.address)))throw new Error('代理返回虚拟DNS地址，安全公共解析未取得有效公网地址；请检查代理DNS设置。未访问该来源。');
  }
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('网页来源不能访问本机、内网或保留地址');
  return {url,addresses};
}
async function boundedBody(response, limit = 2*1024*1024) {
  if(Number(response.headers.get('content-length'))>limit)throw new Error('网页响应超过大小上限');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('网页响应超过大小上限');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export function extractPage(html) {
  const $=dependency('cheerio').load(html);
  const title=$('title').first().text().trim();
  const publishedAt=$('meta[property="article:published_time"]').attr('content') || $('meta[name="date"]').attr('content') || null;
  $('script,style,noscript,nav,header,footer,form,iframe,svg').remove();
  $('p,div,li,h1,h2,h3,tr,br').each((_index,element)=>{$(element).append('\n');});
  const body=$('article').first().length?$('article').first():$('main').first().length?$('main').first():$('body');
  const raw=body.text().replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
  return {title,content:raw.slice(0,24000),publishedAt,truncated:raw.length>24000};
}
// All requests made by the isolated dynamic renderer use this same pinned,
// public-address transport, including scripts, XHR and redirect targets.
export async function fetchPublicResource(value, { signal, limit=2*1024*1024 } = {}) {
  const {Agent,fetch}=dependency('undici');let current=value;
  for(let hop=0;hop<4;hop++){
    const {url,addresses}=await publicTarget(current);
    const dispatcher=new Agent({connect:{lookup:(_hostname,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family)}});
    try{
      const response=await fetch(url,{dispatcher,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{Accept:'text/html,application/javascript,text/css,application/json,text/plain','User-Agent':'AIPM-Workbench/1.0 public research'}});
      if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('重定向缺少目标');current=new URL(location,url).href;continue;}
      const bytes=await boundedBody(response,limit);
      return{url:url.href,status:response.status,bytes,headers:Object.fromEntries(['content-type','access-control-allow-origin'].map(name=>[name,response.headers.get(name)]).filter(([,value])=>value))};
    }finally{await dispatcher.close();}
  }
  throw new Error('重定向次数过多');
}
export class WebResearch {
  constructor({dynamicPage,searchPage=fetchPublicResource}={}){this.dynamicPage=dynamicPage;this.searchPage=searchPage;}
  async page(value, {signal} = {}) {
    const {Agent,fetch}=dependency('undici');let current=value;
    for(let hop=0;hop<4;hop++) {
      signal?.throwIfAborted();
      const {url,addresses}=await publicTarget(current);
      signal?.throwIfAborted();
      const dispatcher=new Agent({connect:{lookup:(_hostname,options,callback)=>{const first=addresses[0];if(options.all)callback(null,addresses);else callback(null,first.address,first.family);}}});
      try{
        const response=await fetch(url,{dispatcher,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'User-Agent':'AIPM-Workbench/0.3 (+local research)','Accept':'text/html,text/plain'}});
        if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new Error('网页重定向缺少目标');current=new URL(location,url).href;continue;}
        if(!response.ok){await response.body?.cancel();throw new Error(`网页返回 HTTP ${response.status}`);}
        const type=response.headers.get('content-type')||'';
        if(!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)){await response.body?.cancel();throw new Error('链接未返回文字网页，PDF 等文件请下载后上传');}
        const bytes=await boundedBody(response);
        const charset=(type.match(/charset=([^;\s]+)/i)?.[1]||'utf-8').replace(/["']/g,'');
        const raw=new TextDecoder(charset).decode(bytes);
        const parsed=/text\/plain/i.test(type)?{title:url.hostname,content:raw.slice(0,24000),publishedAt:null,truncated:raw.length>24000}:extractPage(raw);
        if(parsed.content.length<80)throw new Error('网页正文过少，可能需要登录、JavaScript 或存在访问限制');
        return {...parsed,url:url.href,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),status:'page'};
      }finally{await dispatcher.close();}
    }
    throw new Error('网页重定向次数过多');
  }
  async search(settings=searchDefaults, query, connection, signal) {
    query=text(query,'检索词',600);
    if(publicSearch(settings).builtin){if(nativeSearchConnection(connection))return harnessSearch(query,connection,{signal});return builtinSearch(query,this.searchPage,{signal});}
    if(!publicSearch(settings).configured)throw new Error('请先在设置配置检索服务，或只填写网页链接');
    const key=settings.apiKey||process.env[settings.apiKeyEnv];
    const url=new URL(settings.baseURL);let options={signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{Accept:'application/json'}};
    if(settings.provider==='tavily')options={...options,method:'POST',headers:{...options.headers,'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({query,max_results:5,include_answer:false,include_raw_content:false,search_depth:'basic'})};
    else{url.searchParams.set('q',query);if(settings.provider==='brave')options.headers['X-Subscription-Token']=key;else{url.searchParams.set('format','json');if(key)options.headers.Authorization=`Bearer ${key}`;}}
    // The explicit search endpoint may be an internal SearXNG service; source pages remain public-only.
    const response=await fetch(url,options);
    if(!response.ok){await response.body?.cancel();throw new Error(`检索服务返回 HTTP ${response.status}，请核对设置或配额`);}
    const result=JSON.parse((await boundedBody(response)).toString('utf8'));
    const items=settings.provider==='brave'?result.web?.results:result.results;
    if(!Array.isArray(items))throw new Error('检索服务返回格式错误');
    return items.slice(0,5).filter(item=>typeof item.url==='string').map(item=>({url:item.url,title:String(item.title||item.url).slice(0,300),snippet:String(item.content||item.description||'').replace(/<[^>]+>/g,'').slice(0,2000)}));
  }
  async collect(settings, {queries = [], urls = [], dynamic = false}, {connection,signal}={}) {
    signal?.throwIfAborted();
    if(typeof dynamic!=='boolean')throw new Error('网页读取方式无效');
    if(dynamic&&!this.dynamicPage)throw new Error('动态网页取材仅支持 Mac 桌面版');
    if(!Array.isArray(queries)||queries.length>3||!Array.isArray(urls)||urls.length>4)throw new Error('最多 3 个检索词、4 个指定链接');
    queries=queries.map(query=>text(query,'检索词',600));urls=urls.map(url=>text(url,'网页链接',2000));
    if(!queries.length&&!urls.length)throw new Error('请填写检索词或网页链接');
    const candidates=urls.map(url=>({url,title:url,snippet:''}));const failures=[];
    for(const query of queries){signal?.throwIfAborted();try{candidates.push(...await this.search(settings,query,connection,signal));}catch(error){signal?.throwIfAborted();failures.push({query,error:error.message});}}
    const selected=[...new Map(candidates.map(item=>[item.url,item])).values()].slice(0,6);
    const sources=[];
    for(let index=0;index<selected.length;index+=2){
      signal?.throwIfAborted();
      const settled=await Promise.allSettled(selected.slice(index,index+2).map(item=>dynamic?this.dynamicPage(item.url,{signal}):this.page(item.url,{signal})));
      signal?.throwIfAborted();
      for(let slot=0;slot<settled.length;slot++){
        const entry=selected[index+slot],result=settled[slot];
        if(result.status==='fulfilled')sources.push({...result.value,searchEngine:entry.engine||null,searchURL:entry.searchURL||null});
        else{
          failures.push({url:entry.url,error:result.reason.message});
          // Search snippets are useful evidence, but are labelled and never presented as fetched pages.
          if(entry.snippet){try{await publicTarget(entry.url);sources.push({url:entry.url,title:entry.title,content:entry.snippet,status:'snippet',searchEngine:entry.engine||null,searchURL:entry.searchURL||null,publishedAt:null,retrievedAt:new Date().toISOString(),truncated:false,sha256:createHash('sha256').update(entry.snippet).digest('hex')});}catch{}}
        }
      }
    }
    return {queries,requestedURLs:urls,sources,failures,createdAt:new Date().toISOString()};
  }
}

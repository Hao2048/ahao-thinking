import {dependency} from './dependencies.mjs';
export const builtinEngines=[{id:'brave-web',url:'https://search.brave.com/search'},{id:'bing-web',url:'https://www.bing.com/search'},{id:'duckduckgo-web',url:'https://html.duckduckgo.com/html/'}];
export function searchLinks(engine,html,searchURL){
 const $=dependency('cheerio').load(html),results=[];
 const selector=engine==='brave-web'?'.snippet':engine==='bing-web'?'.b_algo':'.result';
 $(selector).each((_,element)=>{
  const block=$(element),anchor=engine==='bing-web'?block.find('h2 a').first():engine==='duckduckgo-web'?block.find('.result__a').first():block.find('a[href]').filter((_,a)=>/^https?:\/\//.test($(a).attr('href')||'')).first();
  let href=anchor.attr('href');if(!href)return;
  try{let url=new URL(href,searchURL);if(url.hostname.endsWith('duckduckgo.com')&&url.searchParams.has('uddg'))url=new URL(url.searchParams.get('uddg'));
   if(url.hostname.endsWith('bing.com')&&url.pathname==='/ck/a'){const target=url.searchParams.get('u');if(target?.startsWith('a1'))url=new URL(Buffer.from(target.slice(2),'base64url').toString());}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/^(search\.brave\.com|www\.bing\.com|html\.duckduckgo\.com|duckduckgo\.com)$/.test(url.hostname))return;
   const title=(block.find('h2,h3,.title').first().text()||anchor.text()).replace(/\s+/g,' ').trim();
   const snippet=(block.find('.snippet-description,.b_caption p,.result__snippet').first().text()||block.text()).replace(/\s+/g,' ').trim();
   if(!title)return;results.push({url:url.href,title:title.slice(0,300),snippet:snippet.slice(0,2000),engine,searchURL});
  }catch{}
 });
 return [...new Map(results.map(item=>[item.url,item])).values()].slice(0,5);
}
export async function builtinSearch(query,fetcher,{signal}={}){
 const failures=[];
 for(const engine of builtinEngines){signal?.throwIfAborted();const url=new URL(engine.url);url.searchParams.set('q',query);if(engine.id==='bing-web'){url.searchParams.set('setlang','zh-hans');url.searchParams.set('cc','cn');}
  try{const response=await fetcher(url.href,{limit:2*1024*1024,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
   if(response.status!==200)throw new Error(`HTTP ${response.status}`);
   const items=searchLinks(engine.id,response.bytes.toString('utf8'),url.href);if(!items.length)throw new Error('未返回可用结果，可能遇到验证、访问限制或无结果');return items;
  }catch(error){signal?.throwIfAborted();failures.push(`${engine.id}：${error.message}`);}
 }
 throw new Error('默认联网检索暂不可用，请检查网络，稍后重试或在设置中选择专业检索服务。'+failures.join('；'));
}

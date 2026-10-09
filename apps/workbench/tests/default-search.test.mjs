import test from 'node:test';import assert from 'node:assert/strict';import {publicSearch} from '../src/research.mjs';
test('fresh and legacy unset search settings permit built-in web search without another key',()=>{
 assert.equal(publicSearch().configured,true,'新安装应用应可直接联网检索');assert.equal(publicSearch({provider:'none',baseURL:'',apiKey:''}).configured,true,'旧版未配置状态应升级为默认联网检索');
});
import {builtinSearch,searchLinks} from '../src/builtin-search.mjs';
import {WebResearch,searchSettings} from '../src/research.mjs';
test('public search parsers read result blocks, decode redirects and ignore page scripts',()=>{
 const brave=searchLinks('brave-web','<script>https://wrong.example</script><div class="snippet"><a href="https://example.com/product"><div class="title">产品官网</div></a><p class="snippet-description">产品介绍</p></div>','https://search.brave.com/search');assert.equal(brave[0].url,'https://example.com/product');assert.equal(brave[0].snippet,'产品介绍');
 const target='https://example.com/report',u='a1'+Buffer.from(target).toString('base64url');
 assert.equal(searchLinks('bing-web',`<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${u}">报告</a></h2><div class="b_caption"><p>公开报告</p></div></li>`,'https://www.bing.com/search')[0].url,target);
 assert.equal(searchLinks('duckduckgo-web','<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freport">报告</a></div>','https://html.duckduckgo.com/html/')[0].url,target);
 assert.equal(searchLinks('bing-web','<h2><a href="https://example.com">非结果</a></h2>','https://www.bing.com/search').length,0);
});
test('built-in search falls back on blocked engines and never treats verification pages as results',async()=>{
 const calls=[];const items=await builtinSearch('公开检索词',async url=>{calls.push(url);return{status:calls.length===1?429:200,bytes:Buffer.from('<li class="b_algo"><h2><a href="https://example.com/report">报告</a></h2><p>公开事实</p></li>')};});assert.equal(calls.length,2);assert.equal(items[0].engine,'bing-web');assert.equal(new URL(calls[1]).searchParams.get('q'),'公开检索词');
 let failures=0;await assert.rejects(builtinSearch('公开检索词',async()=>{failures++;return{status:200,bytes:Buffer.from('<form>请完成验证码</form>')};}),/默认联网检索暂不可用/);assert.equal(failures,3);
});
test('legacy unset settings use real built-in adapter and retain page provenance without credentials',async()=>{
 let requested;const research=new WebResearch({searchPage:async url=>{requested=url;return{status:200,bytes:Buffer.from('<div class="snippet"><a href="https://example.com/report"><div class="title">公开报告</div></a></div>')};}});research.page=async url=>({url,title:'公开报告',content:'公开正文',status:'page',retrievedAt:new Date().toISOString()});
 const result=await research.collect({provider:'none'},{queries:['测试公开词']});assert.equal(new URL(requested).searchParams.get('q'),'测试公开词');assert.equal(result.sources[0].searchEngine,'brave-web');assert.equal(result.sources[0].status,'page');assert.ok(result.sources[0].searchURL);assert.deepEqual(searchSettings({provider:'builtin'},{provider:'tavily',apiKey:'old-secret'}),{provider:'builtin',baseURL:'',apiKey:'',apiKeyEnv:''});
});
import {createServer} from 'node:http';import {nativeSearchConnection} from '../src/harness-search.mjs';
test('automatic retrieval reuses DeepSeek connection through actual Harness native search provider',async()=>{
 const requests=[];let missing=false;const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;requests.push({url:req.url,headers:req.headers,body:JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({content:missing?[{type:'text',text:'没有实际搜索'}]:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://example.com/pet',title:'电子宠物',page_age:'2026-10-01'}]},{type:'text',text:'引用',citations:[{url:'https://example.com/pet',cited_text:'实际搜索引用'}]}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const connection={api:'deepseek-messages',baseURL:`http://127.0.0.1:${server.address().port}/anthropic`,apiKey:'fixture-native-secret',model:'deepseek-v4-pro'};assert.equal(nativeSearchConnection({api:'openai-completions',apiKey:'other'}),null);
 const research=new WebResearch({searchPage:async()=>{throw new Error('必须使用原生检索');}});research.page=async url=>({url,title:'电子宠物',content:'测试网页正文',status:'page',retrievedAt:new Date().toISOString()});const result=await research.collect({provider:'none'},{queries:['电子宠物 陪伴']},{connection});assert.equal(result.sources[0].searchEngine,'deepseek-harness');assert.equal(result.failures.length,0);assert.equal(requests[0].url,'/anthropic/v1/messages');assert.equal(requests[0].headers['x-api-key'],connection.apiKey);assert.equal(requests[0].body.tools[0].type,'web_search_20250305');assert.match(requests[0].body.messages[0].content[0].text,/电子宠物 陪伴/);assert.ok(!JSON.stringify(result).includes(connection.apiKey));
 missing=true;await assert.rejects(research.search(undefined,'查询',connection),/原生联网检索失败/);
 }finally{await new Promise(r=>server.close(r));}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebResearch, extractPage, publicAddress, publicSearch, searchSettings } from '../src/research.mjs';
test('web source addresses reject local, private, reserved and mapped hosts',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
  await assert.rejects(new WebResearch().page('http://127.1/secret'),/本机/);
  await assert.rejects(new WebResearch().page('file:///etc/passwd'),/HTTP/);
});
test('HTML extraction excludes execution and navigation, labels truncation and date metadata',()=>{
  const result=extractPage('<html><head><title>报告</title><meta property="article:published_time" content="2026-10-01"></head><body><nav>导航内容</nav><article><h1>用户研究</h1><p>独处上班族需要陪伴</p><script>stealSecret()</script></article></body></html>');
  assert.match(result.content,/独处/);assert.ok(!result.content.includes('stealSecret'));assert.ok(!result.content.includes('导航内容'));assert.equal(result.publishedAt,'2026-10-01');
  assert.equal(extractPage(`<article>${'a'.repeat(30000)}</article>`).truncated,true);
});
test('search settings never expose or carry credentials across endpoints',()=>{
  const saved=searchSettings({provider:'tavily',apiKey:'secret'});
  assert.ok(publicSearch(saved).configured);assert.equal('apiKey' in publicSearch(saved),false);
  assert.equal(searchSettings({provider:'tavily'},saved).apiKey,'secret');
  assert.equal(searchSettings({provider:'brave'},saved).apiKey,'');
  assert.equal(searchSettings({provider:'tavily',baseURL:'https://another.example/search'},saved).apiKey,'');
});
test('all three real provider adapters use expected request shape and collect snippet failures',async()=>{
  const requests=[];
  const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.startsWith('/brave')?{web:{results:[{url:'https://93.184.215.14/report',title:'报告',description:'搜索摘要'}]}}:{results:[{url:'https://93.184.215.14/report',title:'报告',content:'搜索摘要'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const research=new WebResearch();research.page=async()=>{throw new Error('fixture: HTTP 403');};
  try{
    for(const provider of ['tavily','brave','searxng']){
      const settings={provider,baseURL:`http://127.0.0.1:${server.address().port}/${provider}`,apiKey:'fixture-search-key'};
      const result=await research.collect(settings,{queries:['AI companion'],urls:[]});
      assert.equal(result.sources[0].status,'snippet');assert.equal(result.failures.length,1);
    }
    assert.equal(requests[0].headers.authorization,'Bearer fixture-search-key');assert.equal(JSON.parse(requests[0].body).query,'AI companion');
    assert.equal(requests[1].headers['x-subscription-token'],'fixture-search-key');assert.match(requests[2].url,/format=json/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

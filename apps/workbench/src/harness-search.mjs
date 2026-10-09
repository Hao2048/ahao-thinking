import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export function nativeSearchConnection(connection){
 if(connection?.api!=='deepseek-messages')return null;
 const key=connection.apiKey||process.env[connection.apiKeyEnv];if(!key)return null;
 const base=new URL(connection.baseURL);base.pathname=base.pathname.replace(/\/$/,'').replace(/\/messages$/,'');if(!base.pathname.endsWith('/v1'))base.pathname+='/v1';
 return{apiKey:key,baseURL:base.href.replace(/\/$/,''),model:'deepseek-v4-flash',apiVersion:'2023-06-01',maxTokens:2048,maxUses:3};
}
export async function harnessSearch(query,connection){
 const options=nativeSearchConnection(connection);if(!options)throw new Error('DeepSeek 原生检索需要已有的 DeepSeek 模型连接');
 const entry=process.env.AIPM_HARNESS_NODE_MODULES?join(process.env.AIPM_HARNESS_NODE_MODULES,'@deepseek-ai/dsh-web-search-deepseek/lib/index.js'):resolve(import.meta.dirname,'../../../deepseek-harness/packages/web/web-search-deepseek/lib/index.js');
 const {DeepSeekSearchProvider}=await import(pathToFileURL(entry).href);
 try{
  const result=await new DeepSeekSearchProvider(()=>options).search({query,maxResults:5},AbortSignal.timeout(90000));
  return result.sources.slice(0,5).map(s=>({url:s.url,title:s.title||s.url,snippet:s.snippet||'',publishedAt:s.publishedAt||null,engine:'deepseek-harness',searchURL:null}));
 }catch(error){throw new Error('DeepSeek Harness 原生联网检索失败：'+String(error.message).replaceAll(options.apiKey,'[已隐藏]'));}
}

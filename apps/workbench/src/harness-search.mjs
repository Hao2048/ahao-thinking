import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {modelFailure} from './model-errors.mjs';
export function nativeSearchConnection(connection){
 if(connection?.api!=='deepseek-messages')return null;
 const key=connection.apiKey||process.env[connection.apiKeyEnv];if(!key)return null;
 const base=new URL(connection.baseURL);base.pathname=base.pathname.replace(/\/$/,'').replace(/\/messages$/,'');if(!base.pathname.endsWith('/v1'))base.pathname+='/v1';
 return{apiKey:key,baseURL:base.href.replace(/\/$/,''),model:connection.model,apiVersion:'2023-06-01',maxTokens:2048,maxUses:3};
}
export async function harnessSearch(query,connection,{signal}={}){
 const options=nativeSearchConnection(connection);if(!options)throw new Error('DeepSeek 原生检索需要已有的 DeepSeek 模型连接');
 const entry=process.env.AIPM_HARNESS_NODE_MODULES?join(process.env.AIPM_HARNESS_NODE_MODULES,'@deepseek-ai/dsh-web-search-deepseek/lib/index.js'):resolve(import.meta.dirname,'../../../deepseek-harness/packages/web/web-search-deepseek/lib/index.js');
 const {DeepSeekSearchProvider}=await import(pathToFileURL(entry).href);
 try{
  const result=await new DeepSeekSearchProvider(()=>options).search({query,maxResults:5},signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000));
  return result.sources.slice(0,5).map(s=>({url:s.url,title:s.title||s.url,snippet:s.snippet||'',publishedAt:s.publishedAt||null,engine:'deepseek-harness',searchURL:null}));
 }catch(error){const failure=modelFailure(error);throw Object.assign(new Error('DeepSeek 原生联网检索失败：'+failure.message+' 可在“模型与连接”检查模型和检索服务。'),{code:failure.code});}
}

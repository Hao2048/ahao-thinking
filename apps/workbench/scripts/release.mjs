import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
export function releaseOptions(env=process.env){
  const identity=env.AIPM_SIGN_IDENTITY,profile=env.AIPM_NOTARY_PROFILE;
  if(!identity?.startsWith('Developer ID Application:'))throw new Error('正式发布需 AIPM_SIGN_IDENTITY 指定 Developer ID Application 证书；开发证书不能替代');
  if(!profile)throw new Error('正式发布需 AIPM_NOTARY_PROFILE 指定已保存的 notarytool 钥匙串凭据配置');
  if(!env.AIPM_RELEASE_BASE_URL)throw new Error('正式发布需 AIPM_RELEASE_BASE_URL 指定 HTTPS 发布目录');
  const base=new URL(env.AIPM_RELEASE_BASE_URL);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('发布目录需无账号、查询参数和片段的 HTTPS 地址');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  return{identity,profile,baseURL:base.href};
}
export async function notarize(file,{profile},run,stapleTarget=file){
  const output=await run('/usr/bin/xcrun',['notarytool','submit',file,'--keychain-profile',profile,'--wait','--output-format','json'],{maxBuffer:1024*1024});
  const report=JSON.parse(output.stdout);
  if(report.status!=='Accepted')throw new Error(`Apple 公证未通过（${report.status||'未知状态'}），请用 notarytool log 查看任务 ${report.id||''}`);
  await run('/usr/bin/xcrun',['stapler','staple',stapleTarget]);
  await run('/usr/bin/xcrun',['stapler','validate',stapleTarget]);
  return{id:report.id,status:report.status};
}
export async function fileDigest(file){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(file)){hash.update(chunk);size+=chunk.length;}return{sha256:hash.digest('hex'),size};}
export function updateManifest({version,architecture,baseURL,digest,notes='',date=new Date().toISOString()}){
  if(!/^\d+\.\d+\.\d+$/.test(version)||!['arm64','x64'].includes(architecture))throw new Error('发布版本或架构不合法');
  const url=new URL(`aipm-workbench-${version}-mac-${architecture}.zip`,baseURL).href;
  if(new URL(url).protocol!=='https:')throw new Error('更新包需 HTTPS 地址');
  return{currentRelease:version,releases:[{version,updateTo:{version,url,name:`阿浩Thinking ${version}`,notes,pub_date:date,...digest}}]};
}

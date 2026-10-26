import {mkdir,readFile,writeFile,cp,readdir,rename,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function load(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function exists(path){try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function files(root,prefix=''){
 const out={};if(!await exists(root))return out;
 for(const e of await readdir(root,{withFileTypes:true})){
  if(e.isSymbolicLink())throw new Error('节点包中不允许符号链接');
  const rel=prefix+e.name;if(e.isDirectory())Object.assign(out,await files(join(root,e.name),rel+'/'));else if(e.isFile())out[rel]=hash(await readFile(join(root,e.name)));
 }return out;
}
async function atomicJSON(path,value){const temp=path+'.tmp-'+randomUUID();await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,path);}
export async function installBundledNodes(source,destination){
 await mkdir(destination,{recursive:true});
 const journalPath=join(destination,'_upgrade-journal.json');
 const journal=await load(journalPath);
 if(journal.name){
  // The journal only names direct children created by this installer.
  if(![journal.name,journal.stage,journal.backup].every(n=>typeof n==='string'&&/^[A-Za-z0-9_.-]+$/.test(n)&&n!=='.'&&n!=='..'))throw new Error('节点升级恢复记录无效');
  const target=join(destination,journal.name),backup=join(destination,journal.backup);
  if(!await exists(target)&&await exists(backup))await rename(backup,target);
  else if(await exists(target))await rm(backup,{recursive:true,force:true});
  await rm(join(destination,journal.stage),{recursive:true,force:true});await rm(journalPath,{force:true});
 }
 const previous=await load(join(destination,'_managed-files.json')),baseline=await load(join(source,'_bundled-baselines.json')),managed={...previous},conflicts=[];
 for(const entry of await readdir(source,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='_bundled-baselines.json')continue;
  if(!entry.isDirectory()&&!entry.isFile())throw new Error('节点资源类型无效');
  const name=entry.name,src=join(source,name),target=join(destination,name);
  const incoming=entry.isDirectory()?await files(src):{[name]:hash(await readFile(src))};
  const current=entry.isDirectory()?await files(target):await exists(target)?{[name]:hash(await readFile(target))}:{};
  const rel=key=>entry.isDirectory()?name+'/'+key:key;
  const changed=Object.keys(current).filter(key=>current[key]!==incoming[key]&&current[key]!==previous[rel(key)]&&current[key]!==baseline[rel(key)]);
  if(changed.length){conflicts.push(...changed.map(rel));continue;}
  if(JSON.stringify(current)===JSON.stringify(incoming)){for(const [key,value]of Object.entries(incoming))managed[rel(key)]=value;continue;}
  const stage='.stage-'+randomUUID(),backup='.backup-'+randomUUID();
  await cp(src,join(destination,stage),{recursive:entry.isDirectory()});
  await atomicJSON(journalPath,{name,stage,backup});
  if(await exists(target))await rename(target,join(destination,backup));
  await rename(join(destination,stage),target);
  await rm(join(destination,backup),{recursive:true,force:true});await rm(journalPath,{force:true});
  for(const key of Object.keys(managed))if(entry.isDirectory()?key.startsWith(name+'/'):key===name)delete managed[key];
  for(const [key,value]of Object.entries(incoming))managed[rel(key)]=value;
 }
 await atomicJSON(join(destination,'_managed-files.json'),managed);
 await atomicJSON(join(destination,'_upgrade-conflicts.json'),{conflicts,checkedAt:new Date().toISOString()});
 return {conflicts};
}

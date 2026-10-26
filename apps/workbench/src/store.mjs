import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const settled=run=>['succeeded','failed','cancelled'].includes(run.status);
export class Store {
  #state;
  #tail = Promise.resolve();
  #records = new Map();
  constructor(directory, codec = { decode: async value => value, encode: async value => value }) { this.directory = directory; this.codec = codec; }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.#state = JSON.parse(await this.codec.decode(await readFile(join(this.directory, 'state.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.#state = { schemaVersion: 2, projects: [], models: [], settings: { activeModelId: null } }; }
    if (![1,2].includes(this.#state.schemaVersion) || !Array.isArray(this.#state.projects) || !Array.isArray(this.#state.models)) throw new Error('本地数据格式不支持');
    if(this.#state.schemaVersion===1&&this.#state.projects.some(p=>(p.workflows||[]).some(f=>f.runs?.length))){
      const backupDir=join(this.directory,'storage-layout-backups');await mkdir(backupDir,{recursive:true,mode:0o700});
      await writeFile(join(backupDir,`before-v2-${Date.now()}-${randomUUID()}.json`),await readFile(join(this.directory,'state.json')),{mode:0o600,flag:'wx'});
    }
    for(const p of this.#state.projects)for(const f of p.workflows||[])for(let i=0;i<(f.runs||[]).length;i++){
      const ref=f.runs[i].storageRef;if(!ref)continue;
      if(!/^run-records\/[a-f0-9]{64}\.json$/.test(ref))throw new Error('运行记录引用无效');
      const raw=await this.codec.decode(await readFile(join(this.directory,ref),'utf8'));
      if(hash(raw)!==ref.slice(12,-5))throw new Error('运行记录校验失败');
      f.runs[i]=JSON.parse(raw);this.#records.set(ref,true);
    }
    const retiredKeys = ['inputs','runs','messages','researchDrafts','researchWorkflow','moduleContexts'];
    if (this.#state.projects.some(p => retiredKeys.some(k => Object.hasOwn(p,k)))) {
      const backupDir = join(this.directory, 'retired-module-backups');
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      await writeFile(join(backupDir, `state-${Date.now()}-${randomUUID()}.json`), await readFile(join(this.directory,'state.json')), { mode: 0o600, flag: 'wx' });
    }
    await this.update(state => {
      state.schemaVersion=2;
      for(const project of state.projects){
        for(const flow of project.workflows||[]){
          for(const r of flow.runs||[])if(r.status==='running'){r.status='failed';r.error='服务已重启，上次运行中断，请重新运行';for(const n of Object.values(r.nodes||{}))if(['running','queued'].includes(n.status))n.status='failed';}
          for(const m of flow.messages||[])if(m.status==='streaming'){m.status='failed';m.error='服务重启，回复中断';}
        }
        for (const key of retiredKeys) delete project[key];
        project.workflows ??= [];
      }
    });
  }
  read(select = state => state) { return structuredClone(select(this.#state)); }
  async #write(path,raw){
    const temporary=path+'.tmp-'+randomUUID();
    try{await writeFile(temporary,await this.codec.encode(raw),{mode:0o600,flag:'wx'});await rename(temporary,path);}
    finally{await rm(temporary,{force:true});}
  }
  async #persist(next){
    await mkdir(join(this.directory,'run-records'),{recursive:true,mode:0o700});
    const projects=[];
    for(const p of next.projects){
      const workflows=[];
      for(const f of p.workflows||[]){
        const runs=[];
        for(const run of f.runs||[]){
          if(!settled(run)){runs.push(run);continue;}
          // Content-addressed immutable records: commit blobs before the index.
          const raw=JSON.stringify(run),ref='run-records/'+hash(raw)+'.json';
          if(!this.#records.has(ref)){await this.#write(join(this.directory,ref),raw);this.#records.set(ref,true);}
          runs.push({storageRef:ref});
        }
        workflows.push({...f,runs});
      }
      projects.push({...p,...p.workflows?{workflows}:{}});
    }
    await this.#write(join(this.directory,'state.json'),JSON.stringify({...next,projects}));
  }
  update(change, {projectId,flowId} = {}) {
    const task = this.#tail.then(async () => {
      const next = projectId ? {...this.#state,projects:this.#state.projects.map(p=>p.id!==projectId?p:flowId?{...p,workflows:(p.workflows||[]).map(f=>f.id===flowId?structuredClone(f):f)}:structuredClone(p))} : structuredClone(this.#state);
      const result = change(next);
      if(result?.then)throw new Error('存储事务必须是同步修改');
      await this.#persist(next);
      this.#state = next;
      return structuredClone(result);
    });
    this.#tail = task.catch(() => {});
    return task;
  }
}

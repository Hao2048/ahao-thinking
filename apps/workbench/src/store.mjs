import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  #state;
  #tail = Promise.resolve();
  constructor(directory, codec = { decode: async value => value, encode: async value => value }) { this.directory = directory; this.codec = codec; }
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.#state = JSON.parse(await this.codec.decode(await readFile(join(this.directory, 'state.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.#state = { schemaVersion: 1, projects: [], models: [], settings: { activeModelId: null } }; }
    if (this.#state.schemaVersion !== 1 || !Array.isArray(this.#state.projects) || !Array.isArray(this.#state.models)) throw new Error('本地数据格式不支持');
    await this.update(state => {
      for(const project of state.projects){
        for(const item of [...project.inputs||[],...project.messages||[],...project.runs||[],...project.researchDrafts||[]])if(['competitor','user'].includes(item.moduleId)){item.legacyModuleId=item.moduleId;item.moduleId='idea';}
        if(project.researchWorkflow?.phase==='preparing')project.researchWorkflow.phase='failed';
      }
      for(const project of state.projects)for(const message of project.messages||[])if(['streaming','working'].includes(message.status)){message.status='failed';message.error='服务已重启，上次回复中断，可重试';}
      for (const project of state.projects) for (const run of project.runs) if (run.status === 'running') { run.status = 'failed'; run.error = '服务已重启，上次任务中断，请重试'; run.completedAt = new Date().toISOString(); }
    });
  }
  read() { return structuredClone(this.#state); }
  update(change) {
    const task = this.#tail.then(async () => {
      const next = structuredClone(this.#state);
      const result = change(next);
      const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
      await writeFile(temporary, await this.codec.encode(JSON.stringify(next)), { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, 'state.json'));
      this.#state = next;
      return structuredClone(result);
    });
    this.#tail = task.catch(() => {}); // Failed transactions do not poison the next write.
    return task;
  }
}

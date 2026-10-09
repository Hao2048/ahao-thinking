import { readFile, mkdir, cp, access, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Import a legacy local project store once; never overwrite an existing desktop store. */
export async function importLegacyData(source, destination) {
  try { await access(join(destination, 'state.json')); return { imported: false, reason: 'already-exists' }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let contents;
  try { contents = await readFile(join(source, 'state.json'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { imported: false, reason: 'no-legacy-data' }; throw error; }
  const state = JSON.parse(contents);
  if (state.schemaVersion !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.models)) throw new Error('旧版本数据格式不支持，原数据未修改');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  // Runtime profiles are recreated from bundled packages; copy only user workspaces and session logs.
  for (const path of ['projects', 'harness-home/sessions']) {
    try { await access(join(source, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await cp(join(source, path), join(destination, path), { recursive: true, dereference: false, errorOnExist: true, force: false });
  }
  const temporary = join(destination, `.import-${randomUUID()}.tmp`);
  await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
  await rename(temporary, join(destination, 'state.json'));
  await writeFile(join(destination, 'migration.json'), JSON.stringify({ version: 1, importedAt: new Date().toISOString(), source, projects: state.projects.length, models: state.models.length }), { mode: 0o600 });
  return { imported: true, projects: state.projects.length, models: state.models.length };
}

/** Codec backed by the parent Electron process; the renderer never sees these messages. */
export function createDesktopCodec(channel = process) {
  const calls = new Map();
  let next = 0;
  channel.on('message', message => {
    if (message?.type !== 'storage-result') return;
    const pending = calls.get(message.id);
    if (!pending) return;
    calls.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
  });
  channel.once('disconnect', () => {
    for (const call of calls.values()) { clearTimeout(call.timer); call.reject(new Error('桌面存储连接已关闭')); }
    calls.clear();
  });
  function request(operation, value) {
    return new Promise((resolve, reject) => {
      if (!channel.connected) return reject(new Error('桌面存储连接未就绪'));
      const id = `${process.pid}-${++next}`;
      const timer = setTimeout(() => { calls.delete(id); reject(new Error('桌面存储响应超时')); }, 15000);
      calls.set(id, { resolve, reject, timer });
      channel.send({ type: 'storage-request', id, operation, value }, error => {
        if (!error) return;
        clearTimeout(timer); calls.delete(id); reject(error);
      });
    });
  }
  return {
    async decode(raw) {
      const envelope = JSON.parse(raw);
      // Plaintext is admitted only to migrate earlier versions; the next write encrypts it.
      if (envelope.schemaVersion === 1) return raw;
      if (envelope.storage !== 'macos-safe-storage' || envelope.version !== 1 || typeof envelope.payload !== 'string') throw new Error('桌面数据格式不支持');
      return request('decrypt', envelope.payload);
    },
    async encode(raw) { return JSON.stringify({ storage: 'macos-safe-storage', version: 1, payload: await request('encrypt', raw) }); },
  };
}

export function createDynamicResearchBridge(channel=process) {
  const pending=new Map();
  channel.on('message',message=>{
    if(message?.type!=='research-result')return;
    const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);
    if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);
  });
  channel.once('disconnect',()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('桌面取材连接已关闭'));}pending.clear();});
  return url=>new Promise((resolve,reject)=>{
    const id=randomUUID();
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('桌面动态取材响应超时'));},50000);
    pending.set(id,{resolve,reject,timer});
    channel.send({type:'research-request',id,url},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
}

export function createUpdateBridge(channel=process) {
  const pending=new Map();
  channel.on('message',message=>{if(message?.type!=='update-result')return;const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);});
  channel.once('disconnect',()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('桌面更新连接已关闭'));}pending.clear();});
  return(action,value)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('桌面更新响应超时'));},20000);pending.set(id,{resolve,reject,timer});channel.send({type:'update-request',id,action,value},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
}

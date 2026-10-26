import { randomUUID } from 'node:crypto';

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
  return (url,{signal}={})=>new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const id=randomUUID();
    const finish=(error,value)=>{pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{channel.send({type:'research-cancel',id});finish(new Error('动态取材已停止'));};
    const timer=setTimeout(()=>{channel.send({type:'research-cancel',id});finish(new Error('桌面动态取材响应超时'));},50000);
    pending.set(id,{resolve:value=>finish(null,value),reject:error=>finish(error),timer});
    signal?.addEventListener('abort',abort,{once:true});
    channel.send({type:'research-request',id,url},error=>{if(error)finish(error);});
  });
}

export function createUpdateBridge(channel=process) {
  const pending=new Map();
  channel.on('message',message=>{if(message?.type!=='update-result')return;const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);});
  channel.once('disconnect',()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('桌面更新连接已关闭'));}pending.clear();});
  return(action,value)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('桌面更新响应超时'));},20000);pending.set(id,{resolve,reject,timer});channel.send({type:'update-request',id,action,value},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
}

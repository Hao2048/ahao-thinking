// Extend the SDK's stdio protocol with process-local assistant frames.
// Durable events remain owned by Harness; never write these frames to history.
export const name='aipm-chat-stream';
export function apply(ctx){
 ctx.on('agent/assistant-stream',({agent,frame})=>{
  if(frame.type!=='chunk'&&frame.type!=='start')return;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'aipm.assistant-stream',params:{sessionId:String(agent.session.id),frame}})+'\n');
 });
}

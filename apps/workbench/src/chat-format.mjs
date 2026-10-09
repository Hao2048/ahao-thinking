// Extract only the first top-level reply string while JSON is incomplete.
// Escapes can span arbitrary provider chunks; unfinished Unicode stays buffered.
export function replyPrefix(raw){
  const match=raw.match(/^\s*(?:```(?:json)?\s*)?\{\s*"reply"\s*:\s*"/i);if(!match)return '';
  let output='';
  for(let i=match[0].length;i<raw.length;i++){
    const char=raw[i];if(char==='"')break;
    if(char!=='\\'){output+=char;continue;}
    const next=raw[++i];if(!next)break;
    if(next==='u'){const hex=raw.slice(i+1,i+5);if(!/^[a-f0-9]{4}$/i.test(hex))break;output+=String.fromCharCode(parseInt(hex,16));i+=4;}
    else{const values={'"':'"','\\':'\\','/':'/','n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'};if(!(next in values))break;output+=values[next];}
  }
  const last=output.charCodeAt(output.length-1);return last>=0xd800&&last<=0xdbff?output.slice(0,-1):output;
}
export function chatQuestion(value){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.questions)||value.questions.length<1||value.questions.length>3)throw new Error('AI 提问格式错误，请重试');
 const label=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('AI 提问内容不完整');return value.trim();};
 return{title:label(value.title||'补充一点信息',100),questions:value.questions.map(question=>{
  if(!question||typeof question!=='object')throw new Error('AI 提问格式错误');
  if(question.options!==undefined&&(!Array.isArray(question.options)||question.options.length>5))throw new Error('AI 提问选项过多');
  const options=(question.options||[]).map(option=>label(option,300));if(new Set(options).size!==options.length)throw new Error('AI 提问选项重复');
  return{prompt:label(question.prompt,1000),options};
 })};
}

// Official public API presets checked 2026-10-09. Regional/private endpoints remain editable.
export const providers = [
  {id:'deepseek',name:'DeepSeek',api:'deepseek-messages',baseURL:'https://api.deepseek.com/anthropic',model:'deepseek-v4-pro',keyURL:'https://platform.deepseek.com/api_keys',docs:'https://api-docs.deepseek.com/'},
  {id:'openai',name:'OpenAI',api:'openai-completions',baseURL:'https://api.openai.com/v1',model:'gpt-5-mini',keyURL:'https://platform.openai.com/api-keys',docs:'https://developers.openai.com/api/docs/models/gpt-5-mini'},
  {id:'anthropic',name:'Anthropic / Claude',api:'anthropic-messages',baseURL:'https://api.anthropic.com/v1',model:'claude-sonnet-5-5',keyURL:'https://platform.claude.com/settings/keys',docs:'https://platform.claude.com/docs/en/models/overview'},
  {id:'qwen',name:'阿里云百炼 / 通义千问（北京）',api:'openai-completions',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',keyURL:'https://bailian.console.aliyun.com/',note:'默认使用北京地域 API Key；其他地域请在高级设置修改地址。',docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
  {id:'kimi',name:'月之暗面 / Kimi（中国）',api:'openai-completions',baseURL:'https://api.moonshot.cn/v1',model:'kimi-k3',keyURL:'https://platform.kimi.com/',docs:'https://platform.kimi.com/docs/get-api-key'},
  {id:'zhipu-coding',name:'智谱 / GLM Coding Plan（中国）',api:'openai-completions',baseURL:'https://open.bigmodel.cn/api/coding/paas/v4',model:'glm-5.3-flash',keyURL:'https://bigmodel.cn/coding-plan/personal/overview',note:'填写 Coding Plan 套餐 Key。套餐限官方指定工具使用，本工作台尚未列入支持名单；请向智谱确认适用范围。',docs:'https://docs.bigmodel.cn/cn/coding-plan/quick-start'},
];
export function resolveProvider(body){
  if(!body.provider||body.provider==='custom')return{...body,provider:'custom'};
  const preset=providers.find(provider=>provider.id===body.provider);
  if(!preset)throw new Error('模型厂商不存在');
  return{name:preset.name,model:preset.model,api:preset.api,baseURL:preset.baseURL,...body};
}

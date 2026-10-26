// Never surface provider messages: they may contain keys, request bodies or SDK paths.
export function modelFailure(cause) {
  if (cause?.code?.startsWith('MODEL_') || cause?.code === 'OUTPUT_TRUNCATED') return cause;
  const raw = typeof cause === 'string' ? cause : JSON.stringify(cause, Object.getOwnPropertyNames(cause || {}));
  let code = 'MODEL_REQUEST', message = '模型请求失败，请测试模型连接后重试。已有结果已保留。';
  if (/\b40[13]\b|invalid.?api.?key|authentication|unauthorized|permission.denied/i.test(raw)) {
    code = 'MODEL_AUTH'; message = '模型认证或访问权限失败，请在“模型与连接”核对 Key、接口地址和模型权限后重试。';
  } else if (/\b429\b|rate.?limit|quota|insufficient.balance|credit|余额/i.test(raw)) {
    code = 'MODEL_LIMIT'; message = '模型服务限流或额度不足，请稍后重试，并检查服务商的配额与余额。';
  } else if (/timeout|timed.out|超时/i.test(raw)) {
    code = 'MODEL_TIMEOUT'; message = '模型请求超时，请检查网络后重试；已有结果已保留。';
  } else if (/fetch.failed|ENOTFOUND|ECONN|network|socket|TLS|certificate/i.test(raw)) {
    code = 'MODEL_NETWORK'; message = '无法连接模型服务，请检查网络、代理和接口地址后重试。';
  } else if (/abort|已停止/i.test(raw)) {
    code = 'MODEL_CANCELLED'; message = '已停止生成，已有结果已保留。';
  }
  return Object.assign(new Error(message), {code});
}
export function assertModelOutput(output) {
  const reason = output?.events?.findLast(e => e.type === 'turn/end')?.data?.reason;
  if (reason?.kind === 'error') {
    // Keep nesting intact for classification; never include this text in the public error.
    throw modelFailure(JSON.stringify(reason));
  }
  if (reason?.kind === 'aborted') throw modelFailure('aborted');
  if (reason?.kind === 'max-tokens') throw Object.assign(new Error('模型输出被服务商长度上限截断，请缩小单份大纲或使用更长输出模型；已有结果已保留。'), {code:'OUTPUT_TRUNCATED'});
  if (!output?.finalResponse?.trim()) throw Object.assign(new Error('模型未返回内容，请在“模型与连接”测试连接后重试；已有结果已保留。'), {code:'MODEL_EMPTY'});
  return output;
}

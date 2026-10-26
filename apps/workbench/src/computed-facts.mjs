// Numeric facts cross this seam as references, never as model-authored literals.
export function computedFacts(computed) {
  const facts = {};
  function visit(value, path) {
    if (typeof value === 'number' && Number.isFinite(value)) facts[path] = value;
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(computed, '');
  return facts;
}
export function factInstructions(computed) {
  if (!computed) return '';
  return `\n数值绑定协议：所有统计数值只能引用下面的事实令牌，如 {{fact:rows.1.users}} 或 {{fact:rows.1.cumulativeRate|percent}}；软件替换令牌为代码值。正文、摘要、图表及structuredData不得自行书写数字，不得在令牌后另加百分号。原因与建议使用定性文字，不能凭空给出目标数值。统计图表由软件根据计算结果自动绘制，本轮不要生成chart围栏。不要复述原始CSV数字。事实表：${JSON.stringify(computedFacts(computed))}`;
}
export function bindComputedFacts(result, computed) {
  if (!computed) return result;
  const facts = computedFacts(computed);
  const invalid = message => { throw Object.assign(new Error('文档数值校验失败：' + message + '。代码计算结果已保留，请重新生成解读。'), {code:'DOCUMENT_FACTS'}); };
  function bind(value) {
    if (typeof value === 'number') invalid('模型返回了未绑定数值');
    if (typeof value === 'string') {
      if(value.includes('\u0000')||/\}\}\s*%/.test(value))invalid('指标令牌后不能另加百分号或控制字符');
      const references = [];
      const stripped = value.replace(/\{\{fact:([\w.]+)(\|percent)?\}\}/g, (token,path,percent) => {
        if (!Object.hasOwn(facts,path)) invalid('引用了不存在的指标 ' + path);
        references.push(percent ? `${Number((facts[path]*100).toFixed(6))}%` : String(facts[path]));
        return '\u0000';
      });
      // Heading/list ordinals and source identifiers are formatting, not metrics.
      const claims = stripped.replace(/^\s*(?:#{1,6}\s*)?\d+[.、)]\s*/gm,'').replace(/\[S\d+\]/g,'').replace(/\bpm-chart-v1\b/g,'');
      if (/\d/.test(claims) || /\{\{fact:/.test(stripped)) invalid('含未绑定的数字或无效指标引用');
      let i=0;return stripped.replace(/\u0000/g,()=>references[i++]);
    }
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v)]));
    return value;
  }
  // Host-generated IDs, outline metadata and headings are not model claims.
  return {...result,summary:bind(result.summary),structuredData:bind(result.structuredData),openQuestions:bind(result.openQuestions),documents:result.documents.map(doc=>({...doc,content:bind(doc.content),summary:bind(doc.summary||'')}))};
}

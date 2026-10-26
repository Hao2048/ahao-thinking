export function markdownHeadings(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n"), headings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (code) {
      if (!fence) fence = code[1][0];
      else if (fence === code[1][0]) fence = null;
      continue;
    }
    if (fence) continue;
    const match = lines[i].match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (match) headings.push({ level: match[1].length, title: match[2].replace(/[ \t]+#+[ \t]*$/, "").trim(), line: i });
  }
  return { lines, headings };
}
export function parseDocumentOutline(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("请填写文档大纲，或恢复节点默认大纲");
  if (value.length > 65536) throw new Error("大纲过长，请将任务拆分到不同文档节点");
  const text = value.replace(/\r\n?/g, "\n").trim().split("\n").map((line) => /^\s*#{1,6}[ \t]+/.test(line) ? line.trimStart().replace(/^(#{1,6})[ \t]+/, "$1 ") : line).join("\n");
  const { lines, headings } = markdownHeadings(text);
  if (!headings.length || headings[0].level !== 1 || !/^#\s+\S/.test(lines[0])) throw new Error("首行请使用「# 文档标题」，章节使用「## 章节标题」");
  const starts = headings.filter((h) => h.level === 1);
  const documents = starts.map((h, i) => {
    const end = starts[i + 1]?.line ?? lines.length;
    return { title: h.title, outline: lines.slice(h.line, end).join("\n").trim(), headings: headings.filter((v) => v.line >= h.line && v.line < end).map(({ level, title }) => ({ level, title })) };
  });
  return { text, documents };
}
const titleKey = (title) => String(title).replace(/[`*_]/g, "").replace(/^\s*(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十百]+[、.．]|\d+(?:\.\d+)*(?:[、.．)）]\s*|\s+))\s*/, "").replace(/\s+/g, "").trim();
export function outlineIssues(content, outline) {
  const expected = parseDocumentOutline(outline).documents.flatMap((d) => d.headings), actual = markdownHeadings(content), issues = [];
  let cursor = 0;
  for (const h of expected) {
    const index = actual.headings.findIndex((a, i) => i >= cursor && a.level === h.level && titleKey(a.title) === titleKey(h.title));
    if (index < 0) {
      issues.push(`缺少或顺序不符：${"#".repeat(h.level)} ${h.title}`);
      continue;
    }
    cursor = index + 1;
    const found = actual.headings[index], end = actual.headings.slice(index + 1).find((a) => a.level <= found.level)?.line ?? actual.lines.length;
    const body = actual.lines.slice(found.line + 1, end).filter((line) => !/^\s*#{1,6}\s/.test(line)).join("\n").trim();
    if (!body) issues.push(`章节尚未填写：${h.title}`);
  }
  const constrained = new Set(expected.map((h) => h.level).filter((level) => level <= 2));
  for (const h of actual.headings) if (constrained.has(h.level) && !expected.some((e) => e.level === h.level && titleKey(e.title) === titleKey(h.title))) issues.push(`出现大纲外章节：${"#".repeat(h.level)} ${h.title}`);
  for (const level of constrained) {
    const expectedCounts = /* @__PURE__ */ new Map(), actualCounts = /* @__PURE__ */ new Map();
    for (const h of expected.filter((h2) => h2.level === level)) {
      const k = titleKey(h.title);
      expectedCounts.set(k, (expectedCounts.get(k) || 0) + 1);
    }
    for (const h of actual.headings.filter((h2) => h2.level === level)) {
      const k = titleKey(h.title), count = (actualCounts.get(k) || 0) + 1;
      actualCounts.set(k, count);
      if (expectedCounts.has(k) && count > expectedCounts.get(k)) issues.push("重复章节：" + h.title);
    }
  }
  return issues;
}

import { parseDocumentOutline } from "../public/node-outline.mjs";
import { createHash } from "node:crypto";
export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function validateGraph(graph, registry) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 100 || graph.edges.length > 300) throw new Error("工作流需要节点和连线，最多100节点、300连线");
  const ids = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(n.id) || ids.has(n.id)) throw new Error("节点实例编号重复或无效");
    ids.add(n.id);
    const d = registry.get(n.type);
    if (n.name !== void 0 && (typeof n.name !== "string" || n.name.length > 100)) throw new Error("节点名称无效");
    if (!n.config || typeof n.config !== "object" || Array.isArray(n.config)) throw new Error("节点配置无效");
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error("节点坐标无效");
    if (d.category === "report" && d.executor === "ai" && n.config.outline !== void 0) parseDocumentOutline(n.config.outline);
    for (const f of d.fields) {
      const v = n.config[f.key];
      if (v === void 0) continue;
      if (["text", "textarea", "select", "model", "artifact"].includes(f.type) && typeof v !== "string") throw new Error(f.label + "应为文本");
      if (f.type === "number" && !Number.isFinite(v)) throw new Error(f.label + "应为数字");
      if (f.type === "boolean" && typeof v !== "boolean") throw new Error(f.label + "应为开关");
      if (f.type === "file" && !Array.isArray(v)) throw new Error("文件列表无效");
      if (f.type === "select" && !f.options.some((o) => (typeof o === "string" ? o : o.value) === v)) throw new Error(f.label + "选项无效");
    }
  }
  if (graph.view && (!["x", "y", "k"].every((k) => Number.isFinite(graph.view[k])) || graph.view.k < 0.1 || graph.view.k > 5)) throw new Error("画布视图参数无效");
  if (graph.groups !== void 0 && !Array.isArray(graph.groups)) throw new Error("分组格式无效");
  const groupIds = /* @__PURE__ */ new Set();
  for (const g of graph.groups || []) {
    if (typeof g.id !== "string" || groupIds.has(g.id) || typeof g.name !== "string" || g.name.length > 100 || !["x", "y", "w", "h"].every((k) => Number.isFinite(g[k])) || g.w < 0 || g.h < 0 || !Array.isArray(g.members) || g.members.some((id) => !ids.has(id))) throw new Error("分组定义无效");
    groupIds.add(g.id);
  }
  const edgeIds = /* @__PURE__ */ new Set(), pairs = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    if (!e.id || edgeIds.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) throw new Error("连线编号、方向或端点无效");
    edgeIds.add(e.id);
    const from = registry.get(graph.nodes.find((n) => n.id === e.from).type), to = registry.get(graph.nodes.find((n) => n.id === e.to).type), out = from.outputs.find((p) => p.id === e.output), input = to.inputs.find((p) => p.id === e.input);
    if (!out || !input || !out.types.some((t) => input.types.includes(t))) throw new Error("端口数据类型不兼容");
    const pair = [e.from, e.output, e.to, e.input].join("|");
    if (pairs.has(pair)) throw new Error("已有相同连接");
    pairs.add(pair);
    if (!input.multiple && graph.edges.filter((v) => v.to === e.to && v.input === e.input).length > 1) throw new Error("此输入端口仅接受一个上游");
  }
  topological(graph);
  return graph;
}
export function topological(graph, target) {
  const selected = /* @__PURE__ */ new Set();
  function collect(id) {
    if (selected.has(id)) return;
    selected.add(id);
    for (const e of graph.edges.filter((e2) => e2.to === id)) collect(e.from);
  }
  if (target) {
    if (!graph.nodes.some((n) => n.id === target)) throw new Error("目标节点不存在");
    collect(target);
  } else graph.nodes.forEach((n) => selected.add(n.id));
  const degree = new Map([...selected].map((id) => [id, 0]));
  for (const e of graph.edges) if (selected.has(e.to) && selected.has(e.from)) degree.set(e.to, degree.get(e.to) + 1);
  const queue = [...degree].filter(([, v]) => !v).map(([id]) => id), result = [];
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    for (const e of graph.edges.filter((e2) => e2.from === id && selected.has(e2.to))) {
      degree.set(e.to, degree.get(e.to) - 1);
      if (!degree.get(e.to)) queue.push(e.to);
    }
  }
  if (result.length !== selected.size) throw new Error("工作流含循环连接，无法确定执行顺序");
  return result;
}
export function nodeFingerprint(node, definition, upstream, model, resetEpoch = 0, downstream = [], taskContext = null) {
  return digest({ generationProtocol: "start-context-v2.7.0", config: node.config, definition: definition.hash, upstream, model, resetEpoch, downstream, taskContext });
}

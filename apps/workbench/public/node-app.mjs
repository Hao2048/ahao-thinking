let lastNodePointer=null;
let statusSignature=null,lastPollAt=0;
import {chartBlocks,validateDocumentCharts} from "./document-charts.mjs";
import { nodePalette, nodePaletteStyle, getNodePalettes, customNodeColors } from "./node-palette.mjs";
import { parseDocumentOutline } from "./node-outline.mjs";
import { escapeHtml as e, documentMarkup, renderMarkdown, frameMarkup } from "./document-view.mjs";
import { documentSummary } from "./document-summary.mjs";
import { validateChartEdits } from './document-charts.mjs';
import { hydrateVisuals } from "./visuals.mjs";
import { modelFormMarkup, bindModelForm } from "./models.mjs";
const $ = (s) => document.querySelector(s), token = $('meta[name="aipm-token"]').content;
let state, catalog, projectId, flow, selected = /* @__PURE__ */ new Set(), page = "canvas", tab = "config", tool = "select", view = { x: 80, y: 100, k: 1 }, dirty = false, saveTimer, saveChain = Promise.resolve(), undo = [], redo = [], link = null, space = false, polling = false, docIndex = 0, docTab = "document", docContext = null, artifactOptions = [], questionSeen = /* @__PURE__ */ new Set();
const cats = { input: "输入节点", analysis: "数据分析节点", report: "报告产出节点" }, statuses = { queued: "待运行", running: "正在运行", succeeded: "已完成", failed: "失败", waiting_input: "等待补充", cancelled: "已停止" };
const paths = { select: "M4 3l10 9-5 1-2 5z", pan: "M6 10V5a1 1 0 012 0v4-6a1 1 0 012 0v6-5a1 1 0 012 0v6-3a1 1 0 012 0v6c0 5-8 6-10 1l-2-4a1 1 0 011-2z", zoom: "M13 13l4 4M14 8a6 6 0 11-12 0 6 6 0 0112 0M5 8h6M8 5v6", color: "M3 9l7-7 7 7-7 7zM6 7l7 7M2 18h16", group: "M2 6V2h4M14 2h4v4M18 14v4h-4M6 18H2v-4M6 6h8v8H6z", add: "M10 3v14M3 10h14", undo: "M7 3L3 7l4 4M3 7h8a5 5 0 010 10", keys: "M2 5h16v11H2zM5 8h1m3 0h1m3 0h1M5 11h1m3 0h1m3 0h1M6 14h8" };
Object.assign(paths, {
  sun: "M10 6a4 4 0 110 8 4 4 0 010-8M10 1v2m0 14v2M1 10h2m14 0h2M3.5 3.5l1.5 1.5m10 10l1.5 1.5M3.5 16.5L5 15M15 5l1.5-1.5",
  moon: "M17 12A7.5 7.5 0 018 3a7.5 7.5 0 1010 10z",
  input: "M4 4h12M10 4v12M7 16h6",
  file: "M5 2h7l4 4v12H5zM12 2v5h4M8 11h5M8 14h5",
  folder: "M2 5h6l2 2h8v10H2z",
  search: "M13 13l5 5M14 8a6 6 0 11-12 0 6 6 0 0112 0",
  user: "M13 6a3 3 0 11-6 0 3 3 0 016 0M4 18v-2a6 6 0 0112 0v2",
  grid: "M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z",
  bolt: "M11 2L4 11h5l-1 7 8-10h-5z",
  clock: "M18 10a8 8 0 11-16 0 8 8 0 0116 0M10 5v5l3 2",
  flow: "M2 3h5v5H2zM13 12h5v5h-5zM7 5h8v7M4 8v7h9",
  check: "M4 10l4 4 8-9",
  waiting: "M10 2L19 18H1zM10 7v5M10 15v.5",
  failed: "M5 5l10 10M15 5L5 15",
  queued: "M18 10a8 8 0 11-16 0 8 8 0 0116 0",
  running: "M7 4l9 6-9 6z"
});
const icon = (id) => `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${paths[id] || paths.select}"/></svg>`;
const def = (t) => catalog.nodes.find((d) => d.id === t), node = () => flow?.graph.nodes.find((n) => selected.has(n.id));
const apiPath = () => `/api/projects/${projectId}/flows/${flow.id}`;
async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body === void 0 ? "GET" : "POST"), headers: { "x-aipm-token": token, "Content-Type": "application/json" }, ...body !== void 0 ? { body: JSON.stringify(body) } : {} });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "请求失败");
  return v;
}
function toast(message) {
  $("#notice").textContent = message;
  $("#notice").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#notice").style.display = "none", 5e3);
}
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      toast(error.message);
    }
  };
}
function modal(title, html) {
  const m = $("#modal");
  if (m.open) m.close();
  m.innerHTML = `<div class="modal-head"><h2>${e(title)}</h2><button id="close-modal" aria-label="关闭">×</button></div><div class="modal-body">${html}</div>`;
  $("#close-modal").onclick = () => m.close();
  m.showModal();
  return m;
}
function askText(title, value = "") {
  return new Promise((resolve) => {
    const m = modal(title, `<form id="text-prompt"><input id="prompt-value" value="${e(value)}" required maxlength="100"><div class="row"><button class="primary">确定</button><button type="button" id="prompt-cancel">取消</button></div></form>`);
    let result = null;
    const done = () => resolve(result);
    m.addEventListener("close", done, { once: true });
    $("#prompt-cancel").onclick = () => m.close();
    $("#text-prompt").onsubmit = (ev) => {
      ev.preventDefault();
      result = $("#prompt-value").value.trim();
      m.close();
    };
    $("#prompt-value").focus();
    $("#prompt-value").select();
  });
}
const download = (name, value, type = "text/plain") => {
  const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3e3);
};
function busy() {
  return flow?.runs?.some((r) => ["running", "waiting_input"].includes(r.status));
}
function latest() {
  return flow?.runs?.at(-1);
}
function checkpoint() {
  if (busy()) {
    toast("请先完成或停止运行后编辑");
    return false;
  }
  undo.push(structuredClone(flow.graph));
  if (undo.length > 40) undo.shift();
  redo = [];
  return true;
}
function changed() {
  dirty = true;
  $("#saved") && ($("#saved").textContent = "正在保存…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => guard(flush)(), 650);
}
async function flush() {
  clearTimeout(saveTimer);
  saveChain = saveChain.catch(() => {
  }).then(async () => {
    if (!dirty || !flow) return;
    const current = flow, graph = structuredClone(current.graph), name = current.name, base = current.revision;
    const saved = await api(`/api/projects/${projectId}/flows/${current.id}`, { graph, name, revision: base });
    if (flow?.id !== current.id) return;
    flow.revision = saved.revision;
    if (JSON.stringify(flow.graph) === JSON.stringify(graph) && flow.name === name) dirty = false;
    $("#saved") && ($("#saved").textContent = dirty ? "尚有修改" : "✓ 已保存");
  });
  return saveChain;
}
async function refreshState() {
  state = await api("/api/state");
  if (!projectId || !state.projects.some((p) => p.id === projectId)) projectId = state.projects[0]?.id;
}
async function openFlow(id) {
  await flush();
  flow = await api(`/api/projects/${projectId}/flows/${id}`);
  statusSignature=null;
  view = flow.graph.view || { x: 80, y: 100, k: 1 };
  selected.clear();
  undo = [];
  redo = [];
  page = "canvas";
  tab = "config";
  dirty = false;
  artifactOptions = await api(apiPath() + "/artifacts");
  render();
}
async function newFlow() {
  const name = await askText("工作流名称", "新的产品研究");
  if (!name?.trim()) return;
  await flush();
  const f = await api(`/api/projects/${projectId}/flows`, { name });
  await refreshState();
  await openFlow(f.id);
}
async function newProject() {
  const name = await askText("项目名称");
  if (!name?.trim()) return;
  await flush();
  const p = await api("/api/projects", { name });
  projectId = p.id;
  await refreshState();
  const f = await api(`/api/projects/${projectId}/flows`, { name: "新的工作流" });
  await refreshState();
  await openFlow(f.id);
}
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme !== "light", button = $("#theme-toggle");
  if (!button) return;
  button.innerHTML = icon(dark ? "sun" : "moon") + `<span>${dark ? "银白" : "深色"}</span>`;
  button.setAttribute("aria-label", dark ? "切换为银白主题" : "切换为深色主题");
  button.title = dark ? "切换为银白主题" : "切换为深色主题";
}
async function toggleTheme() {
  const button = $("#theme-toggle"); button.disabled = true;
  try {
    const theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    const saved = await api("/api/appearance", { theme });
    state.settings.appearance = saved;
    document.documentElement.dataset.theme = saved.theme;
    updateThemeButton();
    if ($("#graph")) paint();
    if (page === "library") renderSurface();
    renderInspector();
  } finally { button.disabled = false; }
}
function workspaceMenu() {
  const project = state.projects.find(p => p.id === projectId);
  const m = modal("项目与工作流", `<label><span>当前项目</span><select id="workspace-project">${state.projects.map(p => `<option value="${p.id}" ${p.id === projectId ? "selected" : ""}>${e(p.name||p.id)}</option>`).join("")}</select></label><div class="workspace-flows">${(project?.workflows || []).map(f => `<button data-open-flow="${f.id}" class="${f.id === flow?.id ? "active" : ""}">${icon("flow")}${e(f.name)}</button>`).join("") || '<p class="muted">此项目暂无工作流。</p>'}</div><div class="row"><button id="workspace-new-project">新建项目</button><button id="workspace-new-flow">新建工作流</button></div>`);
  $("#workspace-project").onchange = guard(async ev => { await flush(); projectId = ev.target.value; const p = state.projects.find(p => p.id === projectId); m.close(); if (p.workflows?.length) await openFlow(p.workflows[0].id); else { flow = null; render(); } });
  m.querySelectorAll("[data-open-flow]").forEach(b => b.onclick = guard(async () => { m.close(); await openFlow(b.dataset.openFlow); }));
  $("#workspace-new-project").onclick = guard(async () => { m.close(); await newProject(); });
  $("#workspace-new-flow").onclick = guard(async () => { m.close(); await newFlow(); });
}
function render() {
  const project = state.projects.find((p) => p.id === projectId), flows = project?.workflows || [];
  $("#app").innerHTML = `<div class="app"><aside class="sidebar"><div class="brand"><img src="/brand-logo.svg" alt="阿浩Thinking" title="阿浩Thinking"><div><small>阿浩</small><b>Thinking</b></div></div><div class="project"><small>当前项目</small><select id="projects" aria-label="当前项目" title="${e(project?.name || "当前项目")}">${state.projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? "selected" : ""}>${e(p.name||p.id)}</option>`).join("")}</select><button id="new-project">＋ 新建项目</button></div><nav class="nav"><button data-page="canvas" class="${page === "canvas" ? "active" : ""}">${icon("flow")}<span>工作流</span></button><button data-page="library" class="${page === "library" ? "active" : ""}">${icon("grid")}<span>节点库</span></button><button data-page="documents">${icon("file")}<span>项目文档</span></button></nav><div class="side-label">项目工作流</div><div class="flows">${flows.map((f) => `<button data-flow="${f.id}" class="${f.id === flow?.id ? "current" : ""}" title="${e(f.name)}"><span>${e(f.name)}</span></button>`).join("")}<button id="new-flow">＋ 新建工作流</button></div><div class="sidebar-bottom"><button id="manage">${icon("grid")}<span>管理节点</span></button><button id="models">${icon("group")}<span>模型连接</span></button><small>基于 DeepSeek Harness<br>本地个人工作空间 · 2.5.0</small></div></aside><main class="center"><header class="pagehead"><div class="page-title"><button id="workspace-switch" class="workspace-switch" aria-label="切换项目或工作流">${e(project?.name || "个人工作空间")} <span> / 工作流</span></button><h1 id="flow-name" title="点击修改名称">${e(flow?.name || "创建你的工作流")}</h1></div><div class="row"><button id="theme-toggle" class="theme-toggle" aria-label="切换主题"></button><span class="saved" id="saved">${dirty ? "尚有修改" : "✓ 已保存"}</span><button id="template">保存模板</button><button class="primary" id="run">${icon("running")}${busy() ? "停止运行" : "运行工作流"}</button></div></header><div class="tabsbar"><div class="tabs">${[["canvas", "编辑流程"], ["history", "运行记录"], ["outputs", "输出文档"]].map(([id, label]) => `<button data-page="${id}" class="${page === id ? "active" : ""}">${label}</button>`).join("")}</div><small id="run-state">${e(latest()?.progress || "尚未运行")}</small></div><div id="surface" style="display:contents"></div></main><aside class="inspector"><div id="inspector-head"></div><div class="tabs">${[["config", "配置"], ["chat", "AI 助手"], ["output", "输出"]].map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${label}</button>`).join("")}</div><div class="inspector-body" id="details"></div><div id="chat-entry"></div><div class="inspector-bottom"><button id="run-node">${icon("running")}运行至此节点</button></div></aside></div>`;
  updateThemeButton();
  $("#theme-toggle").onclick = guard(toggleTheme);
  $("#workspace-switch").onclick = workspaceMenu;
  $("#projects").onchange = guard(async (ev) => {
    await flush();
    projectId = ev.target.value;
    const f = state.projects.find((p) => p.id === projectId).workflows?.[0];
    if (f) await openFlow(f.id);
    else {
      flow = null;
      render();
    }
  });
  $("#new-project").onclick = guard(newProject);
  $("#new-flow").onclick = guard(newFlow);
  document.querySelectorAll("[data-flow]").forEach((b) => b.onclick = guard(() => openFlow(b.dataset.flow)));
  document.querySelectorAll("[data-page]").forEach((b) => b.onclick = guard(async () => {
    if (b.dataset.page === "documents") {
      await projectDocuments();
      return;
    }
    page = b.dataset.page;
    render();
  }));
  $("#manage").onclick = () => {
    page = "library";
    render();
  };
  $("#models").onclick = guard(models);
  $("#run").onclick = guard(() => run());
  $("#run-node").onclick = guard(() => run(node()?.id));
  $("#template").onclick = guard(template);
  $("#flow-name").onclick = guard(async () => {
    if (!flow || busy()) return;
    const name = await askText("工作流名称", flow.name);
    if (name?.trim()) {
      flow.name = name;
      changed();
      $("#flow-name").textContent = name;
    }
  });
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    renderInspector();
    document.querySelectorAll("[data-tab]").forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  });
  renderSurface();
  renderInspector();
}
function renderSurface() {
  const target = $("#surface");
  if (!flow) {
    target.innerHTML = '<div class="empty">选择项目并创建工作流，开始连接你的能力。</div>';
    return;
  }
  if (page === "canvas") {
    target.innerHTML = `<div class="frame" id="canvas"><div class="canvas-info"></div><div class="graph" id="graph"></div><div id="starter"></div><div class="tools">${[["select", "选择 V"], ["pan", "拖动画布 H / Space"], ["zoom", "缩放 Z"], ["color", "节点底色 C"], ["group", "打组 ⌘G"], ["add", "添加节点 N"], ["undo", "撤销 ⌘Z"], ["keys", "快捷键 ?"]].map(([id, label]) => `<button data-tool="${id}" title="${label}" aria-label="${label}" class="${tool === id ? "active" : ""}">${icon(id)}</button>`).join("")}</div><div class="zoom"><button id="zoom-out" aria-label="缩小">−</button><small id="zoom-value"></small><button id="zoom-in" aria-label="放大">＋</button><button id="fit" title="适应画布" aria-label="适应画布">${icon("group")}</button></div><svg class="minimap" id="minimap" aria-label="画布缩略图"></svg></div><div class="footer"><span id="footer-status">已就绪，运行后可逐节点查看结果</span><span>Shift 多选 · Space 拖动画布 · 快捷键 ?</span></div>`;
    paint();
    if (!flow.graph.nodes.length) {
      $("#starter").innerHTML = `<div class="starter"><small>连接能力，构建你的产品工作流</small><h2>从一个任务开始</h2><p>选择模板，或按 N 添加第一个节点</p>${(catalog.templates || []).map((t) => `<button data-starter="${e(t.id)}">${e(t.name)} →</button>`).join("")}</div>`;
      document.querySelectorAll("[data-starter]").forEach((b) => b.onclick = guard(async () => {
        if (!checkpoint()) return;
        flow.graph = structuredClone(catalog.templates.find((t) => t.id === b.dataset.starter).graph);
        selected.clear();
        changed();
        render();
        fit();
        await flush();
      }));
    }
    bindCanvas();
    document.querySelectorAll("[data-tool]").forEach((b) => b.onclick = () => useTool(b.dataset.tool));
    $("#zoom-in").onclick = () => zoom(1.15);
    $("#zoom-out").onclick = () => zoom(1 / 1.15);
    $("#fit").onclick = fit;
    $("#minimap").onclick = fit;
    return;
  }
  if (page === "library") {
    target.innerHTML = `<div class="library"><div class="row"><input id="node-search" placeholder="搜索节点名称或能力" style="flex:1"><button id="reload-nodes">刷新目录</button></div><small>节点目录：${e(catalog.root)}</small><div id="library-list"></div>${(catalog.upgradeConflicts||[]).length?`<p class="quality-warning">节点升级存在冲突，已保留整包本地版本：${catalog.upgradeConflicts.map(e).join("、")}。请在节点目录比较后手动合并。</p>`:""}${catalog.errors.map((x) => `<p class="danger">${e(x.package)}：${e(x.error)}</p>`).join("")}<p class="muted">将节点包放入此目录，自动发现并按定义生成配置面板。</p></div>`;
    $("#reload-nodes").onclick = guard(async () => {
      catalog = await api("/api/nodes");
      renderSurface();
    });
    $("#node-search").oninput = libraryList;
    libraryList();
    return;
  }
  if (page === "history") {
    target.innerHTML = `<div class="history">${[...flow.runs].reverse().map((r) => `<section class="list-card"><h3>运行 v${r.version} · ${statuses[r.status] || r.status}</h3><small>${e(r.createdAt)}</small>${r.error ? `<p class="danger">${e(r.error)}</p>` : ""}${r.order.map((id) => {
      const n = r.nodes[id];
      return `<div class="log-step"><button data-select="${id}">${e(n.definition.name)}</button><span>${statuses[n.status]}${n.cached ? " · 复用成功结果" : ""}</span></div>`;
    }).join("")}<button data-export="${r.id}">导出运行 JSON</button></section>`).join("") || '<div class="empty">还没有运行记录</div>'}</div>`;
    document.querySelectorAll("[data-select]").forEach((b) => b.onclick = () => {
      selected = /* @__PURE__ */ new Set([b.dataset.select]);
      renderInspector();
    });
    document.querySelectorAll("[data-export]").forEach((b) => b.onclick = () => download("工作流运行.json", JSON.stringify(flow.runs.find((r) => r.id === b.dataset.export), null, 2), "application/json"));
    return;
  }
  const docs = allDocuments();
  target.innerHTML = `<div class="history">${docs.map((d, i) => `<section class="list-card"><h3>${e(d.doc.title)}</h3><p><small>${e(d.nodeName)} · v${d.run.version} · ${e(d.run.createdAt)}</small></p><button data-document="${i}">查看文档与总结</button></section>`).join("") || '<div class="empty">运行节点后，文档会显示在这里。</div>'}</div>`;
  document.querySelectorAll("[data-document]").forEach((b) => b.onclick = () => showDocs(docs, Number(b.dataset.document)));
}
function libraryList() {
  const q = $("#node-search").value.toLowerCase();
  $("#library-list").innerHTML = Object.entries(cats).map(([cat, label]) => `<h2>${label}</h2><div class="library-grid">${catalog.nodes.filter((d) => d.category === cat && (d.name + d.description).toLowerCase().includes(q)).map((d) => `<button class="library-card ${d.category}" style="${nodePaletteStyle(d)}" data-inspect="${d.id}"><span class="library-node-title"><span class="node-icon">${icon(d.icon || "grid")}</span><b>${e(d.name)}</b></span><small>${e(d.description)}</small><small>v${d.version} · ${d.executor}</small></button>`).join("")}</div>`).join("");
  document.querySelectorAll("[data-inspect]").forEach(b=>b.onclick=guard(()=>inspectNode(b.dataset.inspect)));
}
async function inspectNode(id) {
  const d=await api("/api/nodes/"+encodeURIComponent(id));
  modal(d.name+" · 节点内部",`<div class="node-internals"><p>${e(d.description)}</p><p class="muted">${e(d.id)} · v${e(d.version)} · ${e(d.executor)}</p><h3>职责与工具权限</h3><pre>${e(JSON.stringify(d.capabilities || {},null,2))}</pre><h3>输入要求</h3><ul>${(d.requirements||[]).map(x=>`<li>${e(x)}</li>`).join("")}</ul><h3>内部工作流程</h3><ol>${(d.workflow||[]).map(x=>`<li><b>${e(x.title)}</b><p>${e(x.prompt)}</p></li>`).join("")}</ol><details><summary>完整节点提示词 / SOP</summary><pre>${e(d.instruction || "该节点由代码采集/计算，未设置AI提示词。")}</pre></details><details><summary>运行提示词模板（实际运行会填入当前材料）</summary><pre>${e(d.promptTemplate)}</pre></details><details><summary>节点定义与端口</summary><pre>${e(JSON.stringify({...d,instruction:undefined,promptTemplate:undefined,directory:undefined},null,2))}</pre></details><button id="inspect-add" class="primary" ${!flow ? "disabled" : ""}>添加到当前工作流</button></div>`);
  $("#inspect-add").onclick=()=>{addNode(id);$("#modal").close();page="canvas";render();};
}

function addNode(type) {
  tab = "config";
  if (!flow || !checkpoint()) return;
  const d = def(type), n = { id: crypto.randomUUID(), type, name: d.name, x: (250 - view.x) / view.k + Math.random() * 60, y: (170 - view.y) / view.k + Math.random() * 80, config: Object.fromEntries(d.fields.filter((f) => f.default !== void 0).map((f) => [f.key, structuredClone(f.default)])) };
  for (let i = 0; i < 30 && flow.graph.nodes.some((old) => Math.abs(old.x - n.x) < 245 && Math.abs(old.y - n.y) < 180); i++) {
    n.y += 190;
    if (i % 4 === 3) {
      n.x += 270;
      n.y -= 760;
    }
  }
  flow.graph.nodes.push(n);
  $("#starter")?.replaceChildren();
  selected = /* @__PURE__ */ new Set([n.id]);
  changed();
}
// Compact, factual context; definitions stay directory-driven.
function nodeContext(n, d, step) {
  if (step?.output?.documents?.length) return `${step.output.documents.length} 份文档 · 双击查看`;
  if (d?.fields.some(f => f.type === "file")) return `${d.fields.filter(f=>f.type==="file").reduce((count,f)=>count+(n.config[f.key]?.length||0),0)} 份材料`;
  if (d?.executor === "web") {
    const count = [n.config.queries, n.config.urls].filter(Boolean).flatMap(v => String(v).split("\n").filter(x => x.trim())).length;
    return count ? `${count} 条取材线索` : "待填写线索";
  }
  if (d?.category === "report") {
    try { return `计划 ${parseDocumentOutline(outlineFor(n)).documents.length} 份文档`; } catch { return "待设置大纲"; }
  }
  const upstream = flow.graph.edges.filter(edge => edge.to === n.id).length;
  if (upstream) return `${upstream} 路上游输入`;
  if (n.config.content || n.config.materials) return "已填写材料";
  return d?.inputs?.length ? "尚未接入材料" : "待填写内容";
}
function nodeDescription(n, d) {
  if (n.config.files?.length) return n.config.files.map(f => f.title).join("、");
  return String(n.config.task || n.config.content || d?.description || (d?"配置此节点后运行":"节点包未安装"));
}
function qualityNotice(quality){
 if(quality?.level!=='partial')return '';
 const missing=quality.missing||[];
 return `<div class="quality-warning" role="status"><b>资料不充分 · ${missing.length}项待补</b><ul>${missing.slice(0,3).map(x=>`<li>${e(x)}</li>`).join('')}</ul>${missing.length>3?`<details><summary>查看其余${missing.length-3}项</summary><ul>${missing.slice(3).map(x=>`<li>${e(x)}</li>`).join('')}</ul></details>`:''}</div>`;
}
function syncRunStatus(){
 const r=latest(),live=flow?.live?.find(x=>x.id===r?.id);
 const seconds=r?.status==='running'?` · 已运行${Math.max(0,Math.floor((Date.now()-Date.parse(r.createdAt))/1000))}秒`:'';
 const message=(r?.status==='running'?(live?.label||r.progress):r?.progress)||'已就绪，连接节点后运行';
 for(const selector of ['#run-state','#footer-status']){const el=$(selector);if(el){el.textContent=message+seconds;el.title=message;}}
}
function paint() {
  syncRunStatus();
  const graph = $("#graph");
  if (!graph) return;
  const nodes = flow.graph.nodes, r = latest();
  graph.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  // Keep grid lines in the same world coordinates as nodes and connections.
  const canvas = $("#canvas");
  canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
  canvas.style.backgroundSize = `${28 * view.k}px ${28 * view.k}px`;
  const portXY = (n, side, id) => {
    const list = def(n.type)?.[side === "output" ? "outputs" : "inputs"] || [], index = list.findIndex((p) => p.id === id);
    return { x: n.x + (side === "output" ? 224 : 0), y: n.y + 65 + Math.max(0, index) * 22 };
  };
  graph.innerHTML = (flow.graph.groups || []).map((g) => `<div class="group" data-group="${e(g.id)}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px"><span>${e(g.name)}</span></div>`).join("") + `<svg class="edges">${flow.graph.edges.map((edge) => {
    const a = nodes.find((n) => n.id === edge.from), b = nodes.find((n) => n.id === edge.to);
    if (!a || !b) return "";
    const p = portXY(a, "output", edge.output), q = portXY(b, "input", edge.input), tone = nodePalette(def(a.type), a.color);
    return `<path class="edge ${selected.has(a.id) || selected.has(b.id) ? "related" : ""}" style="stroke:${tone.accent}" data-edge="${e(edge.id)}" d="M${p.x} ${p.y} C${p.x + 90} ${p.y},${q.x - 90} ${q.y},${q.x} ${q.y}"/>`;
  }).join("")}</svg>` + nodes.map((n) => {
    const d = def(n.type), step = r?.nodes[n.id], changedGraph = r && JSON.stringify(r.graph.nodes.find((x) => x.id === n.id)?.config) !== JSON.stringify(n.config), status = changedGraph ? "待重新运行" : (step?.output?.quality?.level === "partial" ? "信息不充分" : statuses[step?.status]) || "待运行", statusClass = changedGraph ? "stale" : step?.status || "queued", palette = nodePalette(d, n.color);
    return `<div class="node ${d?.category || ""} ${selected.has(n.id) ? "selected" : ""} ${statusClass}" data-node="${n.id}" style="left:${n.x}px;top:${n.y}px;${nodePaletteStyle(d, n.color)}"><div class="node-head"><span class="node-icon">${icon(d?.icon || "grid")}</span><div class="node-heading"><b>${e(n.name || d?.name || n.type)}</b></div><span class="node-kind">${e(palette.label)}节点</span></div><div class="node-desc" title="${e(nodeDescription(n, d))}"><p>${e(nodeDescription(n, d))}</p></div><div class="node-foot"><span class="node-status state-${statusClass}">${icon({ succeeded: "check", failed: "failed", waiting_input: "waiting", running: "running" }[statusClass] || "queued")}${status}</span><span class="node-context" title="${e(d ? d.name + " · v" + d.version : "节点缺失")}">${e(step?.cached ? "已复用结果" : nodeContext(n, d, step))}</span></div>${["input", "output"].map((side) => (d?.[side === "input" ? "inputs" : "outputs"] || []).map((p, i) => `<button class="port ${side}" data-port="${p.id}" data-side="${side}" style="top:${60 + i * 22}px" title="${e(p.name||p.id)} · ${e(p.types.join("/"))}" aria-label="${e((n.name || d.name) + " " + side + " " + (p.name||p.id))}"></button>`).join("")).join("")}</div>`;
  }).join("");
  $(".canvas-info").innerHTML = `<span class="node-legend">${Object.entries(getNodePalettes()).map(([id, p]) => `<span><i style="background:${p.accent}"></i>${e(p.label)}</span>`).join("")}</span><span>${nodes.length} 个节点 · ${flow.graph.edges.length} 条连接</span>`;
  $("#zoom-value").textContent = Math.round(view.k * 100) + "%";
  const mini = $("#minimap");
  mini.setAttribute("viewBox", "-40 -40 1250 850");
  mini.innerHTML = nodes.map((n) => {
    const p = nodePalette(def(n.type), n.color);
    return `<rect x="${n.x}" y="${n.y}" width="224" height="154" rx="8" stroke="${p.accent}" stroke-width="3" fill="${selected.has(n.id) ? p.accent : p.header}"/>`;
  }).join("");
  $("#canvas").classList.toggle("pan", tool === "pan" || space);
  $("#canvas").classList.toggle("connecting", !!link);
}
function streamContent(raw) {
  const match = raw.match(/"content"\s*:\s*"/);
  if (!match) return "正在组织文档…";
  let out = "";
  const tail = raw.slice(match.index + match[0].length);
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === '"') break;
    if (tail[i] === "\\") {
      const c = tail[++i];
      if (c === void 0) break;
      out += { n: "\n", r: "\r", t: "	", '"': '"', "\\": "\\" }[c] ?? c;
    } else out += tail[i];
  }
  return out;
}
function outlineFor(n) {
  const d = def(n.type);
  return n.config.outline ?? d?.fields.find((f) => f.key === "outline")?.default ?? "# " + (n.name || d?.name || "文档") + "\n## 核心结论\n## 依据与分析\n## 下一步";
}
function documentNode(n) {
  return def(n?.type)?.category === "report" && def(n?.type)?.executor === "ai";
}
function outlineCard(n) {
  let parsed;
  try {
    parsed = parseDocumentOutline(outlineFor(n));
  } catch {
  }
  return `<section class="node-outline-card"><div class="row"><b>文档大纲</b><small>${parsed ? parsed.documents.length + " 份文档" : "待设置"}</small></div><p>先设置章节，助手按大纲填写正文。</p><div class="outline-snippet">${parsed ? parsed.documents.flatMap((d) => d.headings).slice(0, 7).map((h) => `<div style="padding-left:${(h.level - 1) * 9}px">${e(h.title)}</div>`).join("") : "请填写有效的大纲"}</div><button data-edit-outline="${n.id}" ${busy() ? "disabled" : ""}>编辑文档大纲</button></section>`;
}
function bindOutlineButtons(scope = document) {
  scope.querySelectorAll("[data-edit-outline]").forEach((b) => b.onclick = () => editOutline(b.dataset.editOutline));
}
function editOutline(nid) {
  const fid = flow.id, n = flow.graph.nodes.find((n2) => n2.id === nid);
  if (!n) return;
  const d = def(n.type), defaultValue = d.fields.find((f) => f.key === "outline")?.default || outlineFor(n), m = modal("文档大纲 · " + (n.name || d.name), `<div class="outline-editor"><p class="muted"># 表示一份文档，## / ### 表示章节和小节。可在章节下写填写要求；多个 # 标题会分别生成文档供选择和导出。</p><div class="outline-editor-grid"><label><span>可编辑大纲</span><textarea id="outline-draft" spellcheck="false" ${busy() ? "disabled" : ""}>${e(outlineFor(n))}</textarea></label><aside><b>结构预览</b><div id="outline-tree"></div></aside></div><p id="outline-error" class="danger" role="alert"></p><div class="row"><button id="outline-default" ${busy() ? "disabled" : ""}>恢复节点默认大纲</button><button id="outline-export">导出大纲</button><span style="flex:1"></span><button id="outline-save" ${busy() ? "disabled" : ""}>保存大纲</button><button id="outline-generate" class="primary" ${busy() ? "disabled" : ""}>保存并生成文档</button></div><p><small>保存后用于下一次生成；本次生成会记录大纲快照，历史文档仍可单独查看和导出。</small></p></div>`);
  const update = () => {
    try {
      const parsed = parseDocumentOutline($("#outline-draft").value);
      $("#outline-error").textContent = "";
      $("#outline-tree").innerHTML = parsed.documents.map((doc) => `<section><strong>${e(doc.title)}</strong>${doc.headings.slice(1).map((h) => `<div style="padding-left:${(h.level - 2) * 12}px">${e(h.title)}</div>`).join("")}</section>`).join("");
      $("#outline-save").disabled = busy();
      $("#outline-generate").disabled = busy();
    } catch (error) {
      $("#outline-error").textContent = error.message;
      $("#outline-tree").replaceChildren();
      $("#outline-save").disabled = true;
      $("#outline-generate").disabled = true;
    }
  };
  $("#outline-draft").oninput = update;
  $("#outline-default").onclick = () => {
    $("#outline-draft").value = defaultValue;
    update();
  };
  $("#outline-export").onclick = guard(() => {
    const parsed = parseDocumentOutline($("#outline-draft").value);
    download((n.name || d.name) + "-大纲.md", parsed.text);
  });
  const save = guard(async (generate) => {
    if (flow.id !== fid) throw new Error("当前工作流已切换，请重新打开大纲");
    const parsed = parseDocumentOutline($("#outline-draft").value);
    if (!checkpoint()) return;
    flow.graph.nodes.find((n2) => n2.id === nid).config.outline = parsed.text;
    selected = /* @__PURE__ */ new Set([nid]);
    changed();
    $("#outline-save").disabled = true;
    $("#outline-generate").disabled = true;
    try {
      await flush();
      m.close();
      renderInspector();
      toast("大纲已保存，下次按此结构生成");
      if (generate) await run(nid);
    } catch (error) {
      update();
      throw error;
    }
  });
  $("#outline-save").onclick = () => save(false);
  $("#outline-generate").onclick = () => save(true);
  update();
}
function renderInspector() {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const n = node(), d = n && def(n.type), step = n && latest()?.nodes[n.id];
  $("#inspector-head").innerHTML = `<div class="inspector-head" style="${nodePaletteStyle(d, n?.color)}"><span class="node-icon">${icon(d?.icon || "grid")}</span><div><b>${e(n?.name || d?.name || "选择一个节点")}</b><small>${e(d ? cats[d.category] : "在画布中选择或添加节点")}</small></div></div>`;
  $("#chat-entry").innerHTML = "";
  $("#run-node").disabled = !n;
  const body = $("#details");
  if (!n) {
    body.innerHTML = '<div class="empty">每个节点有自己的配置、对话与输出。<br>按 N 添加节点。</div>';
    return;
  }
  if (tab === "config") {
    const hasOutline = documentNode(n) || d?.fields.some(f => f.key === "outline");
    const fields = (d?.fields || []).filter(f => !hasOutline || f.key !== "outline");
    const inputs = fields.filter(f => (d?.category === "input" && f.type !== "model") || ["file", "artifact"].includes(f.type) || ["content", "queries", "urls", "dataset"].includes(f.key));
    const outputs = fields.filter(f => f.key === "outline");
    const settings = fields.filter(f => f.type === "model");
    const tasks = fields.filter(f => !inputs.includes(f) && !outputs.includes(f) && !settings.includes(f));
    const section = (title, content, cls = "") => content ? `<section class="config-section ${cls}"><h3>${title}</h3>${content}</section>` : "";
    const upstream = flow.graph.edges.filter(x => x.to === n.id).map(x => flow.graph.nodes.find(n2 => n2.id === x.from)?.name).filter(Boolean);
    const materialEntry = d && ["ai", "statistics", "plugin"].includes(d.executor) ? `<details class="optional-material" ${n.config.materials ? "open" : ""}><summary>补充材料 <small>可选</small></summary><label><span>说明或摘录</span><textarea data-field="materials" placeholder="补充当前节点需要的材料或背景" ${busy() ? "disabled" : ""}>${e(n.config.materials || "")}</textarea></label></details>` : "";
    body.innerHTML = `${section("任务目标", tasks.map(f => fieldMarkup(f, n)).join(""))}${section("输入材料", `${upstream.length ? `<div class="source-list">${upstream.map(name => `<div>${icon("folder")}<span>${e(name)}</span><small>已连接</small></div>`).join("")}</div>` : d?.inputs?.length ? '<p class="upstream-line">连接上游节点，或直接补充材料。</p>' : ""}${inputs.map(f => fieldMarkup(f, n)).join("")}${materialEntry}`)}${section("输出要求", (hasOutline ? outlineCard(n) : "") + outputs.map(f => fieldMarkup(f, n)).join(""))}<details class="config-section node-settings"><summary><h3>节点设置</h3><span>${settings.length ? "名称与模型" : "节点名称"}</span></summary><label><span>节点名称</span><input id="node-name" value="${e(n.name)}" ${busy() ? "disabled" : ""}></label>${settings.map(f => fieldMarkup(f, n)).join("")}</details>${flow.runs.some(r=>r.nodes[n.id]?.output?.documents?.length) ? '<button id="open-node-docs">查看已生成文档</button>' : ""}<button id="inspect-current">查看内部流程与提示词</button><div class="node-maintenance"><button id="clear-context" class="danger">清空节点上下文</button><button id="delete-node" class="danger" ${busy() ? "disabled" : ""}>删除节点</button></div>`;
    bindOutlineButtons(body);
    if ($("#open-node-docs")) $("#open-node-docs").onclick=()=>openNodeDocuments(n.id);
    if ($("#inspect-current")) $("#inspect-current").onclick=guard(()=>inspectNode(n.type));
    $("#node-name").onchange = (ev) => {
      if (!checkpoint()) return;
      const currentNode = flow.graph.nodes.find(current => current.id === n.id);
      if (!currentNode) return;
      currentNode.name = ev.target.value.trim() || d?.name || n.type;
      changed();
      paint();
      $("#inspector-head b").textContent = currentNode.name;
    };
    body.querySelectorAll("[data-field]").forEach((el) => el.onchange = guard(async () => {
      if (!checkpoint()) return;
      const f = d.fields.find((f2) => f2.key === el.dataset.field), type = f?.type;
      let value = type === "boolean" ? el.checked : el.value;
      if (type === "number") {
        value = Number(value);
        if (!Number.isFinite(value)) throw new Error("请输入有效数字");
      }
      if (type === "json") {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error("请输入有效JSON");
        }
      }
      const currentNode = flow.graph.nodes.find(current => current.id === n.id);
      if (!currentNode) return;
      currentNode.config[el.dataset.field] = value;
      changed();
      paint();
    }));
    $("#clear-context").onclick = guard(async () => {
      await flush();
      await api(apiPath() + `/nodes/${n.id}/reset`, {});
      toast("当前节点对话已清空，下次运行将重新计算");
      await poll(true);
    });
    $("#delete-node").onclick = () => removeSelected();
    body.querySelectorAll("[data-upload]").forEach((b) => b.onclick = guard(() => upload(n, b.dataset.upload)));
    body.querySelectorAll("[data-remove-file]").forEach((b) => b.onclick = () => {
      if (!checkpoint()) return;
      const currentNode = flow.graph.nodes.find(current => current.id === n.id);
      if (!currentNode) return;
      const key=b.dataset.fileField;
      currentNode.config[key] = (currentNode.config[key]||[]).filter((f) => f.id !== b.dataset.removeFile);
      changed();
      renderInspector();
    });
    return;
  }
  if (tab === "output") {
    const live = flow.live?.find((x) => x.nodeId === n.id && x.id === latest()?.id);
    const successful = flow.runs.findLast((r) => r.nodes[n.id]?.output), output = successful?.nodes[n.id]?.output;
    body.innerHTML = `${documentNode(n) ? outlineCard(n) : ""}<div class="state-line ${step?.status || ""}">${e(step ? statuses[step.status] : "尚未运行")}${step?.output?.quality?.level === "partial" ? " · 信息不充分" : ""}${step?.cached ? " · 复用结果" : ""}</div>${live ? `<p class="state-line running">${e(live.label || "正在生成")}</p>${live.text ? `<details open><summary>实时生成内容</summary><pre>${e(streamContent(live.text))}</pre></details>` : ""}` : ""}${step?.error ? `<p class="danger">${e(step.error)}</p>` : ""}${step?.stages?.length?`<details><summary>实际执行阶段 · ${step.stages.length}步</summary><ol>${step.stages.map(s=>`<li>${e(s.label)} · ${e(({completed:"完成",failed:"失败",waiting_input:"等待补充",cancelled:"已停止",running:"运行中"})[s.status]||s.status)}</li>`).join("")}</ol></details>`:""}${step?.status === "waiting_input" ? '<button id="supplement">补充数据并继续</button>' : ""}${output ? `${qualityNotice(output.quality)}${renderMarkdown(output.summary || "")}<p><small>${output.assumptions.map(e).join("；")}</small></p>${output.documents.map((doc, i) => `<button data-doc="${i}">${e(doc.title)}</button>`).join("")}<details><summary>结构数据、计算与来源</summary><pre>${e(JSON.stringify(output, null, 2))}</pre></details>` : step?.checkpoint?.computed ? '<p class="state-line">代码计算已完成并保存，正在等待AI解读。</p>'+renderMarkdown('```json\n'+JSON.stringify(step.checkpoint.computed,null,2)+'\n```') : '<div class="empty">运行后在这里查看当前节点产物。</div>'}`;
    bindOutlineButtons(body);
    if ($("#open-node-docs")) $("#open-node-docs").onclick=()=>openNodeDocuments(n.id);
    if ($("#inspect-current")) $("#inspect-current").onclick=guard(()=>inspectNode(n.type));
    if ($("#supplement")) $("#supplement").onclick = () => waiting();
    body.querySelectorAll("[data-doc]").forEach((b) => b.onclick = () => showDocs(output.documents.map((doc) => ({ doc, run: successful, nid: n.id, nodeName: n.name })), Number(b.dataset.doc)));
    return;
  }
  body.innerHTML = '<div id="messages"></div>';
  $("#chat-entry").innerHTML = `<form class="chat-form" id="chat-form"><textarea id="chat-text" placeholder="与当前节点助手沟通，Enter发送，Shift+Enter换行"></textarea><button class="primary">发送</button><button type="button" id="reset-chat" class="danger">清空上下文</button></form>`;
  $("#chat-form").onsubmit = guard(async (ev) => {
    ev.preventDefault();
    const message = $("#chat-text").value.trim();
    if (!message) return;
    await flush();
    await api(apiPath() + `/nodes/${n.id}/chat`, { message });
    $("#chat-text").value = "";
    await poll(true);
  });
  $("#chat-text").onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      $("#chat-form").requestSubmit();
    }
  };
  $("#reset-chat").onclick = guard(async () => {
    await api(apiPath() + `/nodes/${n.id}/reset`, {});
    await poll(true);
  });
  paintMessages(true);
}
function fieldMarkup(f, n) {
  const value = n.config[f.key] ?? f.default ?? "", disabled = busy() ? "disabled" : "";
  let control = "";
  if (f.type === "model") control = `<select data-field="${f.key}" ${disabled}><option value="">项目默认模型</option>${state.models.map((m) => `<option value="${m.id}" ${value === m.id ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select>`;
  else if (f.type === "select") control = `<select data-field="${f.key}" ${disabled}>${(f.options || []).map((o) => {
    const v = typeof o === "string" ? o : o.value;
    return `<option value="${e(v)}" ${v === value ? "selected" : ""}>${e(typeof o === "string" ? o : o.label)}</option>`;
  }).join("")}</select>`;
  else if (f.type === "artifact") control = `<select data-field="${f.key}" ${disabled}><option value="">选择历史文档或数据</option>${artifactOptions.map((a) => `<option value="${e(a.id)}" ${value === a.id ? "selected" : ""}>${e(a.title)}</option>`).join("")}</select>`;
  else if (f.type === "file") control = `<button type="button" data-upload="${f.key}" ${disabled}>＋ 上传文件</button>${(n.config[f.key] || []).map((file) => `<div class="row"><small>${e(file.title)}</small><button data-remove-file="${file.id}" data-file-field="${f.key}" ${disabled}>移除</button></div>`).join("")}`;
  else if (f.type === "boolean") control = `<input type="checkbox" data-field="${f.key}" ${value ? "checked" : ""} ${disabled} style="width:auto">`;
  else if (["textarea", "json"].includes(f.type)) control = `<textarea data-field="${f.key}" class="${f.key === "outline" ? "outline" : ""}" ${disabled}>${e(f.type === "json" ? JSON.stringify(value, null, 2) : value)}</textarea>`;
  else control = `<input data-field="${f.key}" type="${f.type === "number" ? "number" : "text"}" value="${e(value)}" ${disabled}>`;
  return `<label><span>${e(f.label)}</span>${control}</label>`;
}
function paintMessages(force = false) {
  const container = $("#messages"), n = node();
  if (!container || !n) return;
  const body = $("#details"), near = body.scrollHeight - body.scrollTop - body.clientHeight < 65;
  const messages = flow.messages.filter((m) => m.nodeId === n.id);
  container.innerHTML = messages.map((m) => {
    const live = flow.live?.find((x) => x.id === "chat:" + m.id);
    return `<div class="message ${m.role}"><small>${m.role === "user" ? "你" : "节点助手"}${m.status === "streaming" ? " · 正在回复" : ""}</small>${renderMarkdown(live?.text || m.content || "正在思考…")}${m.error ? `<p class="danger">${e(m.error)}</p>` : ""}${["ai", "statistics", "plugin", "text"].includes(def(n.type)?.executor) ? `<button data-message-material="${m.id}">确认作为节点材料</button>` : ""}${m.question && !m.answeredAt ? `<button data-question="${m.id}">回答助手问题</button>` : ""}</div>`;
  }).join("") || '<div class="empty">对话仅限当前节点，连接的数据会自动提供给助手。</div>';
  container.querySelectorAll("[data-message-material]").forEach((b) => b.onclick = guard(async () => {
    if (!checkpoint()) return;
    const m = messages.find((m2) => m2.id === b.dataset.messageMaterial);
    if (!m.content?.trim() || m.status === "streaming") throw new Error("请等待回复完成后确认");
    const key = def(n.type).executor === "text" ? "content" : "materials";
    n.config[key] = (n.config[key] || "") + "\n\n" + (m.role === "assistant" ? "AI建议（用户确认采用，事实仍待验证）：" : "用户补充：") + m.content;
    changed();
    await flush();
    toast("已加入当前节点材料，下次运行会使用");
  }));
  container.querySelectorAll("[data-question]").forEach((b) => b.onclick = () => askQuestion(messages.find((m) => m.id === b.dataset.question)));
  if (force || near) body.scrollTop = body.scrollHeight;
  const q = messages.find((m) => m.question && !m.answeredAt && !questionSeen.has(m.id));
  if (q && !$("#modal").open) {
    questionSeen.add(q.id);
    askQuestion(q);
  }
}
function askQuestion(message) {
  const q = message.question;
  if (!Array.isArray(q?.questions)) return;
  const m = modal(q.title || "补充信息", `<form id="question-form">${q.questions.map((item, i) => `<label><span>${e(item.prompt)}</span>${item.options?.length ? `<select name="answer${i}"><option value="">请选择或直接在下方补充</option>${item.options.map((o) => `<option>${e(o)}</option>`).join("")}</select>` : ""}<textarea name="extra${i}" placeholder="补充回答"></textarea></label>`).join("")}<button class="primary">发送给节点助手</button></form>`);
  $("#question-form").onsubmit = guard(async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target), message2 = q.questions.map((x, i) => x.prompt + "：" + [data.get("answer" + i), data.get("extra" + i)].filter(Boolean).join("；")).join("\n");
    await api(apiPath() + `/nodes/${node().id}/chat`, { message: message2 });
    m.close();
    await poll(true);
  });
}
async function run(target) {
  if (!flow) return;
  await flush();
  if (busy()) {
    const r = latest();
    await api(apiPath() + `/runs/${r.id}/stop`, {});
  } else {
    await api(apiPath() + "/run", target ? { targetNodeId: target } : {});
    tab = "output";
  }
  await poll(true);
  render();
}
function waiting() {
  const r = latest(), step = r?.nodes[r.currentNodeId];
  if (r?.status !== "waiting_input" || !step) return;
  const web=step.definition.executor==='web',stat=step.definition.executor==='statistics',allowAssumptions=['ai','plugin'].includes(step.definition.executor);
  const placeholder=web?'每行填写一个公开检索词，例如：AI电子宠物 用户评价。网址请停止后在节点配置中填写。':stat?'填写完整CSV或JSON数据（含表头），用空行与说明分隔。不能用假设跳过数值校验。':'补充目标、约束或其他缺失材料';
  const m = modal(web?'联网取材需要检索词':stat?'统计节点需要有效数据':'当前节点需要补充材料', `<p>${e(step.error)}</p><ul>${(step.suggestions || []).map((x) => `<li>${e(x)}</li>`).join("")}</ul><textarea id="supplement-text" placeholder="${e(placeholder)}"></textarea><div class="row"><button id="back-supplement">停止并返回修改</button><button id="resume" class="primary">补充后继续</button>${["ai", "plugin"].includes(step.definition.executor) ? '<button id="draft">带假设生成草稿</button>' : ""}</div>${allowAssumptions?'<p class="muted">草稿会保留证据缺口并传给下游，不能作为已验证结论。</p>':'<p class="muted">此节点需要有效输入，不能忽视输入要求继续。</p>'}`);
  $("#back-supplement").onclick = guard(async () => {
    await api(apiPath() + `/runs/${r.id}/stop`, {});
    m.close();
    await poll(true);
    tab = "config";
    render();
  });
  const resume = guard(async (allowDraft) => {
    await api(apiPath() + `/runs/${r.id}/resume`, { nodeId: r.currentNodeId, supplement: $("#supplement-text").value, allowDraft });
    m.close();
    await poll(true);
  });
  $("#resume").onclick = () => resume(false);
  if ($("#draft")) $("#draft").onclick = () => resume(true);
}
function allDocuments() {
  return [...flow?.runs || []].reverse().flatMap((run2) => Object.entries(run2.nodes).flatMap(([nid, n]) => (n.output?.documents || []).map((doc) => ({ doc, run: run2, nid, nodeName: n.definition.name }))));
}
function showDocs(docs, index = 0) {
  docIndex = index;
  docTab = "document";
  docContext = docs;
  modal("文档与分析", '<div id="docs"></div>');
  drawDocs();
}
function drawDocs() {
  const docs = docContext, item = docs[docIndex];
  if (!item) return;
  const doc = item.doc;
  $("#docs").innerHTML = `<div class="docs"><aside class="doc-list">${docs.map((x, i) => `<button data-doc-index="${i}" class="${i === docIndex ? "active" : ""}">${e(x.doc.title)}</button>`).join("")}</aside><article class="doc-reader"><div class="doc-tabs">${[["document", "文档"], ["summary", "总结分析"], ["html", "HTML展示"], ["data", "结构数据"], ["outline", "文档大纲"]].map(([id, label]) => `<button data-doc-tab="${id}" class="${docTab === id ? "active" : ""}">${label}</button>`).join("")}<button id="edit-charts" ${doc.format !== "markdown" ? "disabled" : ""}>完善图表数据</button><button id="export-doc">导出</button></div><div id="doc-content">${qualityNotice(doc.quality)}${doc.visualWarnings?.length?`<p class="danger">部分图表待完善：${doc.visualWarnings.map(e).join("；")}</p>`:""}${doc.editNote ? `<p class="quality-warning">${e(doc.editNote)}</p>` : ""}${docTab === "outline" ? `<p class="muted">本版本生成时使用的大纲</p><pre>${e(doc.outline || item.run.graph.nodes.find((n) => n.id === item.nid)?.config.outline || "本历史版本未记录大纲快照")}</pre>${flow.graph.nodes.some((n) => n.id === item.nid) && documentNode(flow.graph.nodes.find((n) => n.id === item.nid)) ? `<button data-edit-outline="${item.nid}">修改大纲并重新生成</button>` : ""}` : docTab === "document" ? documentMarkup(doc) : docTab === "summary" ? renderMarkdown(documentSummary(doc)) : docTab === "html" ? doc.htmlPresentation ? frameMarkup(doc.htmlPresentation) : '<p class="muted">按需生成当前文档的HTML展示。</p><button id="generate-html" class="primary">生成 HTML</button>' : `<pre>${e(JSON.stringify(item.run.nodes[item.nid].output.analysis || item.run.nodes[item.nid].output.computed || {}, null, 2))}</pre>`}</div></article></div>`;
  $("#modal .modal-body").style.padding = "0";
  document.querySelectorAll("[data-doc-index]").forEach((b) => b.onclick = () => {
    docIndex = Number(b.dataset.docIndex);
    drawDocs();
  });
  document.querySelectorAll("[data-doc-tab]").forEach((b) => b.onclick = () => {
    docTab = b.dataset.docTab;
    drawDocs();
  });
  bindOutlineButtons($("#docs"));
  $("#edit-charts").onclick=()=>editDocumentCharts(item);
  $("#export-doc").onclick = () => {
    if (docTab === "html" && !doc.htmlPresentation) {
      toast("请先生成HTML展示再导出");
      return;
    }
    const outline = doc.outline || item.run.graph.nodes.find((n) => n.id === item.nid)?.config.outline || "";
    download(doc.title + (docTab === "outline" ? "-大纲.md" : docTab === "html" ? ".html" : ".md"), docTab === "outline" ? outline : docTab === "html" ? doc.htmlPresentation : docTab === "summary" ? documentSummary(doc) : doc.content+(doc.quality?.missing?.length?"\n\n---\n\n资料完整性清单（导出附录）\n\n"+doc.quality.missing.map(x=>"- "+x).join("\n"):""));
  };
  if ($("#generate-html")) $("#generate-html").onclick = guard(async () => {
    const b = $("#generate-html");
    b.disabled = true;
    b.textContent = "正在生成…";
    const cancel=document.createElement("button");cancel.textContent="停止生成";b.after(cancel);
    cancel.onclick=guard(async()=>{await api(apiPath()+`/nodes/${item.nid}/html`,{documentId:doc.id,action:"stop"});cancel.remove();});
    try {
      const out = await api(apiPath() + `/nodes/${item.nid}/html`, { runId: item.run.id, documentId: doc.id });
      doc.htmlPresentation = out.html;
      drawDocs();
    } catch (error) {
      b.disabled = false;
      b.textContent = "重试生成 HTML";
      throw error;
    } finally {cancel.remove();}
  });
  hydrateVisuals($("#docs"));
}
async function projectDocuments() {
  await flush();
  artifactOptions = await api(apiPath() + "/artifacts");
  modal("项目产物", artifactOptions.map((a, i) => `<section class="list-card"><b>${e(a.title)}</b><p>${e(a.output.summary || "")}</p><button data-artifact-view="${i}">查看数据与文档</button></section>`).join("") || '<div class="empty">暂无产物</div>');
  document.querySelectorAll("[data-artifact-view]").forEach((b) => b.onclick = () => {
    const a = artifactOptions[Number(b.dataset.artifactView)];
    modal(a.title, renderMarkdown(a.output.documents?.map((d) => d.content).join("\n\n") || a.output.summary) + `<details><summary>结构数据</summary><pre>${e(JSON.stringify(a.output, null, 2))}</pre></details>`);
    hydrateVisuals($("#modal"));
  });
}
async function useTool(id) {
  if (id === "add") {
    if (!flow) return;
    modal("添加节点", `<input id="pick-search" placeholder="搜索能力"><div id="pick-list"></div>`);
    const draw = () => {
      $("#pick-list").innerHTML = Object.entries(cats).map(([cat, label]) => `<h3>${label}</h3><div class="library-grid">${catalog.nodes.filter((d) => d.category === cat && (d.name + d.description).includes($("#pick-search").value)).map((d) => `<button data-pick="${d.id}" class="library-card ${d.category}" style="${nodePaletteStyle(d)}"><span class="library-node-title"><span class="node-icon">${icon(d.icon || "grid")}</span><b>${e(d.name)}</b></span><small>${e(d.description)}</small></button>`).join("")}</div>`).join("");
      document.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
        addNode(b.dataset.pick);
        $("#modal").close();
        paint();
        renderInspector();
      });
    };
    $("#pick-search").oninput = draw;
    draw();
    $("#pick-search").focus();
    return;
  }
  if (id === "keys") {
    modal("画布快捷键", "<table><tr><td>V</td><td>选择 / 框选</td><td>H / 按住Space</td><td>平移画布</td></tr><tr><td>N</td><td>添加节点</td><td>Z / Shift+Z</td><td>放大 / 缩小</td></tr><tr><td>C</td><td>节点底色</td><td>⌘G</td><td>打组</td></tr><tr><td>⌘Z / ⌘Shift+Z</td><td>撤销 / 重做</td><td>Delete</td><td>删除选择</td></tr><tr><td>Shift+点击</td><td>多选</td><td>Escape</td><td>取消连线 / 选择</td></tr><tr><td>滚轮</td><td>平移，⌘/Ctrl+滚轮缩放</td><td>?</td><td>打开快捷键</td></tr></table><p>点击输出端口再点击目标输入端口创建连接。点击连线可删除。</p>");
    return;
  }
  if (id === "color") {
    if (!selected.size) {
      toast("请先选择节点");
      return;
    }
    modal("节点配色", `<p>默认按节点类型区分，也可以为选中的节点设置独立底色。</p><div class="color-choices"><button data-color="auto" class="automatic-color"><span class="auto-swatches">${Object.values(getNodePalettes()).map((p) => `<i style="background:${p.header}"></i>`).join("")}</span><span>按节点类型</span></button>${customNodeColors.map((c) => `<button data-color="${c.value}"><i style="background:${c.value}"></i><span>${e(c.label)}</span></button>`).join("")}</div>`);
    document.querySelectorAll("[data-color]").forEach((b) => b.onclick = () => {
      if (!checkpoint()) return;
      flow.graph.nodes.filter((n) => selected.has(n.id)).forEach((n) => {
        if (b.dataset.color === "auto") delete n.color;
        else n.color = b.dataset.color;
      });
      changed();
      $("#modal").close();
      paint();
      renderInspector();
    });
    return;
  }
  if (id === "group") {
    if (selected.size < 2) {
      toast("Shift选择至少两个节点后打组");
      return;
    }
    if (!checkpoint()) return;
    const ns = flow.graph.nodes.filter((n) => selected.has(n.id)), x = Math.min(...ns.map((n) => n.x)) - 18, y = Math.min(...ns.map((n) => n.y)) - 18;
    flow.graph.groups ??= [];
    flow.graph.groups.push({ id: crypto.randomUUID(), name: await askText("分组名称", "资料收集") || "分组", members: [...selected], x, y, w: Math.max(...ns.map((n) => n.x)) + 234 - x, h: Math.max(...ns.map((n) => n.y)) + 182 - y });
    changed();
    paint();
    return;
  }
  if (id === "undo") {
    historyEdit(false);
    return;
  }
  if (id === "zoom") {
    zoom(1.15);
    return;
  }
  tool = id;
  document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  paint();
}
function historyEdit(forward) {
  if (!flow || busy()) return;
  const from = forward ? redo : undo, to = forward ? undo : redo;
  if (!from.length) return;
  to.push(structuredClone(flow.graph));
  flow.graph = from.pop();
  selected = new Set([...selected].filter((id) => flow.graph.nodes.some((n) => n.id === id)));
  view = flow.graph.view || view;
  changed();
  paint();
  renderInspector();
}
function removeSelected() {
  if (!flow || !selected.size || !checkpoint()) return;
  flow.graph.nodes = flow.graph.nodes.filter((n) => !selected.has(n.id));
  flow.graph.edges = flow.graph.edges.filter((x) => !selected.has(x.from) && !selected.has(x.to));
  flow.graph.groups = (flow.graph.groups || []).map((g) => ({ ...g, members: g.members.filter((id) => !selected.has(id)) })).filter((g) => g.members.length > 1);
  selected.clear();
  changed();
  paint();
  renderInspector();
}
function persistView() {
  flow.graph.view = { ...view };
  if (!busy()) changed();
}
function zoom(factor, cx, cy) {
  const box = $("#canvas")?.getBoundingClientRect();
  if (!box) return;
  cx ??= box.width / 2;
  cy ??= box.height / 2;
  const k = Math.max(0.3, Math.min(2.2, view.k * factor)), ratio = k / view.k;
  view.x = cx - (cx - view.x) * ratio;
  view.y = cy - (cy - view.y) * ratio;
  view.k = k;
  paint();
  persistView();
}
function fit() {
  const ns = flow?.graph.nodes, box = $("#canvas")?.getBoundingClientRect();
  if (!box || !ns.length) return;
  const left = Math.min(...ns.map((n) => n.x)), top = Math.min(...ns.map((n) => n.y)), w = Math.max(...ns.map((n) => n.x)) + 224 - left, h = Math.max(...ns.map((n) => n.y)) + 154 - top;
  view.k = Math.max(0.3, Math.min(1.1, (box.width - 180) / w, (box.height - 130) / h));
  view.x = (box.width - w * view.k) / 2 - left * view.k;
  view.y = (box.height - h * view.k) / 2 - top * view.k;
  paint();
  persistView();
}
function bindCanvas() {
  const canvas = $("#canvas");
  canvas.ondblclick=ev=>{
    const el=ev.target.closest("[data-node]");if(!el||ev.target.closest(".port"))return;
    const nid=el.dataset.node,r=flow.runs.findLast(r=>r.nodes[nid]?.output?.documents?.length);
    if(r)showDocs(r.nodes[nid].output.documents.map(doc=>({doc,run:r,nid,nodeName:r.nodes[nid].definition.name})));
  };
  canvas.onwheel = (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      const b = canvas.getBoundingClientRect();
      zoom(Math.exp(-ev.deltaY * 5e-3), ev.clientX - b.left, ev.clientY - b.top);
    } else {
      view.x -= ev.deltaX;
      view.y -= ev.deltaY;
      paint();
      persistView();
    }
  };
  canvas.onpointerdown = (ev) => {
    if (ev.target.closest(".tools,.zoom,.minimap")) return;
    const port = ev.target.closest(".port"), nodeEl = ev.target.closest("[data-node]"), edge = ev.target.closest("[data-edge]"), groupEl = ev.target.closest("[data-group]");
    if (port) {
      if (busy()) {
        toast("运行时不可修改连线");
        return;
      }
      if (port.dataset.side === "output") {
        link = { from: nodeEl.dataset.node, output: port.dataset.port };
        toast("请选择目标节点的输入端口");
        paint();
        return;
      }
      if (link) {
        const target = flow.graph.nodes.find((n) => n.id === nodeEl.dataset.node), source = flow.graph.nodes.find((n) => n.id === link.from), out = def(source.type).outputs.find((p) => p.id === link.output), input = def(target.type).inputs.find((p) => p.id === port.dataset.port);
        if (source.id === target.id || !out.types.some((t) => input.types.includes(t))) {
          toast("连接端口数据类型不匹配");
          link = null;
          paint();
          return;
        }
        const candidate = { id: crypto.randomUUID(), ...link, to: target.id, input: input.id };
        if (flow.graph.edges.some((x) => x.from === candidate.from && x.to === candidate.to && x.output === candidate.output && x.input === candidate.input)) {
          toast("已有相同连线");
          link = null;
          return;
        }
        const edges = [...flow.graph.edges, candidate], seen = /* @__PURE__ */ new Set();
        const visit = (id) => {
          if (id === source.id) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return edges.filter((x) => x.from === id).some((x) => visit(x.to));
        };
        if (visit(target.id)) {
          toast("不能创建循环连接");
          link = null;
          paint();
          return;
        }
        if (checkpoint()) {
          flow.graph.edges.push(candidate);
          link = null;
          changed();
          paint();
          renderInspector();
        }
      }
      return;
    }
    if (edge) {
      if (confirm("删除这条连接？") && checkpoint()) {
        flow.graph.edges = flow.graph.edges.filter((x) => x.id !== edge.dataset.edge);
        changed();
        paint();
      }
      return;
    }
    if (nodeEl && !space && tool !== "pan") {
      const id = nodeEl.dataset.node;
      const now=performance.now(),double=lastNodePointer?.id===id && now-lastNodePointer.at<400 && Math.hypot(ev.clientX-lastNodePointer.x,ev.clientY-lastNodePointer.y)<6;
      lastNodePointer={id,at:now,x:ev.clientX,y:ev.clientY};
      if(double && !ev.shiftKey){lastNodePointer=null;if(openNodeDocuments(id))return;}
      if (ev.shiftKey) {
        selected.has(id) ? selected.delete(id) : selected.add(id);
      } else if (!selected.has(id)) selected = /* @__PURE__ */ new Set([id]);
      paint();
      renderInspector();
      if (busy()) return;
      if (!checkpoint()) return;
      drag(ev, "nodes");
      return;
    }
    if (groupEl && !space && tool !== "pan") {
      const group = flow.graph.groups.find((g) => g.id === groupEl.dataset.group);
      selected = new Set(group.members);
      if (checkpoint()) drag(ev, "group", group);
      return;
    }
    if (space || tool === "pan" || ev.button === 1) {
      drag(ev, "pan");
      return;
    }
    selected.clear();
    paint();
    renderInspector();
    drag(ev, "marquee");
  };
}
function drag(ev, kind, group) {
  const canvas = $("#canvas"), start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }, positions = flow.graph.nodes.filter((n) => selected.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y })), origin = group ? { x: group.x, y: group.y } : null;
  let moved = false, marquee;
  if (kind === "pan") canvas.classList.add("panning");
  if (kind === "marquee") {
    marquee = document.createElement("div");
    marquee.className = "marquee";
    canvas.append(marquee);
  }
  const b = canvas.getBoundingClientRect();
  const move = (ev2) => {
    const dx = ev2.clientX - start.x, dy = ev2.clientY - start.y;
    moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    if(moved)lastNodePointer=null;
    if (kind === "pan") {
      view.x = start.vx + dx;
      view.y = start.vy + dy;
      paint();
    } else if (kind === "marquee") {
      const x = Math.min(start.x, ev2.clientX) - b.left, y = Math.min(start.y, ev2.clientY) - b.top, w = Math.abs(dx), h = Math.abs(dy);
      Object.assign(marquee.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
      selected = new Set(flow.graph.nodes.filter((n) => {
        const nx = n.x * view.k + view.x, ny = n.y * view.k + view.y;
        return nx + 224 * view.k >= x && nx <= x + w && ny + 154 * view.k >= y && ny <= y + h;
      }).map((n) => n.id));
      paint();
    } else {
      for (const p of positions) {
        const n = flow.graph.nodes.find((n2) => n2.id === p.id);
        n.x = p.x + dx / view.k;
        n.y = p.y + dy / view.k;
      }
      if (group) {
        group.x = origin.x + dx / view.k;
        group.y = origin.y + dy / view.k;
      }
      paint();
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    marquee?.remove();
    canvas.classList.remove("panning");
    if (moved && kind === "pan") persistView();
    if (moved && ["nodes", "group"].includes(kind)) changed();
    renderInspector();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}
async function upload(n, fieldKey = "files") {
  await flush();
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.png,.jpg,.jpeg";
  picker.onchange = guard(async () => {
    const file = picker.files[0];
    if (!file) return;
    const ocr = /\.(png|jpe?g)$/i.test(file.name) || /\.pdf$/i.test(file.name) && confirm("是否对PDF使用OCR？文字版PDF可选取消。");
    toast("正在解析文件…");
    const query = new URLSearchParams({ projectId, flowId: flow.id, nodeId: n.id, filename: file.name, fieldKey, ocr: String(ocr) });
    const response = await fetch("/api/flow-files/parse?" + query, { method: "POST", headers: { "x-aipm-token": token }, body: file }), parsed = await response.json();
    if (!response.ok) throw new Error(parsed.error);
    const sheets = parsed.tables || [], content = parsed.content || sheets[0]?.content || "";
    modal("确认文件材料", `<p>${e(parsed.filename)} · ${e(parsed.method || "解析完成")}</p>${sheets.length ? `<label><span>选择工作表</span><select id="file-sheet">${sheets.map((s, i) => `<option value="${i}">${e(s.name)}</option>`).join("")}</select></label>` : ""}<textarea id="file-preview" style="height:350px">${e(content)}</textarea><p class="muted">请核对解析结果，确认后才会进入工作流输入。</p><button id="confirm-file" class="primary">确认加入节点</button>`);
    if ($("#file-sheet")) $("#file-sheet").onchange = () => $("#file-preview").value = sheets[Number($("#file-sheet").value)].content;
    $("#confirm-file").onclick = guard(async () => {
      await api(apiPath() + `/nodes/${n.id}/confirm-file`, { draftId: parsed.draftId, content: $("#file-preview").value, sheet: sheets[Number($("#file-sheet")?.value || 0)]?.name });
      $("#modal").close();
      await poll(true);
      renderInspector();
      toast("材料已确认");
    });
  });
  picker.click();
}
async function models() {
  await refreshState();
  modal("模型与连接", `<div class="row">${state.models.map((m) => `<button data-model="${m.id}">${m.id === state.settings.activeModelId ? "✓ " : ""}${e(m.name)}</button>`).join("")}<button id="new-model">＋ 添加模型</button></div><div id="model-editor"></div><details><summary>联网检索服务</summary><p class="muted">默认使用内置公开网页搜索；可配置专用检索服务。</p><form id="search-form"><label><span>服务</span><select name="provider"><option value="builtin">内置搜索</option><option value="tavily">Tavily</option><option value="brave">Brave</option></select></label><label><span>API Key（内置不需要）</span><input type="password" name="apiKey"></label><button>保存检索设置</button></form></details>`);
  const editor = (model) => {
    $("#model-editor").innerHTML = (model ? `<div class="row"><button id="make-default">设为项目默认</button><button id="test-model">测试连接</button><button id="remove-model" class="danger">删除连接</button></div>` : "") + modelFormMarkup(state.providers, model);
    bindModelForm({ providers: state.providers, model, save: (values) => api(model ? "/api/models/" + model.id : "/api/models", values), done: async () => {
      await refreshState();
      toast("连接已保存");
      await models();
    } });
    if (model) {
      $("#make-default").onclick = guard(async () => {
        await api("/api/settings", { activeModelId: model.id });
        await refreshState();
        await models();
      });
      $("#test-model").onclick = guard(async () => {
        await api("/api/models/" + model.id + "/test", {});
        toast("连接测试通过");
      });
      $("#remove-model").onclick = guard(async () => {
        if (!confirm("删除此模型连接？")) return;
        await api("/api/models/" + model.id, void 0, "DELETE");
        await models();
      });
    }
  };
  document.querySelectorAll("[data-model]").forEach((b) => b.onclick = () => editor(state.models.find((m) => m.id === b.dataset.model)));
  $("#new-model").onclick = () => editor();
  editor();
  $("#search-form select").value = state.settings.search?.provider || "builtin";
  $("#search-form").onsubmit = guard(async (ev) => {
    ev.preventDefault();
    const values = Object.fromEntries(new FormData(ev.target));
    if (!values.apiKey) delete values.apiKey;
    await api("/api/search/settings", values);
    toast("检索设置已保存");
  });
}
async function template() {
  if (!flow) return;
  await flush();
  const name = await askText("模板名称", flow.name + " · 副本");
  if (!name?.trim()) return;
  const graph = structuredClone(flow.graph), created = await api(`/api/projects/${projectId}/flows`, { name });
  await api(`/api/projects/${projectId}/flows/${created.id}`, { name, revision: created.revision, graph });
  await refreshState();
  toast("已复制为可复用工作流，包含配置和材料，不包含运行历史");
  render();
}
async function poll(force = false) {
  if (!flow || polling || dirty) return;
  const isBusy=busy()||flow.messages.some(m=>m.status==="streaming");
  if(!force&&!isBusy&&Date.now()-lastPollAt<5000)return;
  lastPollAt=Date.now();
  polling = true;
  try {
    const current = flow.id,status=await api(apiPath()+"/status");
    if(flow?.id!==current||dirty)return;
    if(!force&&statusSignature===status.signature){
      const changed=JSON.stringify(flow.live)!==JSON.stringify(status.live);flow.live=status.live;
      if(tab==="chat")paintMessages();
      if(tab==="output"&&changed){const body=$("#details"),scroll=body.scrollTop,near=body.scrollHeight-body.scrollTop-body.clientHeight<80;renderInspector();body.scrollTop=near?body.scrollHeight:scroll;}
      syncRunStatus();return;
    }
    const remote=await api(apiPath());statusSignature=status.signature;
    if (flow?.id !== current || dirty) return;
    const liveChanged = JSON.stringify(flow.live) !== JSON.stringify(remote.live);
    const before = JSON.stringify(flow.runs.map((r2) => [r2.status, r2.progress, Object.values(r2.nodes).map((n) => [n.status, n.error, n.cached])])), after = JSON.stringify(remote.runs.map((r2) => [r2.status, r2.progress, Object.values(r2.nodes).map((n) => [n.status, n.error, n.cached])])), changedStatus = before !== after;
    flow = remote;
    if (force || changedStatus) {
      paint();
      if (["history", "outputs"].includes(page)) renderSurface();
      if (tab === "output") renderInspector();
      $("#run").innerHTML = icon("running") + (busy() ? "停止运行" : "运行工作流");
      $("#run-state").textContent = latest()?.progress || statuses[latest()?.status] || "尚未运行";
    }
    if (tab === "output" && liveChanged) {
      const body = $("#details"), scroll = body.scrollTop, near = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
      renderInspector();
      body.scrollTop = near ? body.scrollHeight : scroll;
    }
    if (tab === "chat") paintMessages();
    syncRunStatus();
    const r = latest();
    if (r?.status === "waiting_input" && !questionSeen.has(r.id + ":" + r.currentNodeId) && !$("#modal").open) {
      questionSeen.add(r.id + ":" + r.currentNodeId);
      waiting();
    }
  } finally {
    polling = false;
  }
}
window.addEventListener("keydown", (ev) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) || ev.target.isContentEditable;
  if (typing || $("#modal").open) return;
  if (ev.key === " ") {
    ev.preventDefault();
    space = true;
    $("#canvas")?.classList.add("pan");
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    guard(flush)();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") {
    ev.preventDefault();
    historyEdit(ev.shiftKey);
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "g") {
    ev.preventDefault();
    useTool("group");
    return;
  }
  if (ev.key === "Escape") {
    link = null;
    selected.clear();
    paint();
    renderInspector();
    return;
  }
  if (["Backspace", "Delete"].includes(ev.key)) {
    ev.preventDefault();
    removeSelected();
    return;
  }
  const map = { v: "select", h: "pan", n: "add", c: "color", "?": "keys" };
  if (ev.key.toLowerCase() === "z") {
    zoom(ev.shiftKey ? 1 / 1.15 : 1.15);
    return;
  }
  if (map[ev.key.toLowerCase()]) {
    ev.preventDefault();
    useTool(map[ev.key.toLowerCase()]);
  }
});
window.addEventListener("keyup", (ev) => {
  if (ev.key === " ") {
    space = false;
    $("#canvas")?.classList.remove("pan");
  }
});
window.addEventListener("blur", () => space = false);
window.addEventListener("beforeunload", (ev) => {
  if (dirty) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
async function init() {
  catalog = await api("/api/nodes");
  await refreshState();
  if (!projectId) {
    render();
    return;
  }
  const first = state.projects.find((p) => p.id === projectId).workflows?.[0];
  if (first) await openFlow(first.id);
  else {
    const f = await api(`/api/projects/${projectId}/flows`, { name: "我的第一个工作流" });
    await refreshState();
    await openFlow(f.id);
  }
}
setInterval(() => guard(poll)(), 600);
setInterval(guard(async () => {
  const next = await api("/api/nodes");
  if (JSON.stringify(next) !== JSON.stringify(catalog)) {
    catalog = next;
    if (page === "library") renderSurface();
    else paint();
    toast("节点目录已更新");
  }
}), 5e3);
window.aipmDesktop?.onAction((action) => {
  if (action === "settings") guard(models)();
  if (action === "new-project") guard(newProject)();
  if (action === "all-documents") guard(projectDocuments)();
});
guard(init)();

function editDocumentCharts(item) {
  let charts=[],index=0,jsonDirty=false;
  const blocks=chartBlocks(item.doc.content),raw=blocks.map(b=>b.source);
  try{charts=raw.map(x=>JSON.parse(x));}catch{charts=[];}
  const back=()=>showDocs(docContext,docIndex);
  modal("完善图表数据",`<div class="chart-editor"><p>编辑数据、来源与证据性质，校验后预览并另存修订文档。原稿保留；正文判断不会自动重算，请核对图文一致性。</p><div class="row"><label><span>选择图表</span><select id="chart-pick"></select></label><button id="chart-add">添加图表</button><button id="chart-remove">移除当前图表</button></div><div id="chart-fields"></div><details ${raw.length&&!charts.length?'open':''}><summary>完整图表JSON（可修改图种、坐标、单位与数据字段）</summary><label><span>图表数组</span><textarea id="charts-json" spellcheck="false" style="height:250px"></textarea></label><button id="charts-apply">应用JSON到表格</button></details><p id="charts-error" role="alert" tabindex="-1"></p><div class="row"><button id="charts-preview">校验并预览</button><button id="charts-back">返回文档</button><button id="charts-save" class="primary">另存修订文档</button></div><div id="charts-preview-area"></div></div>`);
  const fail=error=>{const el=$("#charts-error");el.className="danger";el.textContent=error.message;el.focus();};
  const sync=()=>{ $("#charts-json").value=JSON.stringify(charts,null,2);jsonDirty=false;};
  $("#charts-json").oninput=()=>{jsonDirty=true;};
  const parse=()=>{if(jsonDirty)throw Error("请先点击“应用JSON到表格”，再预览或保存，避免丢失JSON修改");const invalid=document.querySelector('.chart-editor :invalid');if(invalid)throw Error(invalid.validationMessage);validateChartEdits(charts);$("#charts-error").className="";$("#charts-error").textContent="校验通过";return charts;};
  function fields(){
    $("#chart-pick").innerHTML=charts.map((c,i)=>`<option value="${i}" ${i===index?'selected':''}>${e(c.title||'图表 '+(i+1))}</option>`).join("");
    const c=charts[index];$("#chart-remove").disabled=!c;
    if(!c){$("#chart-fields").innerHTML='<p class="muted">当前没有图表。可添加，或从JSON补充/修复已有图表。</p>';return;}
    const rows=Array.isArray(c.data)?c.data:[],keys=[...new Set(rows.flatMap(r=>Object.keys(r||{})))];
    $("#chart-fields").innerHTML=`<div class="chart-meta"><label><span>图表标题</span><input id="chart-title" value="${e(c.title)}"></label><label><span>证据性质</span><select id="chart-evidence">${['已验证事实','用户观点','估算','分析推断','待验证','测试数据'].map(x=>`<option ${c.evidenceStatus===x?'selected':''}>${x}</option>`).join('')}</select></label></div><label><span>来源数组（id、title，可补url与日期）</span><textarea id="chart-sources">${e(JSON.stringify(c.sources||[],null,2))}</textarea></label><div class="chart-grid"><table><thead><tr>${keys.map(k=>`<th>${e(({name:"分类名称",value:"数值",sourceIds:"来源ID"})[k]||k)}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map((r,i)=>`<tr>${keys.map(k=>`<td><input data-cell="${i}" data-key="${e(k)}" aria-label="第${i+1}行 ${e(k)}" value="${e(r[k]===null?'':typeof r[k]==='object'?JSON.stringify(r[k]):r[k]??'')}"></td>`).join('')}<td><button data-remove-row="${i}">删除</button></td></tr>`).join('')}</tbody></table></div><button id="chart-add-row">添加数据行</button>`;
    $("#chart-title").oninput=ev=>{c.title=ev.target.value;sync();};$("#chart-evidence").onchange=ev=>{c.evidenceStatus=ev.target.value;sync();};
    $("#chart-sources").oninput=ev=>{try{c.sources=JSON.parse(ev.target.value);ev.target.setCustomValidity('');sync();$("#charts-error").textContent='';}catch(error){ev.target.setCustomValidity('来源JSON格式错误');fail(Error('来源JSON格式错误，请修正后再保存'));}};
    document.querySelectorAll('[data-cell]').forEach(el=>el.oninput=()=>{const row=c.data[Number(el.dataset.cell)],k=el.dataset.key,v=el.value;try{const numeric=Object.values(c.encoding||{}).some(a=>a?.field===k&&a.scale==='quantitative')||c.encoding?.value===k||typeof row[k]==='number';if(numeric&&v&&!Number.isFinite(Number(v)))throw Error('数值字段必须填写有效数字');row[k]=!v?null:numeric?Number(v):Array.isArray(row[k])||k==='sourceIds'?JSON.parse(v):v;el.setCustomValidity('');sync();$("#charts-error").textContent='';}catch(error){el.setCustomValidity(error.message);fail(error);}});
    document.querySelectorAll('[data-remove-row]').forEach(el=>el.onclick=()=>{c.data.splice(Number(el.dataset.removeRow),1);sync();fields();});
    $("#chart-add-row").onclick=()=>{c.data.push(Object.fromEntries(keys.map(k=>[k,k==='sourceIds'?[]:null])));sync();fields();};
  }
  $("#chart-pick").onchange=ev=>{index=Number(ev.target.value);fields();};
  $("#chart-add").onclick=()=>{charts.push({schema:'pm-chart-v1',id:crypto.randomUUID(),type:'bar',title:'待填写图表',evidenceStatus:'待验证',sources:[],data:[{name:'待填写',value:null,sourceIds:[]}],encoding:{x:{field:'name',scale:'category',categories:['待填写'],label:'分类'},y:{field:'value',scale:'quantitative',label:'数值'}}});index=charts.length-1;sync();fields();};
  $("#chart-remove").onclick=()=>{charts.splice(index,1);index=Math.max(0,index-1);sync();fields();};
  $("#charts-apply").onclick=()=>{try{const next=validateDocumentCharts(JSON.parse($("#charts-json").value));charts=next;index=0;sync();fields();$("#charts-error").textContent='JSON已应用，请预览后保存';}catch(error){fail(error);}};
  $("#charts-preview").onclick=()=>{try{const specs=parse();$("#charts-preview-area").innerHTML=renderMarkdown(specs.map(c=>'```chart\n'+JSON.stringify(c)+'\n```').join('\n\n'));hydrateVisuals($("#charts-preview-area"));$("#charts-preview-area").scrollIntoView({block:"start"});}catch(error){fail(error);}};
  $("#charts-back").onclick=back;
  $("#charts-save").onclick=async()=>{const b=$("#charts-save");try{b.disabled=true;const specs=parse();const revised=await api(apiPath()+`/nodes/${item.nid}/charts`,{runId:item.run.id,documentId:item.doc.id,charts:specs});const list=item.run.nodes[item.nid].output.documents;list.push(revised);docContext.push({...item,doc:revised});flow=await api(apiPath());paint();renderInspector();showDocs(docContext,docContext.length-1);}catch(error){fail(error);}finally{b.disabled=false;}};
  sync();if(raw.length&&!charts.length)$("#charts-json").value='[\n'+raw.join(',\n')+'\n]';fields();
}

function openNodeDocuments(nid){
 const r=flow.runs.findLast(r=>r.nodes[nid]?.output?.documents?.length);if(!r)return false;
 showDocs(r.nodes[nid].output.documents.map(doc=>({doc,run:r,nid,nodeName:r.nodes[nid].definition.name})));return true;
}

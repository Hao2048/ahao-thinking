import { validateGraph } from "./flow-graph.mjs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
const categories = /* @__PURE__ */ new Set(["input", "analysis", "report"]), executors = /* @__PURE__ */ new Set(["text", "file", "artifact", "web", "ai", "statistics", "plugin"]);
const fieldTypes = /* @__PURE__ */ new Set(["text", "textarea", "select", "number", "boolean", "json", "model", "file", "artifact"]);
export class NodeRegistry {
  constructor(root) {
    this.root = resolve(root);
    this.nodes = /* @__PURE__ */ new Map();
    this.errors = [];
    this.templates = [];
  }
  async local(directory, name) {
    if (typeof name !== "string" || !name || name.startsWith("/") || name.split(/[\\/]/).includes("..")) throw new Error("节点资源路径无效");
    const path = await realpath(join(directory, name));
    if (!path.startsWith(directory + sep)) throw new Error("节点资源不能越出自己的目录");
    return path;
  }
  async scan() {
    this.root = await realpath(this.root);
    const nodes = /* @__PURE__ */ new Map(), errors = [], duplicates = /* @__PURE__ */ new Set();
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      try {
        const directory = await realpath(join(this.root, entry.name));
        if (!directory.startsWith(this.root + sep)) throw new Error("不允许目录外的符号链接");
        const raw = await readFile(join(directory, "node.json"), "utf8");
        if (Buffer.byteLength(raw) > 128e3) throw new Error("节点定义过大");
        const d = JSON.parse(raw);
        if (d.schemaVersion !== 1 || !/^[-a-z0-9.]+$/.test(d.id || "") || (typeof d.name !== "string" || !d.name.trim() || d.name.length > 100) || !/^\d+\.\d+\.\d+$/.test(d.version || "") || !categories.has(d.category) || !executors.has(d.executor)) throw new Error("节点基本定义无效");
        if (d.enabled === false) continue;
        if (!Array.isArray(d.inputs) || !Array.isArray(d.outputs) || !d.outputs.length || !Array.isArray(d.fields)) throw new Error("节点端口或配置项无效");
        if(d.outputs.length>1&&d.executor!=="plugin")throw new Error("多输出端口需使用plugin并返回ports数据包映射");
        for (const list of [d.inputs, d.outputs]) {
          const ids = /* @__PURE__ */ new Set();
          for (const p of list) {
            if (!/^[-a-z0-9_]+$/.test(p.id) || ids.has(p.id) || !Array.isArray(p.types) || !p.types.length || p.types.some((t) => typeof t !== "string")) throw new Error("端口必须有唯一编号和数据类型");
            ids.add(p.id);
          }
        }
        const keys = /* @__PURE__ */ new Set();
        for (const f of d.fields) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.key) || keys.has(f.key) || !fieldTypes.has(f.type) || typeof f.label !== "string") throw new Error("配置表单定义无效");
          if (f.type === "select" && (!Array.isArray(f.options) || !f.options.length || f.options.some((o) => typeof o !== "string" && (!o || typeof o.value !== "string" || typeof o.label !== "string")))) throw new Error("选择字段需定义options");
          keys.add(f.key);
        }
        if(d.contextPolicy!==undefined&&(!d.contextPolicy||typeof d.contextPolicy!=="object"||typeof d.contextPolicy.downstream!=="boolean"))throw new Error("contextPolicy.downstream应为开关");
        let instruction = "";
        if (d.instructions) instruction = await readFile(await this.local(directory, d.instructions), "utf8");
        let plugin = "";
        if (d.executor === "plugin") {
          if (!d.entry) throw new Error("插件节点缺少 entry");
          plugin = await readFile(await this.local(directory, d.entry), "utf8");
        }
        if (Buffer.byteLength(instruction) + Buffer.byteLength(plugin) > 1e6) throw new Error("节点执行资源过大");
        const hashState = createHash("sha256");
        let packageBytes = 0;
        const hashFiles = async (path) => {
          for (const file of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            if (file.name.startsWith(".") || file.name === "node_modules") continue;
            const name = join(path, file.name);
            if (file.isSymbolicLink()) throw new Error("节点包内部不允许符号链接");
            if (file.isDirectory()) await hashFiles(name);
            else if (file.isFile()) {
              const bytes = await readFile(name);
              packageBytes += bytes.length;
              if (packageBytes > 1e7) throw new Error("节点包资源超过10 MB");
              hashState.update(name.slice(directory.length)).update(bytes);
            }
          }
        };
        await hashFiles(directory);
        const hash = hashState.digest("hex");
        if (nodes.has(d.id) || duplicates.has(d.id)) {
          nodes.delete(d.id);
          duplicates.add(d.id);
          throw new Error("节点编号重复：" + d.id);
        }
        nodes.set(d.id, { ...d, hash, instruction, directory });
      } catch (error) {
        errors.push({ package: entry.name, error: error.message });
      }
    }
    this.nodes = nodes;
    this.errors = errors;
    this.templates = [];
    try{this.upgradeConflicts=JSON.parse(await readFile(join(this.root,"_upgrade-conflicts.json"),"utf8")).conflicts||[];}catch(e){if(e.code!=="ENOENT")errors.push({package:"升级记录",error:e.message});this.upgradeConflicts=[];}
    try {
      for (const file of await readdir(join(this.root, "_templates"))) {
        if (!file.endsWith(".json")) continue;
        try {
          const t = JSON.parse(await readFile(join(this.root, "_templates", file), "utf8"));
          if (typeof t.id !== "string" || typeof t.name !== "string") throw new Error("模板格式无效");
          validateGraph(t.graph, this);
          this.templates.push(t);
        } catch (e) {
          errors.push({ package: "_templates/" + file, error: e.message });
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") errors.push({ package: "_templates", error: e.message });
    }
    return this.catalog();
  }
  catalog() {
    return { root: this.root, upgradeConflicts:this.upgradeConflicts||[], templates: this.templates, nodes: [...this.nodes.values()].map(({ directory, instruction, ...d }) => d), errors: this.errors };
  }
  get(id) {
    const node = this.nodes.get(id);
    if (!node) throw new Error("节点不可用或未安装：" + id);
    return node;
  }
  snapshot(id) {
    return structuredClone(this.get(id));
  }
  async plugin(definition) {
    const path = await this.local(definition.directory, definition.entry);
    return ({ config, inputs, upstream, signal, emitProgress, downstream=[] }) => new Promise((resolve2, reject) => {
      const worker = new Worker(new URL("./node-plugin-worker.mjs", import.meta.url), { workerData: { path, config, inputs, upstream, downstream }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        void worker.terminate();
        error ? reject(error) : resolve2(value);
      };
      const abort = () => finish(new Error("节点已停止"));
      const timer = setTimeout(() => finish(new Error("代码节点执行超时，请检查SOP或拆分节点")), 18e4);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      worker.on("message", (m) => {
        if (m.type === "progress") {
          Promise.resolve(emitProgress?.(m.value)).catch((error) => finish(error));
          return;
        }
        finish(m.error ? new Error(m.error) : null, m.value);
      });
      worker.once("error", (error) => finish(error));
      worker.once("exit", (code) => {
        if (!settled) finish(new Error("节点进程提前退出：" + code));
      });
    });
  }
}

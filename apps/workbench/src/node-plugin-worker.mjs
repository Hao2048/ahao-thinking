import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
try {
  const module = await import(pathToFileURL(workerData.path).href);
  if (typeof module.execute !== "function") throw new Error("节点入口必须导出 execute(context)");
  const value = await module.execute({ ...workerData, signal: new AbortController().signal, emitProgress: async (value2) => parentPort.postMessage({ type: "progress", value: value2 }) });
  parentPort.postMessage({ type: "result", value });
} catch (error) {
  parentPort.postMessage({ type: "result", error: error.message || String(error) });
}

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function ocrHelperPath() {
  return process.env.AIPM_OCR_HELPER || (process.env.AIPM_HARNESS_NODE_MODULES
    ? resolve(process.env.AIPM_HARNESS_NODE_MODULES, '../ocr-helper')
    : fileURLToPath(new URL('../.desktop-build/runtime/ocr-helper', import.meta.url)));
}
export async function ocrAvailable() {
  if (process.platform !== 'darwin') return false;
  try { await access(ocrHelperPath()); return true; } catch { return false; }
}
export async function recognizeFile(extension, bytes) {
  if (!await ocrAvailable()) throw new Error('本机 OCR 不可用，请使用 Mac 桌面版，或先将材料转换为文字');
  return new Promise((resolve, reject) => {
    const child = spawn(ocrHelperPath(), [extension], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('OCR 超过 120 秒，请拆分或缩小材料')); }, 120000);
    child.on('error', () => finish(new Error('本机 OCR 无法启动，请重新安装应用')));
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) { child.kill('SIGKILL'); finish(new Error('OCR 结果过大，请拆分材料')); } else chunks.push(chunk); });
    child.on('close', code => {
      if (settled) return;
      try {
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (message.error || code !== 0) throw new Error(message.error || 'OCR 进程异常停止');
        const result = message.result;
        if (!result || typeof result.content !== 'string' || !result.content.trim() || Buffer.byteLength(result.content) > 524288 || !Array.isArray(result.warnings) || !Array.isArray(result.tables) || result.method !== 'apple-vision-ocr') throw new Error('OCR 返回内容无效');
        finish(null, result);
      } catch (error) { finish(new Error(error.message === 'Unexpected end of JSON input' ? 'OCR 未返回可用结果' : error.message)); }
    });
    child.stdin.end(bytes);
  });
}

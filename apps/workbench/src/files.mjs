import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { extname, basename } from 'node:path';
import { recognizeFile } from './ocr.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
let active = 0;
export async function parseFile(filename, bytes, options = {}) {
  const name = basename(filename || '').replace(/[\x00-\x1f]/g, '');
  const extension = extname(name).toLowerCase();
  if (!['.txt','.md','.csv','.json','.pdf','.docx','.xlsx','.png','.jpg','.jpeg'].includes(extension)) throw new Error('支持 TXT、MD、CSV、JSON、PDF、DOCX、XLSX、PNG、JPG；旧版 DOC/XLS 请先转换');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error('文件需非空且不超过 20 MB');
  if (active >= 2) throw new Error('已有文件正在解析，请稍后重试');
  if (options.ocr !== undefined && typeof options.ocr !== 'boolean') throw new Error('OCR 选项无效');
  const image = ['.png','.jpg','.jpeg'].includes(extension);
  const needsOCR = image || (extension === '.pdf' && options.ocr === true);
  if (extension === '.png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('文件不是有效 PNG');
  if (['.jpg','.jpeg'].includes(extension) && !(bytes[0]===255 && bytes[1]===216 && bytes[2]===255)) throw new Error('文件不是有效 JPG');
  if (needsOCR && extension === '.pdf' && !bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效 PDF');
  active++;
  let worker;
  try {
    const result = needsOCR ? await recognizeFile(extension, bytes) : await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./file-worker.mjs', import.meta.url), { workerData: { extension, bytes }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      const timer = setTimeout(() => { reject(new Error('解析超过 30 秒，请缩小文件或拆分材料')); void worker.terminate(); }, 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      worker.once('message', message => { clearTimeout(timer); if (message.error) reject(new Error(message.error)); else resolve(message.result); });
      worker.once('error', () => fail(new Error('文件解析器异常，请检查文件或缩小材料')));
      worker.once('exit', code => { if (code !== 0) fail(new Error('文件解析超出资源限制或已停止')); });
    });
    return { ...result, filename: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), parsedAt: new Date().toISOString() };
  } finally { if (worker) await worker.terminate(); active--; }
}

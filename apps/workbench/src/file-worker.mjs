import { parentPort, workerData } from 'node:worker_threads';
import { dependency } from './dependencies.mjs';
import { MAX_INPUT_BYTES } from './domain.mjs';

const bytes = Buffer.from(workerData.bytes);
const extension = workerData.extension;
const warnings = [];
async function inspectZip(required) {
  const yauzl = dependency('yauzl');
  await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(new Error('文件不是有效的 Office ZIP 文档'));
    let total = 0, count = 0, found = false;
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('entry', entry => {
      total += entry.uncompressedSize; count++;
      if (entry.fileName === required) found = true;
      if (total > 40 * 1024 * 1024 || count > 10000 || (entry.generalPurposeBitFlag & 1)) return fail(new Error('Office 文档解压内容过大或已加密，请拆分文件'));
      zip.readEntry();
    });
    zip.on('end', () => found ? resolve() : reject(new Error('文件类型与扩展名不一致')));
    zip.readEntry();
  }));
}
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (value.formula || value.sharedFormula) {
    if (value.result === undefined) { warnings.push('有公式缺少缓存结果，已保留公式文本；应用不会计算公式'); return `=${value.formula || value.sharedFormula}`; }
    return cellText(value.result);
  }
  if (value.richText) return value.richText.map(part => part.text).join('');
  return value.text ?? value.error ?? JSON.stringify(value);
}
const csv = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"','""')}"` : value;
async function parse() {
  let content; let tables = []; let pages;
  if (extension === '.pdf') {
    if (!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效 PDF');
    const { PDFParse } = dependency('pdf-parse');
    const parser = new PDFParse({ data: bytes, isEvalSupported: false });
    try {
      const info = await parser.getInfo(); pages = info.total;
      if (pages > 100) throw new Error('PDF 超过 100 页，请拆分文件');
      content = (await parser.getText()).text;
    } finally { await parser.destroy(); }
    if (!content.replace(/--\s*\d+\s*(?:of\s*\d+)?\s*--/g,'').trim()) throw new Error('PDF 没有可提取的文字，可能是扫描件；可勾选本机 OCR 后重新上传');
    warnings.push('PDF 按文字顺序提取，复杂表格及图片请核对；不含 OCR');
  } else if (extension === '.docx') {
    await inspectZip('word/document.xml');
    const result = await dependency('mammoth').extractRawText({ buffer: bytes });
    content = result.value; warnings.push(...result.messages.map(message => message.message));
    warnings.push('Word 提取正文文字，不保留图片及版式');
  } else if (extension === '.xlsx') {
    await inspectZip('xl/workbook.xml');
    const ExcelJS = dependency('exceljs'); const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (workbook.worksheets.length > 20) throw new Error('工作表超过 20 张，请拆分工作簿');
    for (const sheet of workbook.worksheets) {
      if (sheet.actualRowCount > 10000 || sheet.columnCount > 200) throw new Error('单张工作表超过 10000 行或 200 列，请缩小范围');
      const rows = [];
      sheet.eachRow({ includeEmpty: false }, row => {
        const values = []; for (let index = 1; index <= sheet.columnCount; index++) values.push(cellText(row.getCell(index).value));
        rows.push(values);
      });
      if (rows.length) tables.push({ name: sheet.name, content: rows.map(row => row.map(csv).join(',')).join('\n'), rows: rows.length, columns: sheet.columnCount });
    }
    if (!tables.length) throw new Error('工作簿没有可提取的单元格');
    content = tables.map(table => `## 工作表：${table.name}\n${table.content}`).join('\n\n');
    warnings.push('按表读取；公式只使用文件内缓存值，不重算；请选定分析所用工作表');
  } else {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    if (extension === '.json') JSON.parse(content);
  }
  if (!content.trim()) throw new Error('文件中没有可用文字');
  if (Buffer.byteLength(content) > MAX_INPUT_BYTES) throw new Error('提取文字超过 512 KB，请拆分文件；不会静默截断');
  return { content, tables, ...(pages ? { pages } : {}), warnings: [...new Set(warnings)].slice(0,20) };
}
try { parentPort.postMessage({ result: await parse() }); }
catch (error) { parentPort.postMessage({ error: error.name === 'PasswordException' ? 'PDF 已加密，请先解密再上传' : error.message }); }

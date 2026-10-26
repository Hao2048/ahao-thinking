import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { parseFile } = await import(process.env.AIPM_TEST_FILES_MODULE || '../src/files.mjs');
const { ocrAvailable } = await import('../src/ocr.mjs');
import { startServer } from '../src/server.mjs';

test('image signatures and OCR options fail before starting native recognition', async () => {
  await assert.rejects(parseFile('fake.png', Buffer.from('fake')), /有效 PNG/);
  await assert.rejects(parseFile('fake.jpg', Buffer.from('fake')), /有效 JPG/);
  await assert.rejects(parseFile('file.pdf', Buffer.from('%PDF-'), {ocr:'true'}), /OCR 选项/);
});
test('native OCR recognizes Chinese, English, numbers, scanned PDF and rejects oversized PDF', {timeout:120000}, async t => {
  if (!await ocrAvailable()) { t.skip('本机 OCR helper 未构建'); return; }
  for (const extension of ['png','jpg','pdf']) {
    const buffer = await readFile(new URL(`./fixtures/ocr-sample.${extension}`, import.meta.url));
    const result = await parseFile(`扫描材料.${extension}`,buffer,{ocr:true});
    assert.match(result.content,/宠物陪伴/);
    assert.match(result.content,/Desktop companion research/);
    assert.match(result.content,/1000/); assert.match(result.content,/140/);
    assert.equal(result.method,'apple-vision-ocr');assert.deepEqual(result.ocrPages,[1]);
    assert.equal(result.sha256.length,64);
  }
  await assert.rejects(parseFile('过长.pdf',await readFile(new URL('./fixtures/ocr-too-long.pdf',import.meta.url)),{ocr:true}),/最多 30 页/);
  await assert.rejects(parseFile('损坏.pdf',Buffer.from('%PDF-1.4 invalid'),{ocr:true}),/有效 PDF/);
});

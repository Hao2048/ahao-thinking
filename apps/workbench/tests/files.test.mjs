import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const { parseFile } = await import(process.env.AIPM_TEST_FILES_MODULE || '../src/files.mjs');

test('DOCX extracts Chinese raw text without rendering links or scripts',async()=>{
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>访谈：我需要桌面宠物陪伴</w:t></w:r></w:p></w:body></w:document>');
  const parsed=await parseFile('访谈.docx',await zip.generateAsync({type:'nodebuffer'}));
  assert.match(parsed.content,/桌面宠物/);assert.equal(parsed.sha256.length,64);
});
test('XLSX exposes separate tables, cached formulas and proper CSV quoting',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('实验');
  sheet.addRows([['variant','users','conversions'],['A',1000,100],['B',{formula:'500*2',result:1000},140]]);
  const notes=book.addWorksheet('访谈');notes.addRow(['a,b','"quoted"']);
  const result=await parseFile('资料.xlsx',Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(result.tables.length,2);assert.match(result.tables[0].content,/B,1000,140/);assert.match(result.tables[1].content,/"a,b","""quoted"""/);
});
test('PDF extracts text and invalid formats do not become materials',async()=>{
  const stream='BT /F1 12 Tf 30 100 Td (Desktop companion research) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let document='%PDF-1.4\n';const offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(document));document+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(document);document+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result=await parseFile('研究.pdf',Buffer.from(document));assert.match(result.content,/Desktop companion research/);assert.equal(result.pages,1);
  await assert.rejects(parseFile('wrong.pdf',Buffer.from('fake PDF')),/有效 PDF/);
  await assert.rejects(parseFile('old.doc',Buffer.from('legacy')),/DOC\/XLS/);
  await assert.rejects(parseFile('bad.json',Buffer.from('{bad')),/JSON|Unexpected/);
});

import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {runtimeEdges,runtimeFile} from '../scripts/runtime-policy.mjs';
test('slim CLI still includes every external import in upstream launcher and commands',async()=>{
 const directory=new URL('../../../deepseek-harness/apps/cli/lib/',import.meta.url),manifest=JSON.parse(await readFile(new URL('../package.json',directory)));const {required}=runtimeEdges(manifest);
 for(const file of await readdir(directory)){if(!file.endsWith('.js'))continue;const source=await readFile(new URL(file,directory),'utf8');for(const match of source.matchAll(/(?:from\s*|import\(\s*)["']([^"']+)["']/g)){const id=match[1];if(id.startsWith('.')||id.startsWith('node:'))continue;const name=id.startsWith('@')?id.split('/').slice(0,2).join('/'):id.split('/')[0];assert.ok(required[name],`${file} imports ${name}`);}}
 assert.ok(!required['@deepseek-ai/dsh-web-app']);
});
test('minimal SDK plugin keeps executable imports but excludes unused ordinary-bundle Office plugins',async()=>{
 const directory=new URL('../../../deepseek-harness/packages/bundle/sdk-app/',import.meta.url),manifest=JSON.parse(await readFile(new URL('package.json',directory)));const {required}=runtimeEdges(manifest),source=await readFile(new URL('lib/index.js',directory),'utf8');for(const match of source.matchAll(/from\s*["']([^"']+)["']/g)){const id=match[1];if(!id.startsWith('node:'))assert.ok(required[id],id);}
 assert.ok(!required['@deepseek-ai/dsh-skill-office']);assert.ok(required['@deepseek-ai/dsh-sdk-jsonrpc-server']);
});
test('runtime copy keeps licenses and document engines while dropping development and browser duplicates',()=>{
 for(const path of ['lib/index.js','package.json','LICENSE','fonts/standard.pfb','cmaps/Adobe-Japan1.bcmap'])assert.equal(runtimeFile(path,'pdfjs-dist'),true);
 for(const path of ['lib/types/index.d.ts','lib/index.js.map','tests/fixture.json','docs/example.md','lib/tsconfig.tsbuildinfo'])assert.equal(runtimeFile(path,'pdfjs-dist'),false);
 assert.equal(runtimeFile('dist/exceljs.min.js','exceljs'),false);assert.equal(runtimeFile('lib/exceljs.nodejs.js','exceljs'),true);
});

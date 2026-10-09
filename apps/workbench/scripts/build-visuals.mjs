import {build} from 'esbuild';
import {mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(root+'public/vendor',{recursive:true});
// Every matching file is an esbuild output. Remove stale hashed chunks before
// regenerating, rather than shipping previous diagram builds in the app.
for(const name of await readdir(root+'public/vendor'))if(/^(?:chunk-[\w-]+|echarts|mermaid)\.mjs(?:\.LEGAL\.txt)?$/.test(name))await rm(root+'public/vendor/'+name);
await build({absWorkingDir:root,entryPoints:{echarts:'scripts/visual-entry/echarts.mjs',mermaid:'scripts/visual-entry/mermaid.mjs'},outdir:'public/vendor',bundle:true,splitting:true,format:'esm',minify:true,target:'chrome120',entryNames:'[name]',chunkNames:'chunk-[hash]',outExtension:{'.js':'.mjs'},legalComments:'linked',logLevel:'warning'});
for(const pkg of ['echarts','mermaid','zrender']){const base=root+'node_modules/'+pkg+'/';let license;for(const name of ['LICENSE','LICENSE.txt'])try{license=await readFile(base+name);break;}catch{}if(license)await writeFile(root+'public/vendor/'+pkg+'-LICENSE.txt',license);}
console.log('Offline ECharts and Mermaid bundles ready');

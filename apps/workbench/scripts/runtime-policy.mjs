// The workbench only launches the sdk-minimal profile. Keep the CLI launcher
// and its imports, rather than its dependencies for every shipped UI/profile.
export const workbenchCliDependencies=new Set([
 '@deepseek-ai/cordis','@deepseek-ai/cordis-plugin-include','@deepseek-ai/cordis-plugin-loader','@deepseek-ai/cordis-plugin-timer',
 '@deepseek-ai/dsh-app-boot','@deepseek-ai/dsh-home-paths','@deepseek-ai/dsh-http-proxy','@deepseek-ai/dsh-launch-environment','@deepseek-ai/dsh-cmdline',
 '@deepseek-ai/dsh-plugin-manager','@deepseek-ai/dsh-atomic-write','commander'
]);
export function runtimeEdges(manifest){
 const required={...manifest.dependencies,...manifest.peerDependencies},optional={...manifest.optionalDependencies};
 for(const [name,meta]of Object.entries(manifest.peerDependenciesMeta||{}))if(meta.optional){optional[name]=required[name];delete required[name];}
 for(const name of Object.keys(optional))delete required[name];
 if(manifest.name==='@deepseek-ai/dsh')for(const name of Object.keys(required))if(!workbenchCliDependencies.has(name))delete required[name];
 // sdk-minimal mounts sdk-app's entry plugin directly, not its ordinary bundle.
 if(manifest.name==='@deepseek-ai/dsh-sdk-app'){delete required['@deepseek-ai/dsh-skill-office'];delete required['@deepseek-ai/dsh-tool-workspace-dependencies'];}
 return{required,optional};
}
export function runtimeFile(relativePath,packageName){
 const parts=relativePath.split('/'),base=parts.at(-1);
 if(parts.includes('node_modules')||parts.includes('.git'))return false;
 if(/^(license|copying|notice|third_party_notices)(\.|$)/i.test(base))return true;
 if(/\.d\.(ts|mts|cts)$|\.map$|\.tsbuildinfo$/.test(base))return false;
 if(parts.some(p=>['test','tests','__tests__','example','examples','docs','.github','coverage'].includes(p)))return false;
 // ExcelJS's browser distributions duplicate its Node entry (lib/exceljs.nodejs.js).
 if(packageName==='exceljs'&&parts[0]==='dist')return false;
 return true;
}

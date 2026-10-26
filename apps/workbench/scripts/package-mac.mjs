import {runtimeEdges,runtimeFile} from './runtime-policy.mjs';
import { mkdir, cp, readFile, writeFile, rename, access, realpath, readdir, rm, symlink, chmod } from 'node:fs/promises';
import { globSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { releaseOptions, notarize, fileDigest, updateManifest } from './release.mjs';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(appRoot, '../..');
const harnessRoot = join(projectRoot, 'deepseek-harness');
const buildRoot = join(appRoot, '.desktop-build');
const output = join(projectRoot, '产品经理工作台/桌面安装包');
const displayName = '阿浩Thinking';
const identifier = 'com.penghao.aipm.workbench';
const require = createRequire(join(harnessRoot, 'apps/desktop/package.json'));
const electron = require('electron');
const electronApp = resolve(dirname(electron), '../..');
const packages = new Map();
const manifestName = 'aipm-desktop-build.json';
const version = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')).version;

if (process.platform !== 'darwin' || !['arm64','x64'].includes(process.arch)) throw new Error('打包需要 arm64 或 Intel x64 Mac，产物架构与构建主机一致');
const release=process.argv.includes('--release')?releaseOptions():null;

function findPackage(name, from) {
  let current = from;
  while (true) {
    const candidate = join(current, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  throw new Error(`缺少依赖 ${name}（引用目录 ${from}）`);
}

async function resetOwnedBuild(directory) {
  if (existsSync(directory)) {
    if (!existsSync(join(directory, manifestName))) throw new Error(`拒绝覆盖非工作台构建目录：${directory}`);
    await rm(directory, { recursive: true });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, manifestName), JSON.stringify({ product: identifier, version }));
}

async function copyPackage(source, runtime) {
  const canonical = await realpath(source);
  if (packages.has(canonical)) return packages.get(canonical);
  const manifest = JSON.parse(await readFile(join(canonical, 'package.json'), 'utf8'));
  const suffix = createHash('sha256').update(canonical).digest('hex').slice(0, 10);
  const target = join(runtime, '.packages', `${manifest.name.replaceAll('/','+')}@${manifest.version}-${suffix}`);
  packages.set(canonical, target);
  await mkdir(target, { recursive: true });
  const localPackage = canonical.startsWith(harnessRoot + '/packages/') || canonical.startsWith(harnessRoot + '/vendor/') || canonical.startsWith(harnessRoot + '/native/') || canonical.startsWith(harnessRoot + '/apps/');
  if (localPackage && Array.isArray(manifest.files)) {
    const selected = new Set(['package.json']);
    for (const pattern of manifest.files.filter(pattern => !pattern.startsWith('!'))) {
      for (const file of globSync(pattern, { cwd: canonical })) selected.add(file);
    }
    for (const entry of await readdir(canonical)) if (/^(license|copying|notice|readme)(\.|$)/i.test(entry)) selected.add(entry);
    const ordered = [...selected].sort((a,b)=>a.length-b.length);
    const copied=[];
    for (const file of ordered) {
      if (!runtimeFile(file,manifest.name)||copied.some(parent=>file.startsWith(parent+'/'))) continue;
      await mkdir(dirname(join(target,file)),{recursive:true});
      await cp(join(canonical,file),join(target,file),{recursive:true,dereference:true,filter:path=>runtimeFile(relative(canonical,path),manifest.name)});
      copied.push(file);
    }
  } else {
    await cp(canonical,target,{recursive:true,dereference:true,filter:path=>runtimeFile(relative(canonical,path),manifest.name)});
  }
  const {required:dependencies,optional}=runtimeEdges(manifest);
  if(['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-app'].includes(manifest.name)){await writeFile(join(target,'package.json'),JSON.stringify({...manifest,dependencies,peerDependencies:{}},null,2));}
  for (const [name, isOptional] of [...Object.keys(dependencies).map(name=>[name,false]), ...Object.keys(optional).map(name=>[name,true])]) {
    let dependency;
    try { dependency = findPackage(name,canonical); }
    catch (error) { if (isOptional) continue; throw error; }
    const installed = await copyPackage(dependency,runtime);
    const link=join(target,'node_modules',name);
    await mkdir(dirname(link),{recursive:true});
    await symlink(relative(dirname(link),installed),link,'dir');
  }
  return target;
}

async function prepareRuntime() {
  await resetOwnedBuild(buildRoot);
  const runtime=join(buildRoot,'runtime');await mkdir(join(runtime,'node_modules'),{recursive:true});
  await cp(process.execPath,join(runtime,'node'));await chmod(join(runtime,'node'),0o755);
  const rootPackages = [join(harnessRoot,'packages/sdk/client'), join(harnessRoot,'packages/llm/llm-pi-ai'), join(harnessRoot,'packages/bundle/sdk-minimal'), join(harnessRoot,'packages/web/web-search-deepseek')];
  const appManifest = JSON.parse(await readFile(join(appRoot,'package.json'),'utf8'));
  for (const name of Object.keys(appManifest.dependencies || {})) rootPackages.push(findPackage(name,appRoot));
  for (const source of rootPackages) {
    const manifest=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
    const installed=await copyPackage(source,runtime);const link=join(runtime,'node_modules',manifest.name);
    await mkdir(dirname(link),{recursive:true});await symlink(relative(dirname(link),installed),link,'dir');
  }
  // Dynamic native loaders resolve platform packages from their own ancestry.
  // Keep precise per-package edges, with a root fallback matching npm hoisting.
  for (const [source, installed] of packages) {
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    const link = join(runtime, 'node_modules', manifest.name);
    if (existsSync(link)) continue;
    await mkdir(dirname(link), { recursive: true });
    await symlink(relative(dirname(link), installed), link, 'dir');
  }
  await cp(join(harnessRoot,'LICENSE'),join(runtime,'HARNESS_LICENSE'));
  await cp(join(harnessRoot,'THIRD_PARTY_NOTICES.md'),join(runtime,'THIRD_PARTY_NOTICES.md'));
  await writeFile(join(runtime,'runtime-manifest.json'),JSON.stringify({node:process.versions.node,harness:JSON.parse(await readFile(join(harnessRoot,'package.json'),'utf8')).version,packages:packages.size,architecture:process.arch},null,2));
  console.log(`Runtime ready: ${packages.size} production packages + Node ${process.versions.node}`);
}

async function prepareOCR() {
  const helper = join(buildRoot,'runtime/ocr-helper');
  const preferredSDK = join((await run('/usr/bin/xcode-select',['-p'])).stdout.trim(), 'SDKs/MacOSX.sdk');
  const sdk = process.env.AIPM_MACOS_SDK || (existsSync(preferredSDK) ? preferredSDK : (await run('/usr/bin/xcrun',['--show-sdk-path'])).stdout.trim());
  await run('/usr/bin/xcrun', ['swiftc', '-sdk', sdk, '-O', '-target', `${process.arch==='x64'?'x86_64':'arm64'}-apple-macos13.0`, join(appRoot,'native/ocr.swift'), '-o', helper], { maxBuffer: 1024*1024 });
  await chmod(helper, 0o755);
  console.log('Native OCR ready: Apple Vision / PDFKit');
}

async function icon(destination) {
  const sharp=require('sharp');const iconSet=join(buildRoot,'Workbench.iconset');await mkdir(iconSet,{recursive:true});
  const svg=await readFile(join(appRoot,'public/brand-logo.svg'));
  for(const size of [16,32,128,256,512])for(const scale of [1,2])await sharp(svg).resize(size*scale).png().toFile(join(iconSet,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
  await run('/usr/bin/iconutil',['-c','icns',iconSet,'-o',destination]);
}

async function packageApplication() {
  await mkdir(output,{recursive:true});
  const bundle=join(output,`${displayName}.app`);
  if(existsSync(bundle)) {
    const info=JSON.parse(await readFile(join(bundle,'Contents/Resources',manifestName),'utf8'));
    if(info.product!==identifier)throw new Error('拒绝覆盖其他应用');
    await rm(bundle,{recursive:true});
  }
  await run('/usr/bin/ditto',[electronApp,bundle]);
  const resources=join(bundle,'Contents/Resources');const packagedApp=join(resources,'app');
  await mkdir(packagedApp,{recursive:true});
  for(const path of ['src','public','desktop','nodes','package.json','README.md'])await cp(join(appRoot,path),join(packagedApp,path),{recursive:true});
  await cp(join(buildRoot,'runtime'),join(resources,'runtime'),{recursive:true,dereference:false,verbatimSymlinks:true});
  // Electron's example app is not used: Resources/app is our actual entry.
  await rm(join(resources,'default_app.asar'),{force:true});
  await icon(join(resources,'workbench.icns'));
  const plist=join(bundle,'Contents/Info.plist');
  const values={CFBundleIdentifier:identifier,CFBundleName:displayName,CFBundleDisplayName:displayName,CFBundleExecutable:'ProductWorkbench',CFBundleShortVersionString:version,CFBundleVersion:version,CFBundleIconFile:'workbench.icns',NSHighResolutionCapable:true,LSMinimumSystemVersion:'13.0'};
  for(const[key,value]of Object.entries(values))await run('/usr/bin/plutil',['-replace',key,'-json',JSON.stringify(value),plist]);
  await rename(join(bundle,'Contents/MacOS/Electron'),join(bundle,'Contents/MacOS/ProductWorkbench'));
  await writeFile(join(resources,manifestName),JSON.stringify({product:identifier,version,architecture:process.arch,node:process.versions.node,signing:release?'developer-id':'adhoc',createdAt:new Date().toISOString()},null,2));
  if(release){
    const {sign}=await import('@electron/osx-sign');
    const runtime=join(resources,'runtime');
    const binaries=[join(runtime,'node'),join(runtime,'ocr-helper'),...globSync('.packages/**/*.{node,dylib}',{cwd:runtime}).map(path=>join(runtime,path))];
    await sign({app:bundle,identity:release.identity,platform:'darwin',type:'distribution',hardenedRuntime:true,binaries,optionsForFile:file=>file===join(runtime,'node')?{entitlements:join(appRoot,'desktop/entitlements-node.plist'),hardenedRuntime:true}:null});
    const zip=join(buildRoot,'notary-app.zip');await run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,zip]);
    const report=await notarize(zip,release,run,bundle);
    // ZIPs cannot be stapled; staple the .app whose ticket the archive submitted.
    await writeFile(join(buildRoot,'notarization.json'),JSON.stringify(report,null,2));
  }else await run('/usr/bin/codesign',['--force','--deep','--sign','-',bundle],{maxBuffer:1024*1024});
  await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  console.log(`APP ${bundle}`);
  return bundle;
}

if(process.argv.includes('--reuse-runtime')) { await access(join(buildRoot,'runtime/runtime-manifest.json')); } else await prepareRuntime();
await run(process.execPath,[join(appRoot,'scripts/build-visuals.mjs')]);
await prepareOCR();
if(!process.argv.includes('--runtime-only')) {
  const bundle=await packageApplication();
  if(!process.argv.includes('--app-only')) {
    const stage=join(buildRoot,'dmg');
    await access(join(buildRoot,manifestName));
    await rm(stage,{recursive:true,force:true});
    await mkdir(stage,{recursive:true});await run('/usr/bin/ditto',[bundle,join(stage,`${displayName}.app`)]);await symlink('/Applications',join(stage,'Applications'),'dir');
    const dmg=join(output,`阿浩Thinking-${version}-mac-${process.arch}.dmg`);
    await run('/usr/bin/hdiutil',['create','-volname',displayName,'-srcfolder',stage,'-ov','-format','UDZO',dmg],{maxBuffer:1024*1024});console.log(`DMG ${dmg}`);
    // The staging copy is reproducible; do not keep a second complete app.
    await rm(stage,{recursive:true});
    if(release){await run('/usr/bin/codesign',['--sign',release.identity,'--timestamp',dmg]);await notarize(dmg,release,run);}
  }
  if(release){
    const zip=join(output,`aipm-workbench-${version}-mac-${process.arch}.zip`);
    await run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,zip]);
    await writeFile(join(output,`latest-${process.arch}.json`),JSON.stringify(updateManifest({version,architecture:process.arch,baseURL:release.baseURL,digest:await fileDigest(zip),notes:'阿浩Thinking正式发布'}),null,2));
    console.log('Signed release ZIP and architecture-specific update manifest ready (not published)');
  }
  if(process.argv.includes('--install')) {
    const destination=join(homedir(),'Applications',`${displayName}.app`);await mkdir(dirname(destination),{recursive:true});
    if(existsSync(destination)) {
      const existing=JSON.parse(await readFile(join(destination,'Contents/Resources',manifestName),'utf8'));
      if(existing.product!==identifier)throw new Error('已存在同名应用，拒绝覆盖');
      await rename(destination,`${destination}.backup-${Date.now()}`);
    }
    await run('/usr/bin/ditto',[bundle,destination]);
    await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',destination]);
    console.log(`INSTALLED ${destination}`);
  }
}

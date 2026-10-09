import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const loaders=new Map();
export function dependency(name) {
  const base=process.env.AIPM_HARNESS_NODE_MODULES?resolve(process.env.AIPM_HARNESS_NODE_MODULES,'..'):resolve(dirname(fileURLToPath(import.meta.url)),'..');
  if(!loaders.has(base))loaders.set(base,createRequire(join(base,'dependency-loader.cjs')));
  return loaders.get(base)(name);
}

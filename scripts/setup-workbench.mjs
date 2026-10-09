import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('需要 Node.js 24 或以上版本');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败`);
}
run('git', ['submodule', 'update', '--init', '--recursive']);
const upstream = resolve(root, 'deepseek-harness');
const manager = JSON.parse(readFileSync(resolve(upstream, 'package.json'), 'utf8')).packageManager;
// Use the upstream's pinned pnpm through npm; no global package-manager update.
const pnpm = args => run('npm', ['exec', '--yes', `--package=${manager}`, '--', 'pnpm', ...args], upstream);
pnpm(['install', '--frozen-lockfile']);
pnpm(['run', 'build:native-system']);
pnpm(['run', 'build:lib']);
run('npm', ['ci'], resolve(root, 'apps/workbench'));
run('npm', ['run', 'build:visuals'], resolve(root, 'apps/workbench'));
console.log('开发环境就绪。Mac 打包：cd apps/workbench && npm run desktop:package');

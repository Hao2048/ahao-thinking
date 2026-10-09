import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export const skillDirectories = ['AI产品经理Skill/ai-product-manager-research', 'edu-pm-workflow', 'pm-initiation-report'];
export function resolveSkillRoot(fallback) {
  if (process.env.AIPM_SKILL_ROOT) return resolve(process.env.AIPM_SKILL_ROOT);
  const candidates = [join(homedir(), 'Documents/Skills'), fallback, resolve(import.meta.dirname, '../../../skills')].filter(Boolean);
  return candidates.find(root => skillDirectories.every(path => existsSync(join(root, path, 'SKILL.md')))) || candidates.at(-1);
}

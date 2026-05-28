import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallStatus = 'created' | 'updated' | 'unchanged' | 'different';

const TEMPLATE_PATH = fileURLToPath(new URL('../skill-template/SKILL.md', import.meta.url));

function targetPath(home: string): string {
  return join(home, '.claude/skills/agentcrew/SKILL.md');
}

export function installSkill(home: string, opts: { force?: boolean } = {}): InstallStatus {
  const dst = targetPath(home);
  const bundled = readFileSync(TEMPLATE_PATH, 'utf8');
  if (existsSync(dst)) {
    const current = readFileSync(dst, 'utf8');
    if (current === bundled) return 'unchanged';
    if (!opts.force) return 'different';
    writeFileSync(dst, bundled, 'utf8');
    return 'updated';
  }
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, bundled, 'utf8');
  return 'created';
}

export function uninstallSkill(home: string): void {
  const dst = targetPath(home);
  if (existsSync(dst)) rmSync(dst);
}

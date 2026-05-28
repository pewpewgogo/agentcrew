import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, uninstallSkill } from '../../src/init/skill-install.js';

describe('skill-install', () => {
  it('copies bundled template into target dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain('contextsync');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('prompts when existing file differs (returns "different")', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      writeFileSync(path, 'local edits');
      const status = installSkill(home, { force: false });
      expect(status).toBe('different');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it('uninstall removes file', () => {
    const home = mkdtempSync(join(tmpdir(), 'sk-'));
    try {
      installSkill(home);
      uninstallSkill(home);
      const path = join(home, '.claude/skills/contextsync/SKILL.md');
      expect(existsSync(path)).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

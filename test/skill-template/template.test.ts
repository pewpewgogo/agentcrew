import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../../src/skill-template/SKILL.md', import.meta.url));

describe('skill template', () => {
  it('contains required frontmatter and key flows', () => {
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/^---\nname: contextsync/);
    expect(text).toMatch(/description:/);
    expect(text).toMatch(/list_projects/);
    expect(text).toMatch(/add_context/);
    expect(text).toMatch(/claim_task/);
    expect(text).toMatch(/never modify .?goal/i);
  });
});

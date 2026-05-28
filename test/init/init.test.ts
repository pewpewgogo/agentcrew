import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { freshSchema, closePool } from '../helpers/db.js';
import { buildTestApp, asUser } from '../helpers/http.js';
import { runInitWithHome } from '../../src/init/index.js';

const pool = await freshSchema();
const app = await buildTestApp(pool);
const baseUrl = `http://127.0.0.1:${(await app.listen({ port: 0, host: '127.0.0.1' })).match(/:(\d+)$/)![1]}`;
afterAll(async () => { await app.close(); await closePool(pool); });

describe('init', () => {
  it('writes config, skill file, and claude.json entry; smoke test passes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'init-'));
    try {
      await asUser(app, 'init@t.co');
      prompts.inject([baseUrl, 'init@t.co', 'password123', '']);
      await runInitWithHome(home);
      expect(existsSync(join(home, '.agentcrew/config.json'))).toBe(true);
      expect(existsSync(join(home, '.claude/skills/agentcrew/SKILL.md'))).toBe(true);
      const claudeCfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
      expect(claudeCfg.mcpServers.agentcrew.url).toContain('/mcp');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

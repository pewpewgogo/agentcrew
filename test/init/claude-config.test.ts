import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertMcpEntry, removeMcpEntry } from '../../src/init/claude-config.js';

describe('claude-config', () => {
  it('upserts agentcrew entry preserving siblings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'x' } }, foo: 1 }, null, 2));
      upsertMcpEntry(path, { url: 'https://x/mcp', token: 'cs_k_x' });
      const got = JSON.parse(readFileSync(path, 'utf8'));
      expect(got.foo).toBe(1);
      expect(got.mcpServers.other.command).toBe('x');
      expect(got.mcpServers.agentcrew.url).toBe('https://x/mcp');
      expect(got.mcpServers.agentcrew.headers.Authorization).toBe('Bearer cs_k_x');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('creates file if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      upsertMcpEntry(path, { url: 'https://x/mcp', token: 'cs_k_x' });
      expect(existsSync(path)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('removeMcpEntry deletes only agentcrew', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-'));
    try {
      const path = join(dir, 'claude.json');
      writeFileSync(path, JSON.stringify({
        mcpServers: { agentcrew: { url: 'x' }, other: { command: 'y' } },
      }));
      removeMcpEntry(path);
      const got = JSON.parse(readFileSync(path, 'utf8'));
      expect(got.mcpServers.agentcrew).toBeUndefined();
      expect(got.mcpServers.other).toBeDefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../../src/cli/config.js';

describe('config', () => {
  it('saves and loads round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-cfg-'));
    try {
      const path = join(dir, 'config.json');
      saveConfig(path, { serverUrl: 'http://x', token: 'tok', defaultProject: 'p' });
      const got = loadConfig(path);
      expect(got).toEqual({ serverUrl: 'http://x', token: 'tok', defaultProject: 'p' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig returns null when file does not exist', () => {
    expect(loadConfig('/no/such/file')).toBeNull();
  });
});

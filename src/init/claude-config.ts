import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function upsertMcpEntry(path: string, opts: { url: string; token: string }): void {
  let doc: any = {};
  if (existsSync(path)) doc = JSON.parse(readFileSync(path, 'utf8'));
  doc.mcpServers ??= {};
  doc.mcpServers.agentcrew = {
    type: 'http',
    url: opts.url,
    headers: { Authorization: `Bearer ${opts.token}` },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
}

export function removeMcpEntry(path: string): void {
  if (!existsSync(path)) return;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc?.mcpServers?.agentcrew) {
    delete doc.mcpServers.agentcrew;
    writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
  }
}

export function jsonOut(v: unknown): void {
  process.stdout.write(JSON.stringify(v, null, 2) + '\n');
}

export function table(rows: Record<string, unknown>[], cols: string[]): void {
  if (rows.length === 0) { process.stdout.write('(no rows)\n'); return; }
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const fmt = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  process.stdout.write(fmt(cols) + '\n');
  process.stdout.write(fmt(cols.map((_, i) => '-'.repeat(widths[i]!))) + '\n');
  for (const r of rows) process.stdout.write(fmt(cols.map((c) => String(r[c] ?? ''))) + '\n');
}

export function die(msg: string, exit = 1): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(exit);
}

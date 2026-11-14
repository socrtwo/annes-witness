import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveCase } from '../src/io/container';
import { buildSample } from '../src/ui/sample';

describe('command line', () => {
  it('reports status and checks for a case file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'witness-'));
    const file = join(dir, 'sample.witness');
    writeFileSync(file, await saveCase(buildSample(), [], new Map()));
    const status = execFileSync('npx', ['vite-node', 'scripts/witness-cli.ts', '--', 'status', file], { encoding: 'utf8' });
    expect(status).toMatch(/Open\s+3/);
    const report = execFileSync('npx', ['vite-node', 'scripts/witness-cli.ts', '--', 'report', file], { encoding: 'utf8' });
    expect(report).toContain('Mary Ann Smith');
    let code = 0;
    try { execFileSync('npx', ['vite-node', 'scripts/witness-cli.ts', '--', 'verify', file], { encoding: 'utf8' }); } catch (e: any) { code = e.status; }
    expect(code).toBe(1); // not sealed
  }, 120000);
});

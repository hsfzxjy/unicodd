import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const scriptPath = resolve('tools/check-size-budget.mjs');

function writeSizedFile(root: string, path: string, size: number): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.alloc(size, 97));
}

function createBuildFixture(javaScriptBytes: number): string {
  const root = mkdtempSync(join(tmpdir(), 'unicodd-size-budget-'));
  temporaryRoots.push(root);
  writeSizedFile(root, 'dist/assets/app.js', javaScriptBytes);
  writeSizedFile(root, 'dist/assets/app.css', 1);
  writeSizedFile(root, 'dist/wasm/unicodd_ops_core.wasm', 1);
  writeSizedFile(root, 'dist/wasm/unicodd_unicode_15.wasm', 1);
  writeSizedFile(root, 'dist/unicode-indexes/relationships-17.0.0.json', 1);
  writeSizedFile(root, 'dist/unicode-indexes/names-17.0.0.json', 1);
  return root;
}

function runSizeCheck(root: string) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('production size budgets', () => {
  it('reports raw and gzip sizes for a build within budget', () => {
    const result = runSizeCheck(createBuildFixture(450_000));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS Application JavaScript');
    expect(result.stdout).toContain('450,000 B (450.00 kB)');
    expect(result.stdout).toContain('gzip');
  });

  it('fails with the asset and exact overage when a budget is exceeded', () => {
    const result = runSizeCheck(createBuildFixture(450_001));

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL Application JavaScript');
    expect(result.stdout).toContain('1 B (0.00 kB) over budget');
    expect(result.stdout).toContain('450,000 B (450.00 kB)');
  });
});

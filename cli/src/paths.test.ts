import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './paths.js';

describe('repoRoot', () => {
  it('resolves the repository root regardless of process.cwd()', () => {
    const root = repoRoot();
    // The root is identified by containing the cli package and the migrations dir,
    // not by where the process was launched from.
    expect(fs.existsSync(path.join(root, 'cli', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'db', 'migrations'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts', 'migrate.sh'))).toBe(true);
  });

  it('is stable when cwd is the cli package (the npm --workspace case)', () => {
    const fromHere = repoRoot();
    const prev = process.cwd();
    try {
      process.chdir(path.join(fromHere, 'cli'));
      expect(repoRoot()).toBe(fromHere);
    } finally {
      process.chdir(prev);
    }
  });
});

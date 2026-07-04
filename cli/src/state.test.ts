import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, markStepComplete } from './state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbrain-state-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('state', () => {
  it('creates an empty v2 state with workersDeployed', () => {
    const state = loadState();
    expect(state.version).toBe(2);
    expect(state.workersDeployed).toEqual([]);
    expect(state.completedSteps).toEqual([]);
  });

  it('normalizes a v1 state file missing workersDeployed', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.openbrain-setup.json'),
      JSON.stringify({
        version: 1,
        completedSteps: [1, 2],
        lastRunAt: '2026-03-09T00:00:00.000Z',
        migrationsApplied: [],
        edgeFunctionsDeployed: ['capture'],
        claudeDesktopConfigured: true,
      })
    );
    const state = loadState();
    expect(state.workersDeployed).toEqual([]);
    expect(state.completedSteps).toEqual([1, 2]);
    expect(state.claudeDesktopConfigured).toBe(true);
  });

  it('round-trips save/load and records completed steps once', () => {
    const state = loadState();
    markStepComplete(state, 3);
    markStepComplete(state, 3);
    saveState(state);
    const reloaded = loadState();
    expect(reloaded.completedSteps).toEqual([3]);
  });
});

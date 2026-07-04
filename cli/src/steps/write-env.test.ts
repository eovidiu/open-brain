import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

import { writeEnvStep } from './write-env.js';

let tmpDir: string;

function makeState(): SetupState {
  return {
    version: 2,
    completedSteps: [],
    lastRunAt: '',
    migrationsApplied: [],
    workersDeployed: [],
    claudeDesktopConfigured: false,
  };
}

const FULL_VALUES: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@h/db',
  OPENAI_API_KEY: 'sk-o',
  ANTHROPIC_API_KEY: 'sk-a',
  CAPTURE_WEBHOOK_SECRET: 'hmac',
  CAPTURE_JWT_SECRET: 'jwt',
  MCP_CLIENT_SECRET: 'mcp',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbrain-we-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEnv(values: Record<string, string>): EnvFile {
  return { values: { ...values }, filePath: path.join(tmpDir, '.env') };
}

describe('writeEnvStep', () => {
  it('requires DATABASE_URL (no SUPABASE keys)', async () => {
    const env = makeEnv({ ...FULL_VALUES });
    delete env.values['DATABASE_URL'];

    const result = await writeEnvStep.run(makeState(), env);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('DATABASE_URL');
      expect(result.error).not.toContain('SUPABASE');
    }
  });

  it('writes the env file with defaults when all keys present', async () => {
    const env = makeEnv(FULL_VALUES);

    const result = await writeEnvStep.run(makeState(), env);

    expect(result.status).toBe('done');
    const content = fs.readFileSync(env.filePath, 'utf-8');
    expect(content).toContain('DATABASE_URL=postgresql://u:p@h/db');
    expect(content).toContain('EMBEDDING_MODEL=text-embedding-3-small');
    expect(content).not.toContain('SUPABASE');
  });

  it('warns when .gitignore does not cover .env', async () => {
    const uiModule = await import('../ui.js');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules\n');
    const env = makeEnv(FULL_VALUES);

    const result = await writeEnvStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(uiModule.warn).toHaveBeenCalledWith(expect.stringContaining('.gitignore'));
  });

  it('isComplete requires the file plus every required key', async () => {
    const env = makeEnv(FULL_VALUES);
    expect(await writeEnvStep.isComplete(makeState(), env)).toBe(false);
    await writeEnvStep.run(makeState(), env);
    expect(await writeEnvStep.isComplete(makeState(), env)).toBe(true);
  });
});

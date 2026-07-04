import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: { existsSync: vi.fn(() => true) },
}));

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock('../env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../env.js')>();
  return { ...actual, saveEnv: vi.fn() };
});

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { wranglerStep, WORKERS } from './wrangler.js';

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

function fullEnv(): EnvFile {
  return {
    filePath: '/tmp/.env',
    values: {
      DATABASE_URL: 'postgresql://u:p@h/db',
      OPENAI_API_KEY: 'sk-openai',
      ANTHROPIC_API_KEY: 'sk-ant',
      CAPTURE_WEBHOOK_SECRET: 'hmac',
      CAPTURE_JWT_SECRET: 'jwt',
      MCP_CLIENT_SECRET: 'mcp',
    },
  };
}

describe('wranglerStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('defines the three workers with their required secrets', () => {
    const dirs = WORKERS.map((w) => w.dir);
    expect(dirs).toEqual(['workers/capture', 'workers/retry', 'workers/mcp']);
    const capture = WORKERS[0];
    expect(capture.secrets).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'CAPTURE_JWT_SECRET', 'CAPTURE_WEBHOOK_SECRET', 'OPENAI_API_KEY'])
    );
    const mcp = WORKERS[2];
    expect(mcp.secrets).toEqual(expect.arrayContaining(['MCP_CLIENT_SECRET', 'CAPTURE_JWT_SECRET']));
    expect(mcp.secrets).not.toContain('CAPTURE_WEBHOOK_SECRET');
  });

  it('isComplete only when all three workers are recorded deployed', async () => {
    const state = makeState();
    expect(await wranglerStep.isComplete(state, fullEnv())).toBe(false);
    state.workersDeployed = WORKERS.map((w) => w.name);
    expect(await wranglerStep.isComplete(state, fullEnv())).toBe(true);
  });

  it('fails with a login hint when wrangler is not authenticated', async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('Not logged in');
    });

    const result = await wranglerStep.run(makeState(), fullEnv());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toMatch(/wrangler login/);
    }
  });

  it('deploys each worker and uploads only secrets that have values', async () => {
    const env = fullEnv();
    delete env.values['ANTHROPIC_API_KEY'];
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (String(cmd).includes('whoami')) return Buffer.from('user@example.com');
      if (String(cmd).includes('deploy')) {
        return Buffer.from('Deployed open-brain-capture\n  https://open-brain-capture.acct.workers.dev');
      }
      return Buffer.from('');
    });

    const state = makeState();
    const result = await wranglerStep.run(state, env);

    expect(result.status).toBe('done');
    expect(state.workersDeployed).toEqual(WORKERS.map((w) => w.name));

    const calls = vi.mocked(execSync).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((c) => c.includes('wrangler deploy'))).toHaveLength(3);
    expect(calls.some((c) => c.includes('secret put ANTHROPIC_API_KEY'))).toBe(false);
    expect(calls.some((c) => c.includes('secret put DATABASE_URL'))).toBe(true);

    const secretCalls = vi.mocked(execSync).mock.calls.filter((c) => String(c[0]).includes('secret put'));
    for (const call of secretCalls) {
      const opts = call[1] as { input?: string };
      expect(opts.input).toBeTruthy();
      expect(String(call[0])).not.toContain(opts.input as string);
    }
  });

  it('records worker URLs from deploy output into env values', async () => {
    const env = fullEnv();
    vi.mocked(execSync).mockImplementation((cmd: string, opts?: unknown) => {
      if (String(cmd).includes('whoami')) return Buffer.from('user@example.com');
      if (String(cmd).includes('deploy')) {
        const cwd = (opts as { cwd?: string })?.cwd ?? '';
        const name = cwd.includes('capture')
          ? 'open-brain-capture'
          : cwd.includes('retry')
            ? 'open-brain-retry-worker'
            : 'open-brain-mcp';
        return Buffer.from(`https://${name}.acct.workers.dev`);
      }
      return Buffer.from('');
    });

    const result = await wranglerStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(env.values['CAPTURE_WORKER_URL']).toBe('https://open-brain-capture.acct.workers.dev');
    expect(env.values['MCP_WORKER_URL']).toBe('https://open-brain-mcp.acct.workers.dev');
    expect(env.values['RETRY_WORKER_URL']).toBeUndefined();
  });

  it('fails retriable when a deploy fails, keeping earlier successes', async () => {
    const state = makeState();
    vi.mocked(execSync).mockImplementation((cmd: string, opts?: unknown) => {
      if (String(cmd).includes('whoami')) return Buffer.from('user@example.com');
      if (String(cmd).includes('deploy')) {
        const cwd = (opts as { cwd?: string })?.cwd ?? '';
        if (cwd.includes('retry')) throw new Error('bundle failed');
        return Buffer.from('https://x.workers.dev');
      }
      return Buffer.from('');
    });

    const result = await wranglerStep.run(state, fullEnv());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.retriable).toBe(true);
    }
    expect(state.workersDeployed).toContain('open-brain-capture');
    expect(state.workersDeployed).not.toContain('open-brain-retry-worker');
  });
});

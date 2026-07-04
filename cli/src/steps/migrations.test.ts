import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
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

import { execSync, execFileSync } from 'node:child_process';
import { migrationsStep } from './migrations.js';

function makeState(completed: number[] = []): SetupState {
  return {
    version: 2,
    completedSteps: completed,
    lastRunAt: '',
    migrationsApplied: [],
    workersDeployed: [],
    claudeDesktopConfigured: false,
  };
}

function makeEnv(values: Record<string, string> = {}): EnvFile {
  return { values, filePath: '/tmp/.env' };
}

const POOLED = 'postgresql://user:pw@ep-x-pooler.eu-west-2.aws.neon.tech/neondb';
const DIRECT = 'postgresql://user:pw@ep-x.eu-west-2.aws.neon.tech/neondb';

describe('migrationsStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails without DATABASE_URL', async () => {
    const result = await migrationsStep.run(makeState(), makeEnv());
    expect(result.status).toBe('failed');
  });

  it('isComplete only when step 6 is recorded', async () => {
    expect(await migrationsStep.isComplete(makeState(), makeEnv())).toBe(false);
    expect(await migrationsStep.isComplete(makeState([6]), makeEnv())).toBe(true);
  });

  it('skips when previously applied and the user declines a re-run', async () => {
    const { confirm } = await import('../ui.js');
    vi.mocked(confirm).mockResolvedValueOnce(false);

    const result = await migrationsStep.run(makeState([6]), makeEnv({ DATABASE_URL: DIRECT }));

    expect(result.status).toBe('skipped');
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it('fails with a libpq hint when psql is unavailable', async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('psql: command not found');
    });
    const result = await migrationsStep.run(makeState(), makeEnv({ DATABASE_URL: DIRECT }));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toMatch(/psql/);
    }
  });

  it('runs scripts/migrate.sh against the DIRECT endpoint (pooler stripped)', async () => {
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from('psql 18.0'));
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from('migrations: 5 applied, 0 already applied'));

    const result = await migrationsStep.run(makeState(), makeEnv({ DATABASE_URL: POOLED }));

    expect(result.status).toBe('done');
    const call = vi.mocked(execFileSync).mock.calls[0];
    expect(call[0]).toBe('bash');
    expect(call[1]).toEqual(['scripts/migrate.sh']);
    const opts = call[2] as { env: Record<string, string> };
    expect(opts.env['DATABASE_URL']).toBe(DIRECT);
  });

  it('returns retriable failure when the runner exits non-zero', async () => {
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from('psql 18.0'));
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('ERROR: relation already exists');
    });

    const result = await migrationsStep.run(makeState(), makeEnv({ DATABASE_URL: DIRECT }));

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.retriable).toBe(true);
    }
  });
});

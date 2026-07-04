import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock('../validate.js', () => ({
  validateNeon: vi.fn(),
}));

import * as ui from '../ui.js';
import { validateNeon } from '../validate.js';
import { neonStep } from './neon.js';

const CANCEL = Symbol('cancel');

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

function makeEnv(values: Record<string, string> = {}): EnvFile {
  return { values, filePath: '/tmp/.env' };
}

describe('neonStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is step 1 with a Neon name', () => {
    expect(neonStep.number).toBe(1);
    expect(neonStep.name).toMatch(/Neon/);
  });

  it('isComplete is true when DATABASE_URL is set', async () => {
    expect(await neonStep.isComplete(makeState(), makeEnv({ DATABASE_URL: 'postgresql://x' }))).toBe(true);
    expect(await neonStep.isComplete(makeState(), makeEnv())).toBe(false);
  });

  it('stores DATABASE_URL after successful validation', async () => {
    const env = makeEnv();
    vi.mocked(ui.password).mockResolvedValueOnce('postgresql://user:pw@ep-x.neon.tech/neondb');
    vi.mocked(validateNeon).mockResolvedValueOnce({ ok: true });

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(env.values['DATABASE_URL']).toBe('postgresql://user:pw@ep-x.neon.tech/neondb');
  });

  it('retries on validation failure then succeeds', async () => {
    const env = makeEnv();
    vi.mocked(ui.password)
      .mockResolvedValueOnce('postgresql://bad')
      .mockResolvedValueOnce('postgresql://good');
    vi.mocked(validateNeon)
      .mockResolvedValueOnce({ ok: false, error: 'auth failed' })
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(ui.confirm).mockResolvedValueOnce(true);

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(env.values['DATABASE_URL']).toBe('postgresql://good');
  });

  it('fails after exhausting attempts', async () => {
    const env = makeEnv();
    vi.mocked(ui.password).mockResolvedValue('postgresql://bad');
    vi.mocked(validateNeon).mockResolvedValue({ ok: false, error: 'auth failed' });
    vi.mocked(ui.confirm).mockResolvedValue(true);

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('failed');
  });

  it('skips when the user cancels the prompt', async () => {
    const env = makeEnv();
    vi.mocked(ui.password).mockResolvedValueOnce(CANCEL);

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('skipped');
  });

  it('rejects malformed connection strings via the prompt validator', async () => {
    const env = makeEnv();
    vi.mocked(ui.password).mockResolvedValueOnce('postgresql://ok');
    vi.mocked(validateNeon).mockResolvedValueOnce({ ok: true });

    await neonStep.run(makeState(), env);

    const opts = vi.mocked(ui.password).mock.calls[0][0] as {
      validate: (v: string | undefined) => string | undefined;
    };
    expect(opts.validate('mysql://nope')).toMatch(/postgresql/);
    expect(opts.validate(undefined)).toMatch(/postgresql/);
    expect(opts.validate('postgresql://u:p@h/db')).toBeUndefined();
  });

  it('fails when the user declines to retry after a failure', async () => {
    const env = makeEnv();
    vi.mocked(ui.password).mockResolvedValueOnce('postgresql://bad');
    vi.mocked(validateNeon).mockResolvedValueOnce({ ok: false, error: 'auth failed' });
    vi.mocked(ui.confirm).mockResolvedValueOnce(false);

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('failed');
  });

  it('offers reconfigure when already set and skips on decline', async () => {
    const env = makeEnv({ DATABASE_URL: 'postgresql://existing' });
    vi.mocked(ui.confirm).mockResolvedValueOnce(false);

    const result = await neonStep.run(makeState(), env);

    expect(result.status).toBe('skipped');
    expect(env.values['DATABASE_URL']).toBe('postgresql://existing');
  });
});

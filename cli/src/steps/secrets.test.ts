import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
}));

import { secretsStep } from './secrets.js';
import * as ui from '../ui.js';

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
  return { filePath: '/tmp/does-not-exist/.env', values };
}

beforeEach(() => {
  vi.mocked(ui.confirm).mockReset();
  vi.mocked(ui.info).mockReset();
  vi.mocked(ui.warn).mockReset();
});

describe('secretsStep', () => {
  it('is incomplete when the webhook secret is absent', async () => {
    expect(await secretsStep.isComplete(makeState(), makeEnv())).toBe(false);
  });

  it('is complete once the webhook secret is present', async () => {
    const env = makeEnv({ CAPTURE_WEBHOOK_SECRET: 'abc' });
    expect(await secretsStep.isComplete(makeState(), env)).toBe(true);
  });

  it('generates a 256-bit hex webhook secret', async () => {
    const env = makeEnv();
    const result = await secretsStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(env.values['CAPTURE_WEBHOOK_SECRET']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a different secret on each run', async () => {
    const first = makeEnv();
    const second = makeEnv();
    await secretsStep.run(makeState(), first);
    await secretsStep.run(makeState(), second);

    expect(first.values['CAPTURE_WEBHOOK_SECRET']).not.toBe(
      second.values['CAPTURE_WEBHOOK_SECRET'],
    );
  });

  it('never generates the retired JWT secret', async () => {
    const env = makeEnv();
    await secretsStep.run(makeState(), env);

    expect(Object.keys(env.values)).toEqual(['CAPTURE_WEBHOOK_SECRET']);
  });

  it('keeps the existing secret when the operator declines to regenerate', async () => {
    vi.mocked(ui.confirm).mockResolvedValue(false);
    const env = makeEnv({ CAPTURE_WEBHOOK_SECRET: 'existing-secret' });

    const result = await secretsStep.run(makeState(), env);

    expect(result).toEqual({ status: 'skipped', reason: 'Secrets already exist' });
    expect(env.values['CAPTURE_WEBHOOK_SECRET']).toBe('existing-secret');
    expect(ui.warn).toHaveBeenCalled();
  });

  it('replaces the existing secret when the operator confirms', async () => {
    vi.mocked(ui.confirm).mockResolvedValue(true);
    const env = makeEnv({ CAPTURE_WEBHOOK_SECRET: 'existing-secret' });

    const result = await secretsStep.run(makeState(), env);

    expect(result.status).toBe('done');
    expect(env.values['CAPTURE_WEBHOOK_SECRET']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves the existing secret alone when the prompt is cancelled', async () => {
    vi.mocked(ui.confirm).mockResolvedValue(Symbol('cancel') as unknown as boolean);
    const env = makeEnv({ CAPTURE_WEBHOOK_SECRET: 'existing-secret' });

    const result = await secretsStep.run(makeState(), env);

    expect(result).toEqual({ status: 'skipped', reason: 'Cancelled' });
    expect(env.values['CAPTURE_WEBHOOK_SECRET']).toBe('existing-secret');
  });
});

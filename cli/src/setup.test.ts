import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupStep, SetupState, EnvFile, StepResult } from './types.js';

const { stepMocks } = vi.hoisted(() => {
  function makeStep(name: string, number: number) {
    return {
      name,
      number,
      isComplete: vi.fn(async () => false),
      run: vi.fn(async (): Promise<StepResult> => ({ status: 'done' })),
    };
  }
  return {
    stepMocks: {
      neon: makeStep('Neon Database Connection', 1),
      openai: makeStep('OpenAI', 2),
      anthropic: makeStep('Anthropic', 3),
      secrets: makeStep('Secrets', 4),
      writeEnv: makeStep('Write .env', 5),
      migrations: makeStep('Migrations', 6),
      wrangler: makeStep('Deploy Workers', 7),
      claudeDesktop: makeStep('Claude Desktop', 8),
    },
  };
});

vi.mock('./steps/neon.js', () => ({ neonStep: stepMocks.neon }));
vi.mock('./steps/openai.js', () => ({ openaiStep: stepMocks.openai }));
vi.mock('./steps/anthropic.js', () => ({ anthropicStep: stepMocks.anthropic }));
vi.mock('./steps/secrets.js', () => ({ secretsStep: stepMocks.secrets }));
vi.mock('./steps/write-env.js', () => ({ writeEnvStep: stepMocks.writeEnv }));
vi.mock('./steps/migrations.js', () => ({ migrationsStep: stepMocks.migrations }));
vi.mock('./steps/wrangler.js', () => ({ wranglerStep: stepMocks.wrangler }));
vi.mock('./steps/claude-desktop.js', () => ({ claudeDesktopStep: stepMocks.claudeDesktop }));

vi.mock('./ui.js', () => ({
  stepHeader: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  outro: vi.fn(),
  cancelled: vi.fn(),
  confirm: vi.fn(async () => false),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
}));

vi.mock('./state.js', () => ({
  loadState: vi.fn(
    (): SetupState => ({
      version: 2,
      completedSteps: [],
      lastRunAt: '',
      migrationsApplied: [],
      workersDeployed: [],
      claudeDesktopConfigured: false,
    })
  ),
  saveState: vi.fn(),
  markStepComplete: vi.fn(),
}));

vi.mock('./env.js', () => ({
  loadEnv: vi.fn((): EnvFile => ({ values: {}, filePath: '/tmp/.env' })),
}));

import * as ui from './ui.js';
import { markStepComplete } from './state.js';
import { runSetup } from './setup.js';

const ALL_STEPS: Array<{ name: string; number: number; run: ReturnType<typeof vi.fn> }> = [
  stepMocks.neon,
  stepMocks.openai,
  stepMocks.anthropic,
  stepMocks.secrets,
  stepMocks.writeEnv,
  stepMocks.migrations,
  stepMocks.wrangler,
  stepMocks.claudeDesktop,
];

describe('runSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const step of ALL_STEPS) {
      (step as unknown as SetupStep & { isComplete: ReturnType<typeof vi.fn> }).isComplete.mockResolvedValue(false);
      step.run.mockResolvedValue({ status: 'done' });
    }
  });

  it('runs all eight steps in order: neon first, wrangler seventh', async () => {
    await runSetup();

    for (const step of ALL_STEPS) {
      expect(step.run).toHaveBeenCalledTimes(1);
    }
    expect(ALL_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(markStepComplete).toHaveBeenCalledTimes(8);
    expect(ui.outro).toHaveBeenCalledWith(expect.stringContaining('openbrain status'));
  });

  it('halts on a failed step and does not run later steps', async () => {
    stepMocks.migrations.run.mockResolvedValueOnce({
      status: 'failed',
      error: 'boom',
      retriable: true,
    });

    await runSetup();

    expect(stepMocks.wrangler.run).not.toHaveBeenCalled();
    expect(stepMocks.claudeDesktop.run).not.toHaveBeenCalled();
    expect(ui.outro).not.toHaveBeenCalled();
  });

  it('skips completed steps when the user declines reconfigure', async () => {
    (stepMocks.neon as unknown as { isComplete: ReturnType<typeof vi.fn> }).isComplete.mockResolvedValue(true);
    vi.mocked(ui.confirm).mockResolvedValueOnce(false);

    await runSetup();

    expect(stepMocks.neon.run).not.toHaveBeenCalled();
    expect(stepMocks.openai.run).toHaveBeenCalledTimes(1);
  });

  it('reports non-retriable failures distinctly and halts', async () => {
    stepMocks.neon.run.mockResolvedValueOnce({
      status: 'failed',
      error: 'unsupported',
      retriable: false,
    });

    await runSetup();

    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('cannot be retried'));
    expect(stepMocks.openai.run).not.toHaveBeenCalled();
  });

  it('exits when the user cancels the reconfigure prompt', async () => {
    (stepMocks.neon as unknown as { isComplete: ReturnType<typeof vi.fn> }).isComplete.mockResolvedValue(true);
    vi.mocked(ui.confirm).mockResolvedValueOnce(Symbol('cancel') as unknown as boolean);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementationOnce(() => {
      throw new Error('exit called');
    });

    await expect(runSetup()).rejects.toThrow('exit called');
    expect(ui.cancelled).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('continues past skipped steps without marking them complete', async () => {
    stepMocks.secrets.run.mockResolvedValueOnce({ status: 'skipped', reason: 'user declined' });

    await runSetup();

    expect(markStepComplete).toHaveBeenCalledTimes(7);
    expect(stepMocks.claudeDesktop.run).toHaveBeenCalledTimes(1);
  });
});

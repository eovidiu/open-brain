import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupState, EnvFile } from '../types.js';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn((v: unknown) => typeof v === 'symbol'),
}));

import fs from 'node:fs';
import * as ui from '../ui.js';
import { claudeDesktopStep } from './claude-desktop.js';

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

function makeEnv(): EnvFile {
  return {
    filePath: '/tmp/.env',
    values: {
      DATABASE_URL: 'postgresql://u:p@h/db',
      OPENAI_API_KEY: 'sk-o',
      ANTHROPIC_API_KEY: 'sk-a',
    },
  };
}

describe('claudeDesktopStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a stdio server entry with DATABASE_URL and no SUPABASE keys', async () => {
    vi.mocked(ui.confirm).mockResolvedValueOnce(true);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const state = makeState();
    const result = await claudeDesktopStep.run(state, makeEnv());

    expect(result.status).toBe('done');
    expect(state.claudeDesktopConfigured).toBe(true);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0];
    const config = JSON.parse(written[1] as string);
    const entry = config.mcpServers['open-brain'];
    expect(entry.env.DATABASE_URL).toBe('postgresql://u:p@h/db');
    expect(entry.env.EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(JSON.stringify(entry.env)).not.toContain('SUPABASE');
    expect(entry.args).toContain('--stdio');
  });

  it('merges into an existing config without clobbering other servers', async () => {
    vi.mocked(ui.confirm).mockResolvedValueOnce(true);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ mcpServers: { other: { command: 'x' } } })
    );

    const result = await claudeDesktopStep.run(makeState(), makeEnv());

    expect(result.status).toBe('done');
    const written = vi.mocked(fs.writeFileSync).mock.calls[0];
    const config = JSON.parse(written[1] as string);
    expect(config.mcpServers.other).toEqual({ command: 'x' });
    expect(config.mcpServers['open-brain']).toBeDefined();
  });

  it('skips when the user declines', async () => {
    vi.mocked(ui.confirm).mockResolvedValueOnce(false);
    const result = await claudeDesktopStep.run(makeState(), makeEnv());
    expect(result.status).toBe('skipped');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('fails retriable when the config cannot be written', async () => {
    vi.mocked(ui.confirm).mockResolvedValueOnce(true);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error('EACCES');
    });

    const result = await claudeDesktopStep.run(makeState(), makeEnv());

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.retriable).toBe(true);
    }
  });

  it('fails non-retriable on an unsupported platform', async () => {
    vi.mocked(ui.confirm).mockResolvedValueOnce(true);
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    try {
      const result = await claudeDesktopStep.run(makeState(), makeEnv());
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.retriable).toBe(false);
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });

  it('resolves the config path on win32 and linux', async () => {
    const original = process.platform;
    for (const platform of ['win32', 'linux'] as const) {
      vi.clearAllMocks();
      vi.mocked(ui.confirm).mockResolvedValueOnce(true);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      Object.defineProperty(process, 'platform', { value: platform });
      if (platform === 'win32') process.env['APPDATA'] = 'C:\\Users\\x\\AppData\\Roaming';
      try {
        const result = await claudeDesktopStep.run(makeState(), makeEnv());
        expect(result.status).toBe('done');
        expect(fs.writeFileSync).toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    }
  });

  it('isComplete reflects state', async () => {
    const state = makeState();
    expect(await claudeDesktopStep.isComplete(state, makeEnv())).toBe(false);
    state.claudeDesktopConfigured = true;
    expect(await claudeDesktopStep.isComplete(state, makeEnv())).toBe(true);
  });
});

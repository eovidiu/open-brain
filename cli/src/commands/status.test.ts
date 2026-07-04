import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvFile } from '../types.js';

const { mockSql, mockNeon } = vi.hoisted(() => {
  const mockSql = vi.fn();
  return { mockSql, mockNeon: vi.fn(() => mockSql) };
});

vi.mock('@neondatabase/serverless', () => ({ neon: mockNeon }));

vi.mock('../ui.js', () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../env.js')>();
  return { ...actual, loadEnv: vi.fn() };
});

import * as ui from '../ui.js';
import { loadEnv } from '../env.js';
import { runStatus } from './status.js';

const FULL_VALUES: Record<string, string> = {
  DATABASE_URL: 'postgresql://u:p@h/db',
  OPENAI_API_KEY: 'sk-o',
  ANTHROPIC_API_KEY: 'sk-a',
  CAPTURE_WEBHOOK_SECRET: 'hmac',
  CAPTURE_JWT_SECRET: 'jwt',
  MCP_CLIENT_SECRET: 'mcp',
};

function envWith(values: Record<string, string>): EnvFile {
  return { values, filePath: '/tmp/.env' };
}

describe('runStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports missing env vars and stops', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith({}));

    await runStatus();

    expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL'));
    expect(mockNeon).not.toHaveBeenCalled();
  });

  it('reports Neon connectivity and memory count', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith(FULL_VALUES));
    mockSql.mockResolvedValueOnce([{ count: '42' }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await runStatus();

    expect(ui.success).toHaveBeenCalledWith(expect.stringMatching(/Neon: connected/));
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('42'));
  });

  it('reports Neon failure without leaking credentials', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith(FULL_VALUES));
    mockSql.mockRejectedValueOnce(new Error('connect failed for postgresql://u:p@h/db'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await runStatus();

    const errorText = vi.mocked(ui.error).mock.calls.map((c) => c[0]).join('\n');
    expect(errorText).toMatch(/Neon/);
    expect(errorText).not.toContain(':p@');
  });

  it('checks worker health when URLs are configured', async () => {
    vi.mocked(loadEnv).mockReturnValue(
      envWith({
        ...FULL_VALUES,
        CAPTURE_WORKER_URL: 'https://cap.workers.dev',
        MCP_WORKER_URL: 'https://mcp.workers.dev',
      })
    );
    mockSql.mockResolvedValueOnce([{ count: '0' }]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await runStatus();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('https://cap.workers.dev'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://mcp.workers.dev/health'))).toBe(true);
  });

  it('warns on non-ok worker responses and unreachable workers', async () => {
    vi.mocked(loadEnv).mockReturnValue(
      envWith({
        ...FULL_VALUES,
        CAPTURE_WORKER_URL: 'https://cap.workers.dev',
        MCP_WORKER_URL: 'https://mcp.workers.dev',
      })
    );
    mockSql.mockResolvedValueOnce([{ count: '0' }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
      .mockRejectedValueOnce(new Error('ENOTFOUND'));
    vi.stubGlobal('fetch', fetchMock);

    await runStatus();

    const warnText = vi.mocked(ui.warn).mock.calls.map((c) => c[0]).join('\n');
    expect(warnText).toContain('500');
    expect(warnText).toMatch(/not reachable/);
  });

  it('notes unconfigured workers without failing', async () => {
    vi.mocked(loadEnv).mockReturnValue(envWith(FULL_VALUES));
    mockSql.mockResolvedValueOnce([{ count: '0' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await runStatus();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ui.warn).toHaveBeenCalledWith(expect.stringMatching(/not deployed|not configured/i));
  });
});

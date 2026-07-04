import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, saveEnv, hasEnvVar, maskSecret } from './env.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbrain-env-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('saveEnv', () => {
  it('writes DATABASE_URL and no SUPABASE_* keys', () => {
    const env = loadEnv(tmpDir);
    env.values['DATABASE_URL'] = 'postgresql://u:p@h/db';
    env.values['OPENAI_API_KEY'] = 'sk-x';
    saveEnv(env);

    const content = fs.readFileSync(env.filePath, 'utf-8');
    expect(content).toContain('DATABASE_URL=postgresql://u:p@h/db');
    expect(content).not.toContain('SUPABASE');
  });

  it('persists worker URLs when present and omits the lines when absent', () => {
    const env = loadEnv(tmpDir);
    env.values['CAPTURE_WORKER_URL'] = 'https://cap.workers.dev';
    saveEnv(env);
    let reloaded = loadEnv(tmpDir);
    expect(reloaded.values['CAPTURE_WORKER_URL']).toBe('https://cap.workers.dev');
    expect(reloaded.values['MCP_WORKER_URL']).toBeUndefined();
  });

  it('round-trips all setup keys and sets 0600 permissions', () => {
    const env = loadEnv(tmpDir);
    const keys = {
      DATABASE_URL: 'postgresql://u:p@h/db',
      OPENAI_API_KEY: 'sk-o',
      ANTHROPIC_API_KEY: 'sk-a',
      CAPTURE_WEBHOOK_SECRET: 'hmac',
      CAPTURE_JWT_SECRET: 'jwt',
      MCP_CLIENT_SECRET: 'mcp',
      EMBEDDING_MODEL: 'text-embedding-3-small',
    };
    Object.assign(env.values, keys);
    saveEnv(env);

    const reloaded = loadEnv(tmpDir);
    for (const [k, v] of Object.entries(keys)) {
      expect(reloaded.values[k]).toBe(v);
    }
    const mode = fs.statSync(env.filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('loadEnv', () => {
  it('parses quoted values and skips comments', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), '# comment\nA="quoted"\nB=plain\n');
    const env = loadEnv(tmpDir);
    expect(env.values['A']).toBe('quoted');
    expect(env.values['B']).toBe('plain');
  });
});

describe('helpers', () => {
  it('hasEnvVar is false for empty values', () => {
    const env = loadEnv(tmpDir);
    env.values['X'] = '';
    expect(hasEnvVar(env, 'X')).toBe(false);
  });

  it('maskSecret keeps only the last 4 characters', () => {
    expect(maskSecret('abcdefgh')).toMatch(/\*+efgh$/);
    expect(maskSecret('ab')).toBe('****');
  });
});

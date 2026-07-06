import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../ui.js';
import { loadEnv, saveEnv } from '../env.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CAPTURE_WEBHOOK_SECRET',
  'CAPTURE_JWT_SECRET',
  'MCP_CLIENT_SECRET',
];

export const writeEnvStep: SetupStep = {
  name: 'Write .env',
  number: 5,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    if (!fs.existsSync(env.filePath)) return false;
    // Judge completeness by what is IN THE FILE, not by values collected in
    // memory during this run — otherwise a stale .env plus a freshly pasted
    // value reports "already complete" and the write is silently skipped.
    const onDisk = loadEnv(path.dirname(env.filePath));
    return REQUIRED_KEYS.every((key) => !!onDisk.values[key]);
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    const missing = REQUIRED_KEYS.filter((key) => !env.values[key]);
    if (missing.length > 0) {
      ui.error(`Missing values: ${missing.join(', ')}. Complete earlier steps first.`);
      return { status: 'failed', error: `Missing env vars: ${missing.join(', ')}`, retriable: false };
    }

    if (fs.existsSync(env.filePath)) {
      ui.warn(`.env already exists at ${env.filePath}`);
      const overwrite = await ui.confirm({
        message: 'Overwrite it with the values collected in this run?',
        initialValue: false,
      });
      if (ui.isCancel(overwrite) || !overwrite) {
        ui.info('Kept the existing .env untouched.');
        return {
          status: 'failed',
          error: 'Existing .env kept — accept the overwrite or remove the file, then re-run setup',
          retriable: true,
        };
      }
    }

    // Set default embedding model if not already set
    if (!env.values['EMBEDDING_MODEL']) {
      env.values['EMBEDDING_MODEL'] = 'text-embedding-3-small';
    }

    saveEnv(env);
    ui.success(`Wrote ${REQUIRED_KEYS.length} values to .env (permissions: 0600)`);

    // Verify .gitignore includes .env
    const gitignorePath = env.filePath.replace('.env', '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.env')) {
        ui.warn('.env is not in .gitignore — add it to prevent committing secrets');
      }
    }

    return { status: 'done' };
  },
};

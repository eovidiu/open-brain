import fs from 'node:fs';
import * as ui from '../ui.js';
import { saveEnv } from '../env.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const REQUIRED_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
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
    return REQUIRED_KEYS.every((key) => !!env.values[key]);
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    const missing = REQUIRED_KEYS.filter((key) => !env.values[key]);
    if (missing.length > 0) {
      ui.error(`Missing values: ${missing.join(', ')}. Complete earlier steps first.`);
      return { status: 'failed', error: `Missing env vars: ${missing.join(', ')}`, retriable: false };
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

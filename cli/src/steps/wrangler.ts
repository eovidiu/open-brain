import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as ui from '../ui.js';
import { repoRoot } from '../paths.js';
import { saveEnv } from '../env.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

interface WorkerSpec {
  dir: string;
  name: string;
  secrets: string[];
  urlEnvKey?: string;
}

// Secret lists mirror each worker's src/env.ts (or src/types.ts) Env interface.
export const WORKERS: WorkerSpec[] = [
  {
    dir: 'workers/capture',
    name: 'open-brain-capture',
    secrets: [
      'DATABASE_URL',
      'CAPTURE_JWT_SECRET',
      'CAPTURE_WEBHOOK_SECRET',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_METADATA_API_KEY',
      'METADATA_LLM_PROVIDER',
    ],
    urlEnvKey: 'CAPTURE_WORKER_URL',
  },
  {
    dir: 'workers/retry',
    name: 'open-brain-retry-worker',
    secrets: [
      'DATABASE_URL',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_METADATA_API_KEY',
      'METADATA_LLM_PROVIDER',
    ],
  },
  {
    dir: 'workers/mcp',
    name: 'open-brain-mcp',
    secrets: [
      'DATABASE_URL',
      'MCP_CLIENT_SECRET',
      'CAPTURE_JWT_SECRET',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_METADATA_API_KEY',
      'METADATA_LLM_PROVIDER',
      'EMBEDDING_MODEL',
    ],
    urlEnvKey: 'MCP_WORKER_URL',
  },
];

const WORKERS_DEV_URL = /https:\/\/[a-z0-9.-]+\.workers\.dev/;

export const wranglerStep: SetupStep = {
  name: 'Deploy Cloudflare Workers',
  number: 7,

  async isComplete(state: SetupState, _env: EnvFile): Promise<boolean> {
    return WORKERS.every((w) => state.workersDeployed.includes(w.name));
  },

  async run(state: SetupState, env: EnvFile): Promise<StepResult> {
    if (!isWranglerAuthenticated()) {
      ui.error('wrangler is not authenticated. Run: npx wrangler login');
      return { status: 'failed', error: 'Not authenticated — run: npx wrangler login', retriable: true };
    }

    for (const worker of WORKERS) {
      if (state.workersDeployed.includes(worker.name)) {
        ui.info(`${worker.name}: already deployed, skipping`);
        continue;
      }

      const workerDir = path.join(repoRoot(), worker.dir);
      const s = ui.spinner();
      try {
        ensureDependencies(workerDir);

        s.start(`Deploying ${worker.name}...`);
        const output = execSync('npx wrangler deploy', {
          cwd: workerDir,
          stdio: 'pipe',
          timeout: 180000,
        }).toString();
        s.stop(`${worker.name} deployed`);

        const url = output.match(WORKERS_DEV_URL)?.[0];
        if (worker.urlEnvKey && url) {
          env.values[worker.urlEnvKey] = url;
          ui.info(`${worker.name}: ${url}`);
        }

        uploadSecrets(worker, env);
        state.workersDeployed.push(worker.name);
      } catch (err) {
        s.stop(`${worker.name} failed`);
        const message = err instanceof Error ? err.message : String(err);
        ui.error(`Deploy error for ${worker.name}: ${message}`);
        return { status: 'failed', error: message, retriable: true };
      }
    }

    saveEnv(env);
    return { status: 'done' };
  },
};

function isWranglerAuthenticated(): boolean {
  try {
    execSync('npx wrangler whoami', { stdio: 'pipe', timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

function ensureDependencies(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    execSync('npm ci', { cwd: dir, stdio: 'pipe', timeout: 180000 });
  }
}

function uploadSecrets(worker: WorkerSpec, env: EnvFile): void {
  const workerDir = path.join(repoRoot(), worker.dir);
  for (const key of worker.secrets) {
    const value = env.values[key];
    if (!value) continue;
    execSync(`npx wrangler secret put ${key}`, {
      cwd: workerDir,
      stdio: 'pipe',
      timeout: 60000,
      input: value,
    });
  }
}

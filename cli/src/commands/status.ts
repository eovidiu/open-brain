import { neon } from '@neondatabase/serverless';
import * as ui from '../ui.js';
import { loadEnv, hasEnvVar } from '../env.js';
import { repoRoot } from '../paths.js';

const REQUIRED_VARS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CAPTURE_WEBHOOK_SECRET',
  'CAPTURE_JWT_SECRET',
  'MCP_CLIENT_SECRET',
];

export async function runStatus(): Promise<void> {
  const env = loadEnv(repoRoot());

  ui.info('Checking Open Brain status...\n');

  const missingVars = REQUIRED_VARS.filter((v) => !hasEnvVar(env, v));
  if (missingVars.length > 0) {
    ui.error(`.env missing: ${missingVars.join(', ')}`);
    ui.info('Run "openbrain setup" to configure.');
    return;
  }
  ui.success('.env: all required variables present');

  await checkNeon(env.values['DATABASE_URL']!);
  await checkWorker('capture Worker', env.values['CAPTURE_WORKER_URL'], '');
  await checkWorker('MCP Worker', env.values['MCP_WORKER_URL'], '/health');
}

async function checkNeon(url: string): Promise<void> {
  try {
    const sql = neon(url);
    const rows = await sql`SELECT count(*)::text AS count FROM memories`;
    ui.success('Neon: connected');
    ui.info(`Memories stored: ${rows[0]?.['count'] ?? 0}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ui.error(`Neon connection: ${redactDatabaseUrl(message)}`);
  }
}

async function checkWorker(label: string, baseUrl: string | undefined, healthPath: string): Promise<void> {
  if (!baseUrl) {
    ui.warn(`${label}: not deployed yet (no URL in .env — run setup step 7)`);
    return;
  }
  try {
    const response = await fetch(`${baseUrl}${healthPath}`, {
      method: healthPath ? 'GET' : 'OPTIONS',
    });
    if (response.ok || response.status === 204) {
      ui.success(`${label}: reachable at ${baseUrl}`);
    } else {
      ui.warn(`${label}: ${response.status} from ${baseUrl}`);
    }
  } catch {
    ui.warn(`${label}: not reachable at ${baseUrl}`);
  }
}

function redactDatabaseUrl(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:/\s]+):[^@\s]+@/g, '$1:***REDACTED***@');
}

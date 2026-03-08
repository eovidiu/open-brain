import { createClient } from '@supabase/supabase-js';
import * as ui from '../ui.js';
import { loadEnv, hasEnvVar } from '../env.js';

export async function runStatus(): Promise<void> {
  const env = loadEnv(process.cwd());

  ui.info('Checking Open Brain status...\n');

  // Check .env
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CAPTURE_WEBHOOK_SECRET',
    'CAPTURE_JWT_SECRET',
    'MCP_CLIENT_SECRET',
  ];

  const missingVars = requiredVars.filter((v) => !hasEnvVar(env, v));
  if (missingVars.length > 0) {
    ui.error(`.env missing: ${missingVars.join(', ')}`);
    ui.info('Run "openbrain setup" to configure.');
    return;
  }
  ui.success('.env: all required variables present');

  // Test Supabase connection
  const supabaseUrl = env.values['SUPABASE_URL']!;
  const supabaseKey = env.values['SUPABASE_SERVICE_ROLE_KEY']!;

  try {
    const client = createClient(supabaseUrl, supabaseKey);

    // Check connection
    const { error: connError } = await client.from('memories').select('id', { count: 'exact', head: true });
    if (connError) {
      ui.error(`Supabase connection: ${connError.message}`);
    } else {
      ui.success(`Supabase: connected to ${supabaseUrl}`);
    }

    // Count memories
    const { count, error: countError } = await client
      .from('memories')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      ui.warn(`Could not count memories: ${countError.message}`);
    } else {
      ui.info(`Memories stored: ${count ?? 0}`);
    }
  } catch (err) {
    ui.error(`Supabase error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check edge function health
  try {
    const captureUrl = `${supabaseUrl}/functions/v1/capture`;
    const response = await fetch(captureUrl, { method: 'OPTIONS' });
    if (response.ok || response.status === 204) {
      ui.success('Edge function (capture): reachable');
    } else {
      ui.warn(`Edge function (capture): ${response.status} ${response.statusText}`);
    }
  } catch {
    ui.warn('Edge function (capture): not reachable');
  }
}

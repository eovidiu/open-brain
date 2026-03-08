import { execSync } from 'node:child_process';
import * as ui from '../ui.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const FUNCTIONS_TO_DEPLOY = ['capture', 'retry-worker'] as const;

export const edgeFunctionsStep: SetupStep = {
  name: 'Deploy Edge Functions',
  number: 7,

  async isComplete(state: SetupState, _env: EnvFile): Promise<boolean> {
    return FUNCTIONS_TO_DEPLOY.every((fn) => state.edgeFunctionsDeployed.includes(fn));
  },

  async run(state: SetupState, env: EnvFile): Promise<StepResult> {
    if (!isSupabaseCLIAvailable()) {
      ui.error('Supabase CLI not found. Install it: https://supabase.com/docs/guides/cli');
      return { status: 'failed', error: 'Supabase CLI not installed', retriable: false };
    }

    const s = ui.spinner();

    // Set secrets for edge functions
    try {
      s.start('Setting edge function secrets...');
      const secretPairs = [
        `OPENAI_API_KEY=${env.values['OPENAI_API_KEY'] ?? ''}`,
        `ANTHROPIC_API_KEY=${env.values['ANTHROPIC_API_KEY'] ?? ''}`,
        `CAPTURE_WEBHOOK_SECRET=${env.values['CAPTURE_WEBHOOK_SECRET'] ?? ''}`,
        `CAPTURE_JWT_SECRET=${env.values['CAPTURE_JWT_SECRET'] ?? ''}`,
        `SUPABASE_URL=${env.values['SUPABASE_URL'] ?? ''}`,
        `SUPABASE_SERVICE_ROLE_KEY=${env.values['SUPABASE_SERVICE_ROLE_KEY'] ?? ''}`,
      ].join(' ');
      execSync(`npx supabase secrets set ${secretPairs}`, { stdio: 'pipe', timeout: 30000 });
      s.stop('Edge function secrets set');
    } catch (err) {
      s.stop('Failed to set secrets');
      const message = err instanceof Error ? err.message : String(err);
      ui.warn(`Could not set secrets: ${message}`);
    }

    // Deploy each function
    for (const fn of FUNCTIONS_TO_DEPLOY) {
      const s2 = ui.spinner();
      try {
        s2.start(`Deploying ${fn}...`);
        const noVerifyJwt = fn === 'capture' ? ' --no-verify-jwt' : '';
        execSync(`npx supabase functions deploy ${fn}${noVerifyJwt}`, {
          stdio: 'pipe',
          timeout: 60000,
        });
        s2.stop(`${fn} deployed`);

        if (!state.edgeFunctionsDeployed.includes(fn)) {
          state.edgeFunctionsDeployed.push(fn);
        }
      } catch (err) {
        s2.stop(`Failed to deploy ${fn}`);
        const message = err instanceof Error ? err.message : String(err);
        ui.error(`Deploy error for ${fn}: ${message}`);
        return { status: 'failed', error: `Failed to deploy ${fn}: ${message}`, retriable: true };
      }
    }

    return { status: 'done' };
  },
};

function isSupabaseCLIAvailable(): boolean {
  try {
    execSync('npx supabase --version', { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

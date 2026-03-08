import { execSync } from 'node:child_process';
import * as ui from '../ui.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

export const migrationsStep: SetupStep = {
  name: 'Database Migrations',
  number: 6,

  async isComplete(state: SetupState, _env: EnvFile): Promise<boolean> {
    // Migrations are considered complete if the state file records them
    // The actual check is done during run() via the Supabase CLI
    return state.completedSteps.includes(6);
  },

  async run(state: SetupState, _env: EnvFile): Promise<StepResult> {
    if (state.completedSteps.includes(6)) {
      ui.info('Migrations previously applied.');
      const rerun = await ui.confirm({ message: 'Re-run migrations?', initialValue: false });
      if (ui.isCancel(rerun)) return { status: 'skipped', reason: 'Cancelled' };
      if (!rerun) return { status: 'skipped', reason: 'Already applied' };
    }

    // Check for supabase CLI
    if (!isSupabaseCLIAvailable()) {
      ui.error('Supabase CLI not found. Install it: https://supabase.com/docs/guides/cli');
      ui.info('Migrations require the Supabase CLI. Steps 1-5 can run without it.');
      return { status: 'failed', error: 'Supabase CLI not installed', retriable: false };
    }

    const s = ui.spinner();

    try {
      // Link the project (may already be linked)
      s.start('Linking Supabase project...');
      try {
        execSync('npx supabase link', { stdio: 'pipe', timeout: 30000 });
        s.stop('Supabase project linked');
      } catch {
        s.stop('Project may already be linked (continuing)');
      }

      // Push migrations
      s.start('Applying database migrations...');
      const output = execSync('npx supabase db push', {
        stdio: 'pipe',
        timeout: 60000,
      }).toString();
      s.stop('Database migrations applied');

      if (output) {
        ui.info(output.trim());
      }

      return { status: 'done' };
    } catch (err) {
      s.stop('Migration failed');
      const message = err instanceof Error ? err.message : String(err);
      ui.error(`Migration error: ${message}`);
      return { status: 'failed', error: message, retriable: true };
    }
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

import { execSync, execFileSync } from 'node:child_process';
import * as ui from '../ui.js';
import { hasEnvVar } from '../env.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

export const migrationsStep: SetupStep = {
  name: 'Database Migrations',
  number: 6,

  async isComplete(state: SetupState, _env: EnvFile): Promise<boolean> {
    return state.completedSteps.includes(6);
  },

  async run(state: SetupState, env: EnvFile): Promise<StepResult> {
    if (!hasEnvVar(env, 'DATABASE_URL')) {
      ui.error('DATABASE_URL is not set. Complete the Neon connection step first.');
      return { status: 'failed', error: 'Missing DATABASE_URL', retriable: false };
    }

    if (state.completedSteps.includes(6)) {
      ui.info('Migrations previously applied (the runner is idempotent).');
      const rerun = await ui.confirm({ message: 'Re-run migrations?', initialValue: false });
      if (ui.isCancel(rerun)) return { status: 'skipped', reason: 'Cancelled' };
      if (!rerun) return { status: 'skipped', reason: 'Already applied' };
    }

    if (!isPsqlAvailable()) {
      ui.error('psql not found. On macOS: brew install libpq, then add it to PATH:');
      ui.info('  export PATH="/opt/homebrew/opt/libpq/bin:$PATH"');
      return { status: 'failed', error: 'psql not installed', retriable: true };
    }

    // Migrations/DDL must use Neon's direct endpoint; the pooled endpoint goes
    // through pgbouncer transaction pooling, which breaks --single-transaction.
    const directUrl = env.values['DATABASE_URL']!.replace('-pooler', '');

    const s = ui.spinner();
    try {
      s.start('Applying database migrations (scripts/migrate.sh)...');
      const output = execFileSync('bash', ['scripts/migrate.sh'], {
        env: { ...process.env, DATABASE_URL: directUrl },
        stdio: 'pipe',
        timeout: 120000,
      }).toString();
      s.stop('Database migrations applied');
      if (output.trim()) ui.info(output.trim());
      return { status: 'done' };
    } catch (err) {
      s.stop('Migration failed');
      const message = err instanceof Error ? err.message : String(err);
      ui.error(`Migration error: ${message}`);
      return { status: 'failed', error: message, retriable: true };
    }
  },
};

function isPsqlAvailable(): boolean {
  try {
    execSync('psql --version', { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

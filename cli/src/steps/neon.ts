import * as ui from '../ui.js';
import { hasEnvVar, maskSecret } from '../env.js';
import { validateNeon } from '../validate.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const CONNECTION_STRING_PATTERN = /^postgres(ql)?:\/\/.+/;

export const neonStep: SetupStep = {
  name: 'Neon Database Connection',
  number: 1,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    return hasEnvVar(env, 'DATABASE_URL');
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    if (hasEnvVar(env, 'DATABASE_URL')) {
      ui.info(`Already configured (${maskSecret(env.values['DATABASE_URL']!)})`);
      const reconfigure = await ui.confirm({ message: 'Reconfigure?', initialValue: false });
      if (ui.isCancel(reconfigure)) return { status: 'skipped', reason: 'Cancelled' };
      if (!reconfigure) return { status: 'skipped', reason: 'Already configured' };
    }

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const url = await ui.password({
        message: 'Neon connection string (from the Neon console):',
        validate: (value) => {
          if (!value || !CONNECTION_STRING_PATTERN.test(value)) {
            return 'Must be a postgresql:// connection string';
          }
        },
      });
      if (ui.isCancel(url)) return { status: 'skipped', reason: 'Cancelled' };

      const s = ui.spinner();
      s.start('Validating Neon connection...');
      const result = await validateNeon(url as string);

      if (result.ok) {
        s.stop('Connected to Neon');
        env.values['DATABASE_URL'] = url as string;
        return { status: 'done' };
      }

      s.stop(`Connection failed: ${result.error}`);
      attempts++;

      if (attempts < maxAttempts) {
        const retry = await ui.confirm({ message: 'Try a different connection string?', initialValue: true });
        if (ui.isCancel(retry) || !retry) {
          return { status: 'failed', error: result.error ?? 'Validation failed', retriable: true };
        }
      }
    }

    return { status: 'failed', error: 'Too many failed attempts', retriable: true };
  },
};

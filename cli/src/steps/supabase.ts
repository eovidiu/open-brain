import * as ui from '../ui.js';
import { hasEnvVar, maskSecret } from '../env.js';
import { validateSupabase } from '../validate.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;

export const supabaseStep: SetupStep = {
  name: 'Supabase Connection',
  number: 1,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    return hasEnvVar(env, 'SUPABASE_URL') && hasEnvVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    if (hasEnvVar(env, 'SUPABASE_URL') && hasEnvVar(env, 'SUPABASE_SERVICE_ROLE_KEY')) {
      ui.info(`Already configured (${maskSecret(env.values['SUPABASE_URL']!)})`);
      const reconfigure = await ui.confirm({ message: 'Reconfigure?', initialValue: false });
      if (ui.isCancel(reconfigure)) return { status: 'skipped', reason: 'Cancelled' };
      if (!reconfigure) return { status: 'skipped', reason: 'Already configured' };
    }

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const url = await ui.text({
        message: 'Supabase project URL:',
        placeholder: 'https://xyzabc.supabase.co',
        validate: (value) => {
          if (!SUPABASE_URL_PATTERN.test(value)) {
            return 'URL must match https://<project-ref>.supabase.co';
          }
        },
      });
      if (ui.isCancel(url)) return { status: 'skipped', reason: 'Cancelled' };

      const key = await ui.password({
        message: 'Supabase service role key:',
        validate: (value) => {
          if (!value.startsWith('eyJ')) {
            return 'Service role key should start with "eyJ"';
          }
        },
      });
      if (ui.isCancel(key)) return { status: 'skipped', reason: 'Cancelled' };

      const s = ui.spinner();
      s.start('Validating Supabase connection...');
      const result = await validateSupabase(url as string, key as string);

      if (result.ok) {
        s.stop('Connected to Supabase');
        env.values['SUPABASE_URL'] = url as string;
        env.values['SUPABASE_SERVICE_ROLE_KEY'] = key as string;
        return { status: 'done' };
      }

      s.stop(`Connection failed: ${result.error}`);
      attempts++;

      if (attempts < maxAttempts) {
        const retry = await ui.confirm({ message: 'Try different credentials?', initialValue: true });
        if (ui.isCancel(retry) || !retry) {
          return { status: 'failed', error: result.error ?? 'Validation failed', retriable: true };
        }
      }
    }

    return { status: 'failed', error: 'Too many failed attempts', retriable: true };
  },
};

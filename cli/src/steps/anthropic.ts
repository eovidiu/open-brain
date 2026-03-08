import * as ui from '../ui.js';
import { hasEnvVar, maskSecret } from '../env.js';
import { validateAnthropicKey } from '../validate.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

export const anthropicStep: SetupStep = {
  name: 'Anthropic API Key',
  number: 3,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    return hasEnvVar(env, 'ANTHROPIC_API_KEY');
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    if (hasEnvVar(env, 'ANTHROPIC_API_KEY')) {
      ui.info(`Already configured (${maskSecret(env.values['ANTHROPIC_API_KEY']!)})`);
      const reconfigure = await ui.confirm({ message: 'Reconfigure?', initialValue: false });
      if (ui.isCancel(reconfigure)) return { status: 'skipped', reason: 'Cancelled' };
      if (!reconfigure) return { status: 'skipped', reason: 'Already configured' };
    }

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const key = await ui.password({
        message: 'Anthropic API key:',
        validate: (value) => {
          if (!value.startsWith('sk-ant-')) {
            return 'Anthropic API key should start with "sk-ant-"';
          }
        },
      });
      if (ui.isCancel(key)) return { status: 'skipped', reason: 'Cancelled' };

      const s = ui.spinner();
      s.start('Validating Anthropic key (tiny messages call)...');
      const result = await validateAnthropicKey(key as string);

      if (result.ok) {
        s.stop('Anthropic key valid (claude-haiku-4-5 accessible)');
        env.values['ANTHROPIC_API_KEY'] = key as string;
        return { status: 'done' };
      }

      s.stop(`Validation failed: ${result.error}`);
      attempts++;

      if (attempts < maxAttempts) {
        const retry = await ui.confirm({ message: 'Try a different key?', initialValue: true });
        if (ui.isCancel(retry) || !retry) {
          return { status: 'failed', error: result.error ?? 'Validation failed', retriable: true };
        }
      }
    }

    return { status: 'failed', error: 'Too many failed attempts', retriable: true };
  },
};

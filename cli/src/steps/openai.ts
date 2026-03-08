import * as ui from '../ui.js';
import { hasEnvVar, maskSecret } from '../env.js';
import { validateOpenAIKey } from '../validate.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

export const openaiStep: SetupStep = {
  name: 'OpenAI API Key',
  number: 2,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    return hasEnvVar(env, 'OPENAI_API_KEY');
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    if (hasEnvVar(env, 'OPENAI_API_KEY')) {
      ui.info(`Already configured (${maskSecret(env.values['OPENAI_API_KEY']!)})`);
      const reconfigure = await ui.confirm({ message: 'Reconfigure?', initialValue: false });
      if (ui.isCancel(reconfigure)) return { status: 'skipped', reason: 'Cancelled' };
      if (!reconfigure) return { status: 'skipped', reason: 'Already configured' };
    }

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const key = await ui.password({
        message: 'OpenAI API key:',
        validate: (value) => {
          if (!value.startsWith('sk-')) {
            return 'OpenAI API key should start with "sk-"';
          }
        },
      });
      if (ui.isCancel(key)) return { status: 'skipped', reason: 'Cancelled' };

      const s = ui.spinner();
      s.start('Validating OpenAI key (tiny embedding call)...');
      const result = await validateOpenAIKey(key as string);

      if (result.ok) {
        s.stop('OpenAI key valid (text-embedding-3-small accessible)');
        env.values['OPENAI_API_KEY'] = key as string;
        env.values['EMBEDDING_MODEL'] = 'text-embedding-3-small';
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

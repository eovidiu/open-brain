import crypto from 'node:crypto';
import * as ui from '../ui.js';
import { hasEnvVar } from '../env.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

const SECRET_KEYS = ['CAPTURE_WEBHOOK_SECRET', 'CAPTURE_JWT_SECRET', 'MCP_CLIENT_SECRET'] as const;

export const secretsStep: SetupStep = {
  name: 'Generate Secrets',
  number: 4,

  async isComplete(_state: SetupState, env: EnvFile): Promise<boolean> {
    return SECRET_KEYS.every((key) => hasEnvVar(env, key));
  },

  async run(_state: SetupState, env: EnvFile): Promise<StepResult> {
    const allExist = SECRET_KEYS.every((key) => hasEnvVar(env, key));

    if (allExist) {
      ui.warn('Secrets already exist. Regenerating will invalidate existing tokens.');
      const regenerate = await ui.confirm({ message: 'Regenerate?', initialValue: false });
      if (ui.isCancel(regenerate)) return { status: 'skipped', reason: 'Cancelled' };
      if (!regenerate) return { status: 'skipped', reason: 'Secrets already exist' };
    }

    // HMAC and JWT secrets: 256-bit (32 bytes), hex-encoded (64 chars)
    env.values['CAPTURE_WEBHOOK_SECRET'] = crypto.randomBytes(32).toString('hex');
    ui.info('Generated CAPTURE_WEBHOOK_SECRET (256-bit hex)');

    env.values['CAPTURE_JWT_SECRET'] = crypto.randomBytes(32).toString('hex');
    ui.info('Generated CAPTURE_JWT_SECRET (256-bit hex)');

    // MCP client secret: 36 random bytes, base64url-encoded (48 chars)
    env.values['MCP_CLIENT_SECRET'] = crypto.randomBytes(36).toString('base64url');
    ui.info('Generated MCP_CLIENT_SECRET (48-char base64url)');

    return { status: 'done' };
  },
};

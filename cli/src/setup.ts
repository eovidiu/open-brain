import * as ui from './ui.js';
import { loadState, saveState, markStepComplete } from './state.js';
import { loadEnv } from './env.js';
import type { SetupStep } from './types.js';

import { supabaseStep } from './steps/supabase.js';
import { openaiStep } from './steps/openai.js';
import { anthropicStep } from './steps/anthropic.js';
import { secretsStep } from './steps/secrets.js';
import { writeEnvStep } from './steps/write-env.js';
import { migrationsStep } from './steps/migrations.js';
import { edgeFunctionsStep } from './steps/edge-functions.js';
import { claudeDesktopStep } from './steps/claude-desktop.js';

const steps: SetupStep[] = [
  supabaseStep,
  openaiStep,
  anthropicStep,
  secretsStep,
  writeEnvStep,
  migrationsStep,
  edgeFunctionsStep,
  claudeDesktopStep,
];

export async function runSetup(): Promise<void> {
  const state = loadState();
  const env = loadEnv(process.cwd());
  const totalSteps = steps.length;

  let failed = false;

  for (const step of steps) {
    ui.stepHeader(step.number, totalSteps, step.name);

    const complete = await step.isComplete(state, env);
    if (complete) {
      ui.success(`Already complete`);
      const reconfigure = await ui.confirm({ message: 'Reconfigure?', initialValue: false });
      if (ui.isCancel(reconfigure)) {
        ui.cancelled();
        process.exit(0);
      }
      if (!reconfigure) {
        ui.info('Skipped');
        continue;
      }
    }

    const result = await step.run(state, env);

    switch (result.status) {
      case 'done':
        markStepComplete(state, step.number);
        saveState(state);
        ui.success(`${step.name} complete`);
        break;

      case 'skipped':
        ui.info(`Skipped: ${result.reason}`);
        break;

      case 'failed':
        ui.error(`${step.name} failed: ${result.error}`);
        if (!result.retriable) {
          ui.error('This step cannot be retried. Fix the issue and re-run setup.');
          failed = true;
        } else {
          ui.info('Re-run "openbrain setup" to retry from this step.');
          failed = true;
        }
        break;
    }

    if (failed) break;
  }

  if (!failed) {
    ui.outro(
      'Setup complete.\n\n' +
      '  Start the MCP server:\n' +
      '    npm run dev\n\n' +
      '  Or in stdio mode (for Claude Desktop):\n' +
      '    npx open-brain-mcp-server --stdio'
    );
  }
}

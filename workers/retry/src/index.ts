import { runRetryBatch } from './retry-batch.js';
import type { Env } from './types.js';

export default {
  // Cron-only Worker: process one retry batch per trigger. ctx.waitUntil keeps
  // the batch running after the handler returns, per the Workers cron contract.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runRetryBatch(env)
        .then((summary) => {
          console.log(`[retry-worker] ${JSON.stringify(summary)}`);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[retry-worker] batch failed: ${message}`);
        }),
    );
  },

  // No public route: this Worker is invoked only by its Cron Trigger.
  async fetch(): Promise<Response> {
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

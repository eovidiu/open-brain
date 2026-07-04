#!/usr/bin/env node
import { runSetup } from './setup.js';
import { runStatus } from './commands/status.js';
import * as ui from './ui.js';

const VERSION = '3.0.0';

const command = process.argv[2];

switch (command) {
  case 'status':
    ui.banner(VERSION);
    runStatus().catch((err) => {
      ui.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;

  case 'setup':
  case undefined:
    ui.banner(VERSION);
    runSetup().catch((err) => {
      ui.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;

  default:
    console.log(`open-brain v${VERSION}\n`);
    console.log('Usage:');
    console.log('  open-brain-setup          Set up Neon + Cloudflare Workers (default)');
    console.log('  open-brain-setup status   Check system health');
    process.exit(1);
}

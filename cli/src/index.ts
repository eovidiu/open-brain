#!/usr/bin/env node
import { runSetup } from './setup.js';
import { runStatus } from './commands/status.js';
import * as ui from './ui.js';

const VERSION = '1.0.0-mvp';

const command = process.argv[2];

switch (command) {
  case 'setup':
    ui.banner(VERSION);
    runSetup().catch((err) => {
      ui.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;

  case 'status':
    ui.banner(VERSION);
    runStatus().catch((err) => {
      ui.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    break;

  default:
    console.log(`open-brain CLI v${VERSION}\n`);
    console.log('Usage:');
    console.log('  openbrain setup    Interactive setup wizard');
    console.log('  openbrain status   Check system health');
    process.exit(command ? 1 : 0);
}

import fs from 'node:fs';
import path from 'node:path';
import type { SetupState } from './types.js';

const STATE_FILE = '.openbrain-setup.json';

function getStatePath(): string {
  return path.resolve(process.cwd(), STATE_FILE);
}

export function loadState(): SetupState {
  const statePath = getStatePath();
  if (fs.existsSync(statePath)) {
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as SetupState;
  }
  return createEmptyState();
}

export function saveState(state: SetupState): void {
  state.lastRunAt = new Date().toISOString();
  fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2) + '\n');
}

export function markStepComplete(state: SetupState, stepNumber: number): void {
  if (!state.completedSteps.includes(stepNumber)) {
    state.completedSteps.push(stepNumber);
  }
}

function createEmptyState(): SetupState {
  return {
    version: 1,
    completedSteps: [],
    lastRunAt: new Date().toISOString(),
    migrationsApplied: [],
    edgeFunctionsDeployed: [],
    claudeDesktopConfigured: false,
  };
}

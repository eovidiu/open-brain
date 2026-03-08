export interface SetupStep {
  name: string;
  number: number;
  isComplete(state: SetupState, env: EnvFile): Promise<boolean>;
  run(state: SetupState, env: EnvFile): Promise<StepResult>;
}

export type StepResult =
  | { status: 'done' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; retriable: boolean };

export interface SetupState {
  version: number;
  completedSteps: number[];
  lastRunAt: string;
  migrationsApplied: string[];
  edgeFunctionsDeployed: string[];
  claudeDesktopConfigured: boolean;
}

export interface EnvFile {
  values: Record<string, string>;
  filePath: string;
}

import * as p from '@clack/prompts';

export function banner(version: string): void {
  p.intro(`open-brain setup v${version}`);
}

export function stepHeader(number: number, total: number, name: string): void {
  p.log.step(`Step ${number} of ${total}: ${name}`);
}

export function success(message: string): void {
  p.log.success(message);
}

export function info(message: string): void {
  p.log.info(message);
}

export function warn(message: string): void {
  p.log.warn(message);
}

export function error(message: string): void {
  p.log.error(message);
}

export function cancelled(): void {
  p.cancel('Setup cancelled.');
}

export function outro(message: string): void {
  p.outro(message);
}

export async function text(opts: {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string | undefined) => string | Error | undefined;
}): Promise<string | symbol> {
  return p.text(opts);
}

export async function password(opts: {
  message: string;
  validate?: (value: string | undefined) => string | Error | undefined;
}): Promise<string | symbol> {
  return p.password(opts);
}

export async function confirm(opts: {
  message: string;
  initialValue?: boolean;
}): Promise<boolean | symbol> {
  return p.confirm(opts);
}

export function isCancel(value: unknown): value is symbol {
  return p.isCancel(value);
}

export function spinner(): ReturnType<typeof p.spinner> {
  return p.spinner();
}

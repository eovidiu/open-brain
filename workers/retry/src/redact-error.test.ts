import { redactError, toErrorMessage } from './redact-error.js';

describe('redactError', () => {
  it('redacts sk- style API keys', () => {
    expect(redactError('failed with sk-abc123XYZ_-9')).toBe('failed with sk-***');
  });

  it('redacts key=value style secrets', () => {
    expect(redactError('response had key: abcdefghijklmnop')).toBe('response had key=***');
  });

  it('truncates long messages to 200 chars', () => {
    const long = 'x'.repeat(500);
    expect(redactError(long)).toHaveLength(200);
  });

  it('passes through messages with nothing to redact', () => {
    expect(redactError('plain failure')).toBe('plain failure');
  });
});

describe('toErrorMessage', () => {
  it('extracts and redacts an Error message', () => {
    expect(toErrorMessage(new Error('boom sk-secretvalue123'))).toBe('boom sk-***');
  });

  it('stringifies non-Error values', () => {
    expect(toErrorMessage('raw string failure')).toBe('raw string failure');
  });
});

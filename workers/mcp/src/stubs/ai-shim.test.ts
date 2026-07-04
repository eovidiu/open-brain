import { jsonSchema } from './ai-shim.js';

describe('jsonSchema stub', () => {
  it('returns its input unchanged', () => {
    const schema = { type: 'object' };
    expect(jsonSchema(schema)).toBe(schema);
  });
});

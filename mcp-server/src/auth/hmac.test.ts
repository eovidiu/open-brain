import crypto from 'node:crypto';
import { verifyHmac } from './hmac.js';

const SECRET = 'test-webhook-secret';

function computeSignature(body: Buffer, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

describe('verifyHmac', () => {
  const body = Buffer.from('{"event":"capture"}');

  it('returns true for a valid HMAC signature', () => {
    const sig = computeSignature(body, SECRET);
    expect(verifyHmac(body, sig, SECRET)).toBe(true);
  });

  it('returns false for an invalid HMAC signature', () => {
    const badSig = 'sha256=' + 'a'.repeat(64);
    expect(verifyHmac(body, badSig, SECRET)).toBe(false);
  });

  it('returns false when sha256= prefix is missing', () => {
    const hmac = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyHmac(body, hmac, SECRET)).toBe(false);
  });

  it('returns false for an empty signature', () => {
    expect(verifyHmac(body, '', SECRET)).toBe(false);
  });

  it('returns false when the body differs', () => {
    const sig = computeSignature(body, SECRET);
    const differentBody = Buffer.from('{"event":"different"}');
    expect(verifyHmac(differentBody, sig, SECRET)).toBe(false);
  });

  it('does not crash on length mismatch (timing-safe)', () => {
    const shortSig = 'sha256=abcd';
    expect(verifyHmac(body, shortSig, SECRET)).toBe(false);
  });
});

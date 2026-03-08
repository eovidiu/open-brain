import crypto from 'node:crypto';
import { verifyHmac } from './hmac.js';

const SECRET = 'test-webhook-secret';

function createSignature(body: string, timestamp: string, secret: string): string {
  const payload = `${timestamp}.${body}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyHmac', () => {
  const bodyStr = '{"event":"capture"}';
  const body = Buffer.from(bodyStr);

  it('accepts valid signature with current timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = createSignature(bodyStr, timestamp, SECRET);
    expect(verifyHmac(body, sig, SECRET, timestamp)).toBe(true);
  });

  it('rejects requests older than 5 minutes', () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const sig = createSignature(bodyStr, oldTimestamp, SECRET);
    expect(verifyHmac(body, sig, SECRET, oldTimestamp)).toBe(false);
  });

  it('accepts requests within the 5-minute window', () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 299).toString();
    const sig = createSignature(bodyStr, timestamp, SECRET);
    expect(verifyHmac(body, sig, SECRET, timestamp)).toBe(true);
  });

  it('rejects future timestamps beyond 5 minutes', () => {
    const futureTimestamp = (Math.floor(Date.now() / 1000) + 301).toString();
    const sig = createSignature(bodyStr, futureTimestamp, SECRET);
    expect(verifyHmac(body, sig, SECRET, futureTimestamp)).toBe(false);
  });

  it('rejects missing timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = createSignature(bodyStr, timestamp, SECRET);
    expect(verifyHmac(body, sig, SECRET, undefined)).toBe(false);
  });

  it('rejects non-numeric timestamp', () => {
    expect(verifyHmac(body, 'sha256=abc', SECRET, 'not-a-number')).toBe(false);
  });

  it('rejects invalid signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const badSig = 'sha256=' + 'a'.repeat(64);
    expect(verifyHmac(body, badSig, SECRET, timestamp)).toBe(false);
  });

  it('rejects signature without sha256= prefix', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const hmac = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${bodyStr}`).digest('hex');
    expect(verifyHmac(body, hmac, SECRET, timestamp)).toBe(false);
  });

  it('rejects empty signature', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    expect(verifyHmac(body, '', SECRET, timestamp)).toBe(false);
  });

  it('rejects when body differs', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = createSignature(bodyStr, timestamp, SECRET);
    const differentBody = Buffer.from('{"event":"different"}');
    expect(verifyHmac(differentBody, sig, SECRET, timestamp)).toBe(false);
  });

  it('rejects replayed signature with different timestamp', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = createSignature(bodyStr, timestamp, SECRET);
    const differentTimestamp = (Math.floor(Date.now() / 1000) - 10).toString();
    expect(verifyHmac(body, sig, SECRET, differentTimestamp)).toBe(false);
  });

  it('handles length mismatch without crashing (timing-safe)', () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const shortSig = 'sha256=abcd';
    expect(verifyHmac(body, shortSig, SECRET, timestamp)).toBe(false);
  });
});

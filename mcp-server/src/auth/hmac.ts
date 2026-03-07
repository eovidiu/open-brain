import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export function verifyHmac(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const providedHex = signature.slice(SIGNATURE_PREFIX.length);

  let providedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }

  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest();

  if (providedBuffer.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, computed);
}

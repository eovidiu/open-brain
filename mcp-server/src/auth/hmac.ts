import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

export function verifyHmac(
  rawBody: Buffer,
  signature: string,
  secret: string,
  timestamp?: string,
): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  // Timestamp is required for replay protection
  if (!timestamp) {
    return false;
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_AGE_SECONDS) {
    return false;
  }

  const providedHex = signature.slice(SIGNATURE_PREFIX.length);

  let providedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }

  // Sign timestamp.body to prevent replay
  const payload = `${timestamp}.${rawBody.toString()}`;
  const computed = crypto.createHmac('sha256', secret).update(payload).digest();

  if (providedBuffer.length !== computed.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, computed);
}

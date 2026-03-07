import jwt from 'jsonwebtoken';
import type { TokenResponse } from '../types.js';

const TOKEN_EXPIRY_SECONDS = 3600;
const SUBJECT = 'open-brain-owner';

export function signToken(secret: string): TokenResponse {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: SUBJECT,
    iat: now,
    exp: now + TOKEN_EXPIRY_SECONDS,
  };

  const token = jwt.sign(payload, secret, { algorithm: 'HS256' });

  return {
    token,
    expires_in: TOKEN_EXPIRY_SECONDS,
    token_type: 'Bearer',
  };
}

export function verifyToken(
  token: string,
  secret: string,
): { sub: string; iat: number; exp: number } | null {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as { sub: string; iat: number; exp: number };

    if (decoded.sub !== SUBJECT) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

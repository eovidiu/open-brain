import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt.js';

const SECRET = 'test-jwt-secret';

describe('signToken', () => {
  it('returns a valid token structure with expires_in=3600 and token_type=Bearer', () => {
    const result = signToken(SECRET);

    expect(result).toHaveProperty('token');
    expect(typeof result.token).toBe('string');
    expect(result.expires_in).toBe(3600);
    expect(result.token_type).toBe('Bearer');
  });
});

describe('verifyToken', () => {
  it('returns decoded payload for a valid token', () => {
    const { token } = signToken(SECRET);
    const decoded = verifyToken(token, SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('open-brain-owner');
    expect(typeof decoded!.iat).toBe('number');
    expect(typeof decoded!.exp).toBe('number');
  });

  it('returns null for an expired token', () => {
    const pastTime = Math.floor(Date.now() / 1000) - 7200;
    const token = jwt.sign(
      { sub: 'open-brain-owner', iat: pastTime, exp: pastTime + 3600 },
      SECRET,
      { algorithm: 'HS256' },
    );

    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('returns null when verified with the wrong secret', () => {
    const { token } = signToken(SECRET);
    expect(verifyToken(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for a tampered payload', () => {
    const { token } = signToken(SECRET);
    const [header, , sig] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'hacker', iat: 0, exp: 9999999999 }),
    ).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${sig}`;

    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it('returns null when sub is not open-brain-owner', () => {
    const token = jwt.sign(
      { sub: 'someone-else', iat: Math.floor(Date.now() / 1000) },
      SECRET,
      { algorithm: 'HS256', expiresIn: 3600 },
    );

    expect(verifyToken(token, SECRET)).toBeNull();
  });
});

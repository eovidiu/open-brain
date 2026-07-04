import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt.js';

const SECRET = 'test-jwt-secret';

describe('signToken', () => {
  it('returns a valid token structure with expires_in=3600 and token_type=Bearer', async () => {
    const result = await signToken(SECRET);

    expect(result).toHaveProperty('token');
    expect(typeof result.token).toBe('string');
    expect(result.expires_in).toBe(3600);
    expect(result.token_type).toBe('Bearer');
  });
});

describe('verifyToken', () => {
  it('returns decoded payload for a valid token', async () => {
    const { token } = await signToken(SECRET);
    const decoded = await verifyToken(token, SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('open-brain-owner');
    expect(typeof decoded!.iat).toBe('number');
    expect(typeof decoded!.exp).toBe('number');
  });

  it('returns null for an expired token', async () => {
    const pastTime = Math.floor(Date.now() / 1000) - 7200;
    const token = jwt.sign(
      { sub: 'open-brain-owner', iat: pastTime, exp: pastTime + 3600 },
      SECRET,
      { algorithm: 'HS256' },
    );

    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('returns null when verified with the wrong secret', async () => {
    const { token } = await signToken(SECRET);
    expect(await verifyToken(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for a tampered payload', async () => {
    const { token } = await signToken(SECRET);
    const [header, , sig] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'hacker', iat: 0, exp: 9999999999 }),
    ).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${sig}`;

    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it('returns null when sub is not open-brain-owner', async () => {
    const token = jwt.sign(
      { sub: 'someone-else', iat: Math.floor(Date.now() / 1000) },
      SECRET,
      { algorithm: 'HS256', expiresIn: 3600 },
    );

    expect(await verifyToken(token, SECRET)).toBeNull();
  });

  it('returns null for a malformed token (wrong number of segments)', async () => {
    expect(await verifyToken('not.a.valid.jwt', SECRET)).toBeNull();
    expect(await verifyToken('onlyonesegment', SECRET)).toBeNull();
  });

  it('returns null when alg is not HS256', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'open-brain-owner', iat: 0, exp: 9999999999 }),
    ).toString('base64url');
    expect(await verifyToken(`${header}.${payload}.`, SECRET)).toBeNull();
  });
});

describe('cross-implementation compatibility', () => {
  it('a token signed by our WebCrypto signToken verifies via jsonwebtoken', async () => {
    const { token } = await signToken(SECRET);

    const decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }) as {
      sub: string;
      iat: number;
      exp: number;
    };

    expect(decoded.sub).toBe('open-brain-owner');
  });

  it('a token signed by jsonwebtoken with the same claims passes our verifyToken', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { sub: 'open-brain-owner', iat: now, exp: now + 3600 },
      SECRET,
      { algorithm: 'HS256' },
    );

    const decoded = await verifyToken(token, SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.sub).toBe('open-brain-owner');
    expect(decoded!.exp).toBe(now + 3600);
  });
});

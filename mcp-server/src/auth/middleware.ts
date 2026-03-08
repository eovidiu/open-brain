import type { Request, Response, NextFunction } from 'express';
import { verifyHmac } from './hmac.js';
import { verifyToken } from './jwt.js';

export function authenticateCapture(req: Request, res: Response, next: NextFunction): void {
  const jwtHeader = req.headers.authorization;
  const hmacHeader = req.headers['x-openbrain-signature'] as string | undefined;

  const jwtSecret = process.env.CAPTURE_JWT_SECRET;
  const hmacSecret = process.env.CAPTURE_WEBHOOK_SECRET;

  // Priority: if both present, JWT takes precedence (§9.2 rule 4)
  if (jwtHeader?.startsWith('Bearer ')) {
    if (!jwtSecret) {
      res.status(500).json({ error: 'Server misconfigured: missing JWT secret' });
      return;
    }
    const token = jwtHeader.slice(7);
    const decoded = verifyToken(token, jwtSecret);
    if (!decoded) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
    return;
  }

  if (hmacHeader) {
    if (!hmacSecret) {
      res.status(500).json({ error: 'Server misconfigured: missing webhook secret' });
      return;
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const timestampHeader = req.headers['x-openbrain-timestamp'] as string | undefined;
    if (!verifyHmac(rawBody, hmacHeader, hmacSecret, timestampHeader)) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
    return;
  }

  res.status(401).json({ error: 'UNAUTHORIZED' });
}

export function authenticateSSE(req: Request, res: Response, next: NextFunction): void {
  const jwtHeader = req.headers.authorization;
  const jwtSecret = process.env.CAPTURE_JWT_SECRET;

  if (!jwtSecret) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  if (!jwtHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const token = jwtHeader.slice(7);
  const decoded = verifyToken(token, jwtSecret);
  if (!decoded) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  next();
}

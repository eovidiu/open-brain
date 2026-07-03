import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

type Db = NeonQueryFunction<false, false>;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;

  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL must be set');
  }

  db = neon(url);

  return db;
}

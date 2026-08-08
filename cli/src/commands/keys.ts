// API-key management for the MCP Worker. The raw key exists only in this
// process and in whatever the operator pastes into a client config; the
// database holds its SHA-256 only.
//
// The hashing here is deliberately duplicated from
// workers/shared/src/api-keys.ts rather than imported: the Worker package is
// outside this npm workspace, and a `file:` dependency would put its build
// ahead of the CLI's in every install. Both suites pin the same test vector,
// so a divergence fails a test instead of silently breaking authentication.
import crypto from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import * as ui from '../ui.js';
import { loadEnv, hasEnvVar } from '../env.js';
import { repoRoot } from '../paths.js';

export const API_KEY_PREFIX = 'obk_';

const KEY_BYTES = 32;

type Sql = NeonQueryFunction<false, false>;

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString('base64url')}`;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export async function runKeys(argv: string[]): Promise<void> {
  const [subcommand, label] = argv;

  if (subcommand !== 'create' && subcommand !== 'list' && subcommand !== 'revoke') {
    throw new Error(usage());
  }

  const sql = connect();

  if (subcommand === 'list') return listKeys(sql);
  if (!label) throw new Error(`A label is required: openbrain keys ${subcommand} <label>`);
  return subcommand === 'create' ? createKey(sql, label) : revokeKey(sql, label);
}

function usage(): string {
  return [
    'Usage:',
    '  openbrain keys create <label>   Mint a key (shown once)',
    '  openbrain keys list             List keys, without key material',
    '  openbrain keys revoke <label>   Revoke a key',
  ].join('\n');
}

// The process environment wins over .env. Passing DATABASE_URL= inline is an
// explicit override, so a stale .env must never shadow it — that silently
// authenticates against the wrong credential and reports it as a password
// failure, which is indistinguishable from a genuinely wrong password.
function connect(): Sql {
  const env = loadEnv(repoRoot());
  const url = process.env['DATABASE_URL'] || (hasEnvVar(env, 'DATABASE_URL')
    ? env.values['DATABASE_URL']!
    : undefined);

  if (!url) {
    throw new Error(
      'DATABASE_URL is set in neither .env nor the environment. ' +
        'Pass it inline (DATABASE_URL=... openbrain keys ...) or run "openbrain setup".',
    );
  }
  return neon(url);
}

async function createKey(sql: Sql, label: string): Promise<void> {
  const key = generateApiKey();
  const keyHash = hashApiKey(key);

  try {
    await sql`
      INSERT INTO api_keys (label, key_hash)
      VALUES (${label}, ${keyHash})
      RETURNING id, label, created_at
    `;
  } catch (err) {
    // Never let the raw key reach an error path.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('duplicate key value')) {
      throw new Error(`An API key labelled "${label}" already exists.`);
    }
    throw new Error(`Could not create the API key "${label}".`);
  }

  ui.success(`Created API key "${label}"`);
  ui.info(key);
  ui.warn('Copy it now — it will not be shown again.');
}

async function listKeys(sql: Sql): Promise<void> {
  const rows = await sql`
    SELECT id, label, created_at, last_used_at, revoked_at
    FROM api_keys
    ORDER BY created_at DESC
  `;

  if (rows.length === 0) {
    ui.info('No API keys yet. Create one with "openbrain keys create <label>".');
    return;
  }

  ui.info('label                 created     last used   status');
  for (const row of rows) {
    ui.info(
      [
        String(row['label']).padEnd(21),
        day(row['created_at']).padEnd(11),
        (row['last_used_at'] ? day(row['last_used_at']) : 'never').padEnd(11),
        row['revoked_at'] ? `revoked ${day(row['revoked_at'])}` : 'active',
      ].join(' '),
    );
  }
}

async function revokeKey(sql: Sql, label: string): Promise<void> {
  const rows = await sql`
    UPDATE api_keys
    SET revoked_at = now()
    WHERE label = ${label} AND revoked_at IS NULL
    RETURNING id, label, revoked_at
  `;

  if (rows.length === 0) {
    throw new Error(`No active API key with label "${label}".`);
  }
  ui.success(`Revoked API key "${label}"`);
}

function day(value: unknown): string {
  return new Date(value as string | Date).toISOString().slice(0, 10);
}

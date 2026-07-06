import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root, resolved from this module's own location rather than
// process.cwd(): npm workspace scripts (npm run dev --workspace=cli) launch
// with cwd set to cli/, which must not change where .env, the setup state,
// and scripts/migrate.sh are looked up. This module lives at
// <root>/cli/(src|dist)/paths.*, so the root is two directories up.
export function repoRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..');
}

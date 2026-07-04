import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import * as ui from './ui.js';
import { validateSupabase, validateOpenAIKey, validateAnthropicKey } from './validate.js';
import { MIGRATIONS, EDGE_FUNCTION_CODE } from './assets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPABASE_URL_PATTERN = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/;
const SUPABASE_MGMT_API = 'https://api.supabase.com/v1';

function extractProjectRef(url: string): string {
  const match = url.match(SUPABASE_URL_PATTERN);
  return match?.[1] ?? '';
}

function isSupabaseCLIAvailable(): boolean {
  try {
    execSync('npx supabase --version', { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

function bail(msg: string): never {
  ui.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main deploy flow
// ---------------------------------------------------------------------------

export async function runDeploy(): Promise<void> {
  ui.info(
    "Let's get your AI memory running in ~2 minutes.\n" +
    '  You\'ll need:\n' +
    '  1. A Supabase project      → supabase.com (free tier works)\n' +
    '  2. A Supabase access token → supabase.com/dashboard/account/tokens\n' +
    '  3. An OpenAI API key       → platform.openai.com/api-keys',
  );

  // ------------------------------------------------------------------
  // Step 1: Collect Supabase credentials
  // ------------------------------------------------------------------
  ui.stepHeader(1, 4, 'Connect to Supabase');

  let supabaseUrl = '';
  let supabaseKey = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    const urlInput = await ui.text({
      message: 'Supabase project URL:',
      placeholder: 'https://xyzabc.supabase.co',
      validate: (v) => {
        if (!v || !SUPABASE_URL_PATTERN.test(v)) return 'Must be https://<ref>.supabase.co';
      },
    });
    if (ui.isCancel(urlInput)) bail('Setup cancelled.');

    const keyInput = await ui.password({
      message: 'Service role key (Project Settings → API):',
      validate: (v) => {
        if (!v || !v.startsWith('eyJ')) return 'Should start with "eyJ"';
      },
    });
    if (ui.isCancel(keyInput)) bail('Setup cancelled.');

    const s = ui.spinner();
    s.start('Testing connection...');
    const result = await validateSupabase(urlInput as string, keyInput as string);
    if (result.ok) {
      s.stop('Connected to Supabase');
      supabaseUrl = urlInput as string;
      supabaseKey = keyInput as string;
      break;
    }

    s.stop(`Failed: ${result.error}`);
    if (attempt === 2) bail('Too many failed attempts.');
    ui.warn('Check your URL and key, then try again.');
  }

  const projectRef = extractProjectRef(supabaseUrl);

  // Supabase access token (for CLI commands: secrets set, functions deploy)
  const accessTokenInput = await ui.password({
    message: 'Supabase access token (supabase.com/dashboard/account/tokens):',
    validate: (v) => {
      if (!v || v.length < 10) return 'Paste your access token from the Supabase dashboard';
    },
  });
  if (ui.isCancel(accessTokenInput)) bail('Setup cancelled.');
  const supabaseAccessToken = accessTokenInput as string;

  // ------------------------------------------------------------------
  // Step 2: Collect API keys
  // ------------------------------------------------------------------
  ui.stepHeader(2, 4, 'API Keys');

  let openaiKey = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const keyInput = await ui.password({
      message: 'OpenAI API key:',
      validate: (v) => {
        if (!v || !v.startsWith('sk-')) return 'Should start with "sk-"';
      },
    });
    if (ui.isCancel(keyInput)) bail('Setup cancelled.');

    const s = ui.spinner();
    s.start('Validating key...');
    const result = await validateOpenAIKey(keyInput as string);
    if (result.ok) {
      s.stop('OpenAI key valid');
      openaiKey = keyInput as string;
      break;
    }

    s.stop(`Failed: ${result.error}`);
    if (attempt === 2) bail('Too many failed attempts.');
  }

  // Anthropic (optional)
  let anthropicKey = '';
  let metadataProvider = 'openai';

  const wantsAnthropic = await ui.confirm({
    message: 'Add an Anthropic key for better metadata extraction? (optional)',
    initialValue: false,
  });

  if (!ui.isCancel(wantsAnthropic) && wantsAnthropic) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const keyInput = await ui.password({
        message: 'Anthropic API key:',
        validate: (v) => {
          if (!v || !v.startsWith('sk-ant-')) return 'Should start with "sk-ant-"';
        },
      });
      if (ui.isCancel(keyInput)) break;

      const s = ui.spinner();
      s.start('Validating key...');
      const result = await validateAnthropicKey(keyInput as string);
      if (result.ok) {
        s.stop('Anthropic key valid');
        anthropicKey = keyInput as string;
        metadataProvider = 'anthropic';
        break;
      }

      s.stop(`Failed: ${result.error}`);
      if (attempt === 2) {
        ui.warn('Continuing without Anthropic. Will use OpenAI for metadata.');
        break;
      }
    }
  }

  if (!anthropicKey) {
    ui.info('Using OpenAI for metadata extraction.');
  }

  // ------------------------------------------------------------------
  // Step 3: Deploy
  // ------------------------------------------------------------------
  ui.stepHeader(3, 4, 'Deploy');

  // Generate MCP client secret
  const mcpClientSecret = crypto.randomBytes(36).toString('base64url');
  ui.info('Generated MCP client secret.');

  // Check Supabase CLI early (needed for secrets and function deploy)
  const cliSpinner = ui.spinner();
  cliSpinner.start('Checking for Supabase CLI...');
  if (!isSupabaseCLIAvailable()) {
    cliSpinner.stop('Supabase CLI not found');
    ui.error(
      'The Supabase CLI is required to deploy.\n' +
      '  Install it:\n' +
      '    npm install -g supabase\n' +
      '  Or with brew:\n' +
      '    brew install supabase/tap/supabase\n\n' +
      '  Then re-run this setup.',
    );
    process.exit(1);
  }
  cliSpinner.stop('Supabase CLI found');

  // Env passed to all Supabase CLI commands so they authenticate without `supabase link`
  const cliEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: supabaseAccessToken };

  // Run migrations via Supabase Management API (no CLI link needed)
  const migrateSpinner = ui.spinner();
  migrateSpinner.start('Running database migrations...');
  try {
    const sortedMigrations = Object.entries(MIGRATIONS).sort(([a], [b]) => a.localeCompare(b));
    for (const [filename, sql] of sortedMigrations) {
      const response = await fetch(
        `${SUPABASE_MGMT_API}/projects/${projectRef}/database/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: sql }),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Migration ${filename}: ${response.status} ${body}`);
      }
    }
    migrateSpinner.stop('Database ready');
  } catch (err) {
    migrateSpinner.stop('Migration failed');
    const message = err instanceof Error ? err.message : String(err);
    bail(`Database migration failed: ${message}`);
  }

  // Scaffold a temp project directory with edge function
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-brain-'));

  try {
    scaffoldProject(tmpDir);

    // Set secrets
    const secretSpinner = ui.spinner();
    secretSpinner.start('Setting secrets...');
    try {
      const secrets = [
        `OPENAI_API_KEY=${openaiKey}`,
        `MCP_CLIENT_SECRET=${mcpClientSecret}`,
        `METADATA_LLM_PROVIDER=${metadataProvider}`,
      ];
      if (anthropicKey) {
        secrets.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
      }
      execSync(`npx supabase secrets set --project-ref ${projectRef} ${secrets.join(' ')}`, {
        cwd: tmpDir,
        stdio: 'pipe',
        timeout: 30_000,
        env: cliEnv,
      });
      secretSpinner.stop('Secrets configured');
    } catch (err) {
      secretSpinner.stop('Failed to set secrets');
      const message = err instanceof Error ? err.message : String(err);
      bail(`Secret configuration failed: ${message}`);
    }

    // Deploy edge function
    const deploySpinner = ui.spinner();
    deploySpinner.start('Deploying MCP server...');
    try {
      execSync(
        `npx supabase functions deploy open-brain-mcp --no-verify-jwt --project-ref ${projectRef}`,
        {
          cwd: tmpDir,
          stdio: 'pipe',
          timeout: 120_000,
          env: cliEnv,
        },
      );
      deploySpinner.stop('MCP server deployed');
    } catch (err) {
      deploySpinner.stop('Deploy failed');
      const message = err instanceof Error ? err.message : String(err);
      bail(`Edge function deployment failed: ${message}`);
    }
  } finally {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------
  // Step 4: Show config
  // ------------------------------------------------------------------
  ui.stepHeader(4, 4, 'Your MCP Config');

  const mcpUrl = `${supabaseUrl}/functions/v1/open-brain-mcp`;

  // Claude Desktop and most clients use stdio transport via mcp-remote adapter
  const desktopConfig = {
    mcpServers: {
      'open-brain': {
        command: 'npx',
        args: [
          'mcp-remote@latest',
          mcpUrl,
          '--header',
          `Authorization: Bearer ${mcpClientSecret}`,
        ],
      },
    },
  };

  // Claude Code supports HTTP transport natively
  const codeConfig = {
    mcpServers: {
      'open-brain': {
        type: 'http' as const,
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${mcpClientSecret}`,
        },
      },
    },
  };

  ui.outro(
    'Done! Add this to your AI assistant:\n\n' +
    '  ── Claude Desktop / Cursor ──\n' +
    '  (Settings → Developer → Edit Config)\n\n' +
    JSON.stringify(desktopConfig, null, 2) + '\n\n' +
    '  ── Claude Code ──\n' +
    '  (~/.claude.json or .mcp.json in your project)\n\n' +
    JSON.stringify(codeConfig, null, 2) + '\n\n' +
    `  Your secret: ${mcpClientSecret}\n` +
    '  Save it somewhere safe — you\'ll need it if you reconfigure.',
  );
}

// ---------------------------------------------------------------------------
// Scaffold temp supabase project
// ---------------------------------------------------------------------------

function scaffoldProject(tmpDir: string): void {
  // supabase/config.toml (minimal, required by CLI for functions deploy)
  const supabaseDir = path.join(tmpDir, 'supabase');
  fs.mkdirSync(supabaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(supabaseDir, 'config.toml'),
    'project_id = "open-brain"\n',
  );

  // Edge function (migrations run via Management API, not from files)
  const fnDir = path.join(supabaseDir, 'functions', 'open-brain-mcp');
  fs.mkdirSync(fnDir, { recursive: true });
  fs.writeFileSync(path.join(fnDir, 'index.ts'), EDGE_FUNCTION_CODE);
}

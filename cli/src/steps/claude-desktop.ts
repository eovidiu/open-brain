import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as ui from '../ui.js';
import type { SetupStep, SetupState, EnvFile, StepResult } from '../types.js';

export const claudeDesktopStep: SetupStep = {
  name: 'Claude Desktop Integration',
  number: 8,

  async isComplete(state: SetupState, _env: EnvFile): Promise<boolean> {
    return state.claudeDesktopConfigured;
  },

  async run(state: SetupState, env: EnvFile): Promise<StepResult> {
    const shouldConfigure = await ui.confirm({
      message: 'Configure Claude Desktop MCP integration?',
      initialValue: true,
    });
    if (ui.isCancel(shouldConfigure)) return { status: 'skipped', reason: 'Cancelled' };
    if (!shouldConfigure) return { status: 'skipped', reason: 'User declined' };

    const configPath = getClaudeDesktopConfigPath();
    if (!configPath) {
      ui.error(`Unsupported platform: ${process.platform}`);
      return { status: 'failed', error: `Unsupported platform: ${process.platform}`, retriable: false };
    }

    // Determine absolute path to the MCP server
    const projectRoot = path.resolve(process.cwd());
    const mpcServerPath = path.join(projectRoot, 'mcp-server', 'dist', 'index.js');

    // Build the server entry
    const serverEntry = {
      command: 'node',
      args: [mpcServerPath, '--stdio'],
      env: {
        SUPABASE_URL: env.values['SUPABASE_URL'] ?? '',
        SUPABASE_SERVICE_ROLE_KEY: env.values['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
        OPENAI_API_KEY: env.values['OPENAI_API_KEY'] ?? '',
        ANTHROPIC_API_KEY: env.values['ANTHROPIC_API_KEY'] ?? '',
        CAPTURE_WEBHOOK_SECRET: env.values['CAPTURE_WEBHOOK_SECRET'] ?? '',
        CAPTURE_JWT_SECRET: env.values['CAPTURE_JWT_SECRET'] ?? '',
        MCP_CLIENT_SECRET: env.values['MCP_CLIENT_SECRET'] ?? '',
        EMBEDDING_MODEL: env.values['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
      },
    };

    try {
      // Read existing config or create new
      let config: Record<string, unknown> = {};
      const configDir = path.dirname(configPath);

      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(raw);
      } else {
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
      }

      // Merge (don't overwrite other servers)
      const mcpServers = (config['mcpServers'] as Record<string, unknown>) ?? {};
      mcpServers['open-brain'] = serverEntry;
      config['mcpServers'] = mcpServers;

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      state.claudeDesktopConfigured = true;

      ui.success(`Added open-brain to ${configPath}`);
      return { status: 'done' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ui.error(`Failed to configure Claude Desktop: ${message}`);
      return { status: 'failed', error: message, retriable: true };
    }
  },
};

function getClaudeDesktopConfigPath(): string | null {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return path.join(process.env['APPDATA'] || '', 'Claude', 'claude_desktop_config.json');
    case 'linux':
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    default:
      return null;
  }
}

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export async function startStdioTransport(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[stdio] MCP server connected via stdio');
}

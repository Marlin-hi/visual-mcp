/**
 * MCP Server — stdio interface for Claude Code
 *
 * Exposes tools that Claude can use to interact with the visual editor.
 * Core tools are always available, adapter-specific tools are added dynamically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Zod is bundled with @modelcontextprotocol/sdk

export async function startMcpServer(bus, state, adapter) {
  const server = new McpServer({
    name: 'visual-mcp',
    version: '0.1.0',
  });

  // --- Core Tools ---

  server.tool(
    'get_viewport',
    'Get the current state of the visual editor canvas — what elements exist, their positions, and the user\'s current selection.',
    {},
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            adapter: state.adapterName,
            scene: state.scene,
            selection: state.userSelection,
            pendingInputs: state.userInputs.length,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_user_selection',
    'Get what the user has currently selected in the visual editor. Returns the element description, selector, and any associated data.',
    {},
    async () => {
      if (!state.userSelection) {
        return {
          content: [{ type: 'text', text: 'No element selected.' }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(state.userSelection, null, 2),
        }],
      };
    }
  );

  server.tool(
    'get_user_input',
    'Get pending messages/instructions the user typed in the visual editor browser. Returns and clears the queue.',
    {},
    async () => {
      const inputs = state.userInputs.splice(0);
      if (inputs.length === 0) {
        return {
          content: [{ type: 'text', text: 'No pending user input.' }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(inputs, null, 2),
        }],
      };
    }
  );

  server.tool(
    'update_scene',
    'Update the visual scene. Merges the provided data into the current scene state and pushes the update to the browser.',
    { scene: z.record(z.any()).describe('Scene data to merge into current state') },
    async ({ scene }) => {
      bus.emit('mcp:scene-update', scene);
      return {
        content: [{ type: 'text', text: 'Scene updated.' }],
      };
    }
  );

  server.tool(
    'send_command',
    'Send a command to the visual editor browser. The adapter interprets the command (e.g., "highlight", "animate", "zoom").',
    {
      command: z.string().describe('Command name'),
      args: z.record(z.any()).optional().describe('Command arguments'),
    },
    async ({ command, args }) => {
      bus.emit('mcp:command', { command, args: args || {} });
      return {
        content: [{ type: 'text', text: `Command sent: ${command}` }],
      };
    }
  );

  server.tool(
    'open_url',
    'Tell the user to open the visual editor in their browser. Returns the URL.',
    {},
    async () => {
      const port = parseInt(process.env.VISUAL_MCP_PORT || '4200', 10);
      return {
        content: [{
          type: 'text',
          text: `Visual editor is running at: http://localhost:${port}\nAdapter: ${state.adapterName}`,
        }],
      };
    }
  );

  // --- Adapter-specific Tools ---
  if (adapter.registerTools) {
    adapter.registerTools(server, bus, state);
  }

  // --- Start stdio transport ---
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('MCP server connected via stdio\n');
}

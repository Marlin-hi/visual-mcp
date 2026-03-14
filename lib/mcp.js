/**
 * MCP Server — stdio interface for Claude Code
 *
 * Exposes tools that Claude can use to interact with the visual editor.
 * Core tools are always available, adapter-specific tools are added dynamically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  server.tool(
    'take_screenshot',
    'Take a screenshot of the current canvas at a specific time. Returns the file path of the PNG. Use with the Read tool to view the image.',
    {
      time: z.number().optional().describe('Time in ms to render at (default: current time)'),
      output: z.string().optional().describe('Output file path (default: /tmp/visual-mcp-frame.png)'),
    },
    async ({ time, output }) => {
      const port = parseInt(process.env.VISUAL_MCP_PORT || '4200', 10);
      const t = time ?? (state.scene.currentTime || 0);
      const url = `http://localhost:${port}/render?t=${t}`;
      const outPath = output || '/tmp/visual-mcp-frame.png';
      const screenshotTool = 'C:/Users/hmk/tools/screenshot/screenshot.mjs';

      try {
        await access(screenshotTool);
      } catch {
        return {
          content: [{ type: 'text', text: `Screenshot tool not found at ${screenshotTool}. Open ${url} in browser instead.` }],
        };
      }

      return new Promise((resolve) => {
        execFile('node', [screenshotTool, url, '--output', outPath, '--width', String(state.scene.width || 1920), '--height', String(state.scene.height || 1080)], (err, stdout) => {
          if (err) {
            resolve({ content: [{ type: 'text', text: `Screenshot failed: ${err.message}. Open ${url} manually.` }] });
          } else {
            resolve({ content: [{ type: 'text', text: `Screenshot saved: ${stdout.trim() || outPath}` }] });
          }
        });
      });
    }
  );

  server.tool(
    'save_scene',
    'Save the current scene to a JSON file. Can be loaded later to restore the state.',
    {
      path: z.string().optional().describe('File path to save to (default: scenes/<adapter>-<timestamp>.json)'),
    },
    async ({ path: filePath }) => {
      const scenesDir = join(__dirname, '..', 'scenes');
      await mkdir(scenesDir, { recursive: true });

      const savePath = filePath || join(scenesDir, `${state.adapterName}-${Date.now()}.json`);
      await writeFile(savePath, JSON.stringify(state.scene, null, 2));

      return {
        content: [{ type: 'text', text: `Scene saved to: ${savePath}` }],
      };
    }
  );

  server.tool(
    'load_scene',
    'Load a scene from a JSON file, replacing the current state.',
    {
      path: z.string().describe('File path to load from'),
    },
    async ({ path: filePath }) => {
      try {
        const data = await readFile(filePath, 'utf-8');
        const scene = JSON.parse(data);
        bus.emit('mcp:scene-update', scene);
        // Replace entire scene, not merge
        Object.keys(state.scene).forEach(k => delete state.scene[k]);
        Object.assign(state.scene, scene);
        return {
          content: [{ type: 'text', text: `Scene loaded from: ${filePath}` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error loading scene: ${err.message}` }],
        };
      }
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

/**
 * Blender Preview Adapter
 *
 * Visual preview of Blender scenes via viewport screenshots.
 * Works alongside the Blender MCP — this adapter provides the visual
 * feedback layer while Blender MCP handles the actual 3D operations.
 *
 * Architecture:
 * - Blender MCP: creates objects, sets materials, controls the scene
 * - Visual MCP (this): shows viewport screenshots, handles user selection
 *
 * The user sees the Blender viewport in the browser, can click to select
 * objects, and describe changes. Claude uses both MCPs together.
 */

import { z } from 'zod';

export const name = 'blender';
export const description = 'Blender Preview — viewport screenshots + object selection';

export function initialScene() {
  return {
    lastScreenshot: null,  // base64 or file path
    selectedObject: null,
    objects: [],           // cached object list
    cameraAngle: 'front',
    autoRefresh: true,     // auto-refresh on changes
  };
}

export function registerTools(server, bus, state) {
  server.tool(
    'refresh_viewport',
    'Take a fresh screenshot of the Blender viewport and push it to the browser preview.',
    {},
    async () => {
      // This tool works by calling the Blender MCP's screenshot tool
      // and pushing the result to the browser
      bus.emit('mcp:command', { command: 'refresh-viewport', args: {} });

      return {
        content: [{
          type: 'text',
          text: 'Viewport refresh requested. Use the Blender MCP\'s get_viewport_screenshot tool, then call push_viewport_image with the result.',
        }],
      };
    }
  );

  server.tool(
    'push_viewport_image',
    'Push a viewport screenshot (file path or data URL) to the browser preview.',
    {
      imagePath: z.string().optional().describe('Path to screenshot PNG'),
      dataUrl: z.string().optional().describe('Base64 data URL of the screenshot'),
    },
    async ({ imagePath, dataUrl }) => {
      const src = dataUrl || (imagePath ? `file://${imagePath}` : null);
      if (!src) {
        return { content: [{ type: 'text', text: 'Provide either imagePath or dataUrl.' }] };
      }

      state.scene.lastScreenshot = src;
      bus.emit('mcp:scene-update', state.scene);
      bus.emit('mcp:command', { command: 'show-viewport', args: { src } });

      return {
        content: [{ type: 'text', text: 'Viewport image pushed to browser.' }],
      };
    }
  );

  server.tool(
    'set_object_list',
    'Update the cached list of Blender objects (for the element panel in the browser).',
    {
      objects: z.array(z.object({
        name: z.string(),
        type: z.string().optional(),
        visible: z.boolean().optional(),
      })).describe('List of objects in the scene'),
    },
    async ({ objects }) => {
      state.scene.objects = objects;
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Object list updated: ${objects.length} objects.` }],
      };
    }
  );

  server.tool(
    'set_camera_angle',
    'Set the camera angle label (for display purposes — actual camera control via Blender MCP).',
    {
      angle: z.string().describe('Camera angle description (e.g., "front", "top", "perspective")'),
    },
    async ({ angle }) => {
      state.scene.cameraAngle = angle;
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Camera angle label: ${angle}` }],
      };
    }
  );
}

export async function handleHttp(action, body, state) {
  switch (action) {
    case 'select-object':
      state.scene.selectedObject = body.name;
      return { ok: true };
    default:
      return { error: `Unknown action: ${action}` };
  }
}

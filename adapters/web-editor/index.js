/**
 * Web Editor Adapter
 *
 * Ember-style website editing via iframe preview.
 * Select elements, drag to reposition, double-click to edit text.
 * Works with any website URL — no build system required.
 */

import { z } from 'zod';

export const name = 'web-editor';
export const description = 'Website Editor — Ember-style visual editing of any web page';

export function initialScene() {
  return {
    url: '',
    editMode: false,
    selectedElement: null,
    changes: [], // { selector, property, oldValue, newValue, timestamp }
  };
}

export function registerTools(server, bus, state) {
  server.tool(
    'load_page',
    'Load a web page URL into the visual editor for inspection and editing.',
    {
      url: z.string().describe('URL to load (e.g., http://localhost:3000)'),
    },
    async ({ url }) => {
      state.scene.url = url;
      state.scene.changes = [];
      state.scene.selectedElement = null;
      bus.emit('mcp:scene-update', state.scene);
      bus.emit('mcp:command', { command: 'load-page', args: { url } });

      return {
        content: [{ type: 'text', text: `Page loaded: ${url}` }],
      };
    }
  );

  server.tool(
    'toggle_edit_mode',
    'Toggle edit mode on/off. When on, user can select, drag, and edit elements in the preview.',
    {},
    async () => {
      state.scene.editMode = !state.scene.editMode;
      bus.emit('mcp:scene-update', state.scene);
      bus.emit('mcp:command', { command: 'toggle-edit', args: { enabled: state.scene.editMode } });

      return {
        content: [{ type: 'text', text: `Edit mode: ${state.scene.editMode ? 'ON' : 'OFF'}` }],
      };
    }
  );

  server.tool(
    'inject_css',
    'Inject custom CSS into the loaded page.',
    {
      css: z.string().describe('CSS to inject'),
    },
    async ({ css }) => {
      bus.emit('mcp:command', { command: 'inject-css', args: { css } });
      return {
        content: [{ type: 'text', text: 'CSS injected.' }],
      };
    }
  );

  server.tool(
    'inject_script',
    'Run JavaScript in the loaded page context.',
    {
      script: z.string().describe('JavaScript to execute'),
    },
    async ({ script }) => {
      bus.emit('mcp:command', { command: 'inject-script', args: { script } });
      return {
        content: [{ type: 'text', text: 'Script injected.' }],
      };
    }
  );

  server.tool(
    'get_changes',
    'Get all changes the user made in the visual editor (text edits, moves, etc.).',
    {},
    async () => {
      const changes = state.scene.changes || [];
      if (changes.length === 0) {
        return { content: [{ type: 'text', text: 'No changes recorded.' }] };
      }

      const summary = changes.map((c, i) =>
        `${i + 1}. ${c.property}: "${(c.oldValue || '').slice(0, 50)}" → "${(c.newValue || '').slice(0, 50)}" (${c.selector})`
      ).join('\n');

      return {
        content: [{ type: 'text', text: summary }],
      };
    }
  );

  server.tool(
    'read_element',
    'Read the content and computed styles of an element by CSS selector.',
    {
      selector: z.string().describe('CSS selector'),
      properties: z.array(z.string()).optional().describe('CSS properties to read (default: all common ones)'),
    },
    async ({ selector, properties }) => {
      // This gets forwarded to the browser via command, response comes back via user input
      bus.emit('mcp:command', { command: 'read-element', args: { selector, properties } });
      return {
        content: [{ type: 'text', text: `Reading element "${selector}" — check get_user_input for the response.` }],
      };
    }
  );

  server.tool(
    'modify_element',
    'Modify an element\'s style or text content directly.',
    {
      selector: z.string().describe('CSS selector'),
      text: z.string().optional().describe('New text content'),
      style: z.record(z.string()).optional().describe('CSS properties to set (e.g., {"color": "red", "fontSize": "24px"})'),
    },
    async ({ selector, text, style }) => {
      const change = {
        selector,
        property: text !== undefined ? 'textContent' : 'style',
        oldValue: '', // Will be filled by browser
        newValue: text || JSON.stringify(style),
        timestamp: Date.now(),
      };
      state.scene.changes.push(change);

      bus.emit('mcp:command', { command: 'modify-element', args: { selector, text, style } });
      return {
        content: [{ type: 'text', text: `Element "${selector}" modified.` }],
      };
    }
  );

  server.tool(
    'navigate',
    'Navigate to a different URL or path within the loaded site.',
    {
      url: z.string().describe('URL or path to navigate to'),
    },
    async ({ url }) => {
      state.scene.url = url;
      bus.emit('mcp:command', { command: 'navigate', args: { url } });
      return {
        content: [{ type: 'text', text: `Navigating to: ${url}` }],
      };
    }
  );
}

export async function handleHttp(action, body, state) {
  switch (action) {
    case 'change':
      // Browser reports a user-initiated change
      if (body.selector && body.newValue !== undefined) {
        state.scene.changes.push({
          selector: body.selector,
          property: body.property || 'unknown',
          oldValue: body.oldValue || '',
          newValue: body.newValue,
          timestamp: Date.now(),
        });
      }
      return { ok: true };

    case 'selection':
      state.scene.selectedElement = body;
      return { ok: true };

    case 'changes':
      return { changes: state.scene.changes };

    default:
      return { error: `Unknown action: ${action}` };
  }
}

# Visual MCP

Interactive browser previews for Claude Code. Drag, select, and edit elements visually while AI builds.

Visual MCP bridges Claude Code's terminal with a browser-based visual editor. Each domain gets its own adapter with specialized tools and UI.

```
Claude Code ←→ MCP (stdio) ←→ Visual Server ←→ Browser Preview
                                     ↑
                               Adapter Plugin
```

## Quick Start

```bash
git clone https://github.com/Marlin-hi/visual-mcp.git
cd visual-mcp
npm install
```

### As MCP Server (recommended)

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "visual-mcp": {
      "command": "node",
      "args": ["/path/to/visual-mcp/server.js"],
      "env": {
        "VISUAL_MCP_ADAPTER": "motion",
        "VISUAL_MCP_PORT": "4200"
      }
    }
  }
}
```

Open `http://localhost:4200` in your browser. Tools are available in Claude Code automatically.

## Adapters

### Motion Graphics (default)

CSS/SVG-based animations with timeline, keyframes, and video export.

```
VISUAL_MCP_ADAPTER=motion
```

| Tool | What it does |
|---|---|
| `add_element` | Add text, shape, image, or SVG |
| `update_element` | Change element properties |
| `remove_element` | Delete element |
| `duplicate_element` | Clone with offset |
| `reorder_element` | Change layer order |
| `add_keyframe` | Animate properties over time |
| `set_timeline` | Play, pause, seek, reset |
| `set_scene` | Background, dimensions, duration |
| `list_elements` | Overview of all elements |
| `export_video` | Render to MP4 via FFmpeg |

### Web Editor

Ember-style visual editing of any web page via iframe.

```
VISUAL_MCP_ADAPTER=web-editor
```

| Tool | What it does |
|---|---|
| `load_page` | Load URL into iframe |
| `toggle_edit_mode` | Enable select/drag/edit overlay |
| `modify_element` | Change text or style by selector |
| `read_element` | Read element content and styles |
| `inject_css` | Add custom CSS |
| `inject_script` | Run JS in page context |
| `navigate` | Go to different URL |
| `get_changes` | List all user-made changes |

## Core Tools (all adapters)

| Tool | What it does |
|---|---|
| `get_viewport` | Current state + user selection |
| `get_user_selection` | What's selected in browser |
| `get_user_input` | Messages from browser input bar |
| `update_scene` | Push state to browser |
| `send_command` | Send adapter commands |
| `take_screenshot` | Capture canvas as PNG |
| `save_scene` / `load_scene` | Persist/restore state |

## Browser Interaction

- **Click** → Select (orange outline)
- **Drag** → Move selected element
- **Double-click** text → Edit inline
- **Scroll wheel** → Zoom canvas
- **Alt+drag** → Pan canvas
- **Space** → Play/pause
- **Arrow keys** → Nudge (Shift = 10px)
- **Delete** → Remove selected
- **F** → Fit canvas to view

## Writing Your Own Adapter

Create `adapters/<name>/index.js`:

```js
export const name = 'my-adapter';
export const description = 'What it does';

export function initialScene() {
  return { /* initial state */ };
}

export function registerTools(server, bus, state) {
  server.tool('my_tool', 'Description', { /* zod schema */ }, async (args) => {
    bus.emit('mcp:scene-update', state.scene);
    return { content: [{ type: 'text', text: 'Done' }] };
  });
}

export async function handleHttp(action, body, state) {
  return { ok: true };
}
```

Set `VISUAL_MCP_ADAPTER=my-adapter` to use it.

## License

MIT

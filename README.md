# Visual MCP

Interactive browser previews for Claude Code. Drag, select, and edit elements visually while AI builds.

Visual MCP bridges Claude Code's terminal with a browser-based visual editor. Each domain (motion graphics, video, web design) gets its own adapter with specialized tools and UI behavior.

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

Add to your Claude Code MCP config (`~/.claude/mcp.json`):

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

Then in Claude Code, the tools are available automatically. Open `http://localhost:4200` in your browser.

### Standalone

```bash
node server.js
# → Visual editor at http://localhost:4200
# → MCP server on stdio
```

## How It Works

**From Claude Code:** Use MCP tools to add elements, set animations, control the timeline.

**From the browser:** Click to select, drag to move, double-click text to edit inline. Type instructions in the input bar — they queue up for Claude to read via `get_user_input`.

**Everything syncs in real-time** via WebSocket.

## Core MCP Tools

| Tool | What it does |
|---|---|
| `get_viewport` | Current scene state + user selection |
| `get_user_selection` | What the user selected in the browser |
| `get_user_input` | Messages the user typed in the browser |
| `update_scene` | Push scene changes to the browser |
| `send_command` | Send adapter-specific commands |

## Motion Graphics Adapter

The default adapter. CSS/SVG-based animations with a timeline.

| Tool | What it does |
|---|---|
| `add_element` | Add text, shape, image, or SVG |
| `update_element` | Change element properties |
| `remove_element` | Delete an element |
| `add_keyframe` | Animate properties over time |
| `set_timeline` | Play, pause, seek, reset |
| `set_scene` | Background, dimensions, duration |
| `list_elements` | Overview of all elements |

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
    // Do something, update state.scene, emit via bus
    return { content: [{ type: 'text', text: 'Done' }] };
  });
}

export async function handleHttp(action, body, state) {
  return { ok: true };
}
```

Set `VISUAL_MCP_ADAPTER=my-adapter` to use it.

## Browser Interaction

- **Click** → Select element (orange outline)
- **Drag** selected element → Move it
- **Double-click** text → Edit inline
- **Input bar** → Send instructions to Claude
- **Timeline** → See keyframes, control playback
- **Properties panel** → Edit values directly

## License

MIT

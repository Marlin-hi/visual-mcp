/**
 * Visual MCP Framework — Main Server
 *
 * Runs two things in one process:
 * 1. Express server for the browser-based visual editor
 * 2. MCP server over stdio for Claude Code integration
 *
 * Communication between browser and MCP happens via an internal event bus.
 */

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { startMcpServer } from './lib/mcp.js';
import { loadAdapter } from './lib/adapter-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Event Bus (bridges MCP ↔ Browser) ---
const bus = new EventEmitter();
bus.setMaxListeners(50);

// --- State ---
const state = {
  adapter: null,
  adapterName: '',
  // Current canvas/scene state — adapter-specific
  scene: {},
  // User's current selection in the browser
  userSelection: null,
  // Queue of user inputs from the browser
  userInputs: [],
  // Connected WebSocket clients
  wsClients: new Set(),
};

// --- Express Server ---
const app = express();
const httpServer = createServer(app);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API: Get current state
app.get('/api/state', (req, res) => {
  res.json({
    adapter: state.adapterName,
    scene: state.scene,
    selection: state.userSelection,
  });
});

// API: User selected an element in the browser
app.post('/api/select', (req, res) => {
  state.userSelection = req.body;
  bus.emit('user:select', req.body);
  res.json({ ok: true });
});

// API: User moved an element
app.post('/api/move', (req, res) => {
  const { selector, dx, dy } = req.body;
  bus.emit('user:move', { selector, dx, dy });
  res.json({ ok: true });
});

// API: User edited text inline
app.post('/api/edit-text', (req, res) => {
  const { selector, oldText, newText } = req.body;
  bus.emit('user:edit-text', { selector, oldText, newText });
  res.json({ ok: true });
});

// API: User sent a message/instruction from browser
app.post('/api/input', (req, res) => {
  const { message } = req.body;
  state.userInputs.push({ message, timestamp: Date.now() });
  bus.emit('user:input', { message });
  res.json({ ok: true });
});

// API: Get pending user inputs (polled by MCP)
app.get('/api/inputs', (req, res) => {
  const inputs = state.userInputs.splice(0);
  res.json(inputs);
});

// API: Push scene update from MCP to browser
app.post('/api/scene', (req, res) => {
  state.scene = { ...state.scene, ...req.body };
  broadcastWs({ type: 'scene:update', data: state.scene });
  res.json({ ok: true });
});

// API: Render-only view (for screenshots — no UI chrome, just canvas)
app.get('/render', (req, res) => {
  const time = parseInt(req.query.t || '0', 10);
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; overflow: hidden; }
.canvas { position: relative; width: ${state.scene.width || 1920}px; height: ${state.scene.height || 1080}px; background: ${state.scene.background || '#0a0a0f'}; }
.el { position: absolute; }
</style>
</head><body>
<div class="canvas" id="canvas"></div>
<script>
const scene = ${JSON.stringify(state.scene)};
const renderTime = ${time};
const canvas = document.getElementById('canvas');

function easeProgress(t, easing) {
  switch (easing) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return t * (2 - t);
    default: return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

for (const el of (scene.elements || [])) {
  const div = document.createElement('div');
  div.className = 'el';
  const p = el.props || {};
  div.style.left = (p.x||0)+'px';
  div.style.top = (p.y||0)+'px';
  if (p.width) div.style.width = p.width+'px';
  if (p.height) div.style.height = p.height+'px';
  if (p.opacity !== undefined) div.style.opacity = p.opacity;
  if (p.rotation) div.style.transform = 'rotate('+p.rotation+'deg)';
  if (p.zIndex) div.style.zIndex = p.zIndex;

  if (el.type === 'text') {
    div.textContent = p.text || '';
    div.style.fontSize = (p.fontSize||48)+'px';
    div.style.fontFamily = p.fontFamily || 'Inter, system-ui';
    div.style.color = p.color || '#fff';
    div.style.whiteSpace = 'pre-wrap';
    if (p.backgroundColor) div.style.backgroundColor = p.backgroundColor;
  } else if (el.type === 'shape') {
    div.style.backgroundColor = p.color || '#f97316';
    if (p.gradient) div.style.background = p.gradient;
    if (p.shape==='circle'||p.shape==='ellipse') div.style.borderRadius='50%';
    else div.style.borderRadius = (p.borderRadius||0)+'px';
    if (!p.width) div.style.width='100px';
    if (!p.height) div.style.height='100px';
  } else if (el.type === 'svg' && p.svgContent) {
    div.innerHTML = p.svgContent;
  }
  if (p.blur) div.style.filter = 'blur('+p.blur+'px)';
  if (p.shadow) div.style.boxShadow = p.shadow;

  // Apply keyframes at renderTime
  const kfs = el.keyframes || [];
  if (kfs.length > 0) {
    let before = null, after = null;
    for (const kf of kfs) {
      if (kf.time <= renderTime) before = kf;
      if (kf.time > renderTime && !after) after = kf;
    }
    const apply = (props) => {
      if (props.x !== undefined) div.style.left = props.x+'px';
      if (props.y !== undefined) div.style.top = props.y+'px';
      if (props.opacity !== undefined) div.style.opacity = props.opacity;
      if (props.rotation !== undefined) div.style.transform = 'rotate('+props.rotation+'deg)';
      if (props.fontSize !== undefined) div.style.fontSize = props.fontSize+'px';
      if (props.width !== undefined) div.style.width = props.width+'px';
      if (props.height !== undefined) div.style.height = props.height+'px';
      if (props.color !== undefined) {
        if (el.type==='text') div.style.color = props.color;
        else div.style.backgroundColor = props.color;
      }
      if (props.blur !== undefined) div.style.filter = 'blur('+props.blur+'px)';
    };
    if (before && !after) apply(before.props);
    else if (before && after) {
      const progress = (renderTime - before.time) / (after.time - before.time);
      const eased = easeProgress(progress, after.easing || 'ease');
      const interp = {};
      for (const k of Object.keys(after.props)) {
        const from = before.props[k] ?? p[k];
        const to = after.props[k];
        if (typeof from === 'number' && typeof to === 'number')
          interp[k] = from + (to - from) * eased;
        else interp[k] = progress < 0.5 ? from : to;
      }
      apply(interp);
    }
  }

  canvas.appendChild(div);
}
</script>
</body></html>`);
});

// API: Adapter-specific endpoints
app.all('/api/adapter/:action', async (req, res) => {
  if (!state.adapter) {
    return res.status(400).json({ error: 'No adapter loaded' });
  }
  try {
    const result = await state.adapter.handleHttp(req.params.action, req.body, state);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WebSocket (real-time browser ↔ server) ---
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  state.wsClients.add(ws);

  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      adapter: state.adapterName,
      scene: state.scene,
    },
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleWsMessage(msg);
    } catch {}
  });

  ws.on('close', () => {
    state.wsClients.delete(ws);
  });
});

function broadcastWs(msg) {
  const data = JSON.stringify(msg);
  for (const ws of state.wsClients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'select':
      state.userSelection = msg.data;
      bus.emit('user:select', msg.data);
      break;
    case 'move': {
      // Update scene state so MCP tools see the new position
      const el = state.scene.elements?.find(e => e.id === msg.data.id);
      if (el) {
        if (msg.data.x !== undefined) el.props.x = msg.data.x;
        if (msg.data.y !== undefined) el.props.y = msg.data.y;
        // Support updating any prop via move
        for (const [k, v] of Object.entries(msg.data)) {
          if (k !== 'id') el.props[k] = v;
        }
      }
      bus.emit('user:move', msg.data);
      break;
    }
    case 'edit-text': {
      // Update text in scene state
      const el = state.scene.elements?.find(e => e.id === msg.data.id);
      if (el && msg.data.newText) {
        el.props.text = msg.data.newText;
      }
      bus.emit('user:edit-text', msg.data);
      break;
    }
    case 'input':
      state.userInputs.push({ message: msg.data.message, timestamp: Date.now() });
      bus.emit('user:input', msg.data);
      break;
  }
}

// --- MCP → Browser: push updates ---
bus.on('mcp:scene-update', (data) => {
  state.scene = { ...state.scene, ...data };
  broadcastWs({ type: 'scene:update', data: state.scene });
});

bus.on('mcp:command', (cmd) => {
  broadcastWs({ type: 'command', data: cmd });
});

// --- Start ---
const PORT = parseInt(process.env.VISUAL_MCP_PORT || '4200', 10);
const ADAPTER = process.env.VISUAL_MCP_ADAPTER || 'motion';

async function start() {
  // Load adapter
  const adapter = await loadAdapter(ADAPTER, join(__dirname, 'adapters'));
  state.adapter = adapter;
  state.adapterName = ADAPTER;
  state.scene = adapter.initialScene?.() || {};

  // Start HTTP + WebSocket server
  httpServer.listen(PORT, () => {
    // Only log to stderr to keep stdio clean for MCP
    process.stderr.write(`Visual MCP server running on http://localhost:${PORT}\n`);
    process.stderr.write(`Adapter: ${ADAPTER}\n`);
  });

  // Start MCP server over stdio
  await startMcpServer(bus, state, adapter);
}

start().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});

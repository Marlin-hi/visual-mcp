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
    case 'move':
      bus.emit('user:move', msg.data);
      break;
    case 'edit-text':
      bus.emit('user:edit-text', msg.data);
      break;
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

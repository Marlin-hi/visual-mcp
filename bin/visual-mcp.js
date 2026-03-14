#!/usr/bin/env node

/**
 * Visual MCP — CLI entry point
 *
 * Usage:
 *   visual-mcp                    # Start with default adapter (motion)
 *   visual-mcp --adapter motion   # Specify adapter
 *   visual-mcp --port 4200        # Specify port
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--adapter' && args[i + 1]) {
    process.env.VISUAL_MCP_ADAPTER = args[++i];
  }
  if (args[i] === '--port' && args[i + 1]) {
    process.env.VISUAL_MCP_PORT = args[++i];
  }
}

// Import and run the server
await import(join(__dirname, '..', 'server.js'));

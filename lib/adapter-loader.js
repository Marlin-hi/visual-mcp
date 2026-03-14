/**
 * Adapter Loader — dynamically loads domain-specific adapters
 *
 * Each adapter is a directory in adapters/ with an index.js that exports:
 * - name: string
 * - description: string
 * - initialScene(): object — initial scene state
 * - registerTools(server, bus, state): void — register MCP tools
 * - handleHttp(action, body, state): Promise<object> — handle HTTP API calls
 * - clientScript: string (optional) — path to client-side JS to inject
 */

import { join } from 'node:path';
import { access } from 'node:fs/promises';

export async function loadAdapter(name, adaptersDir) {
  const adapterPath = join(adaptersDir, name, 'index.js');

  try {
    await access(adapterPath);
  } catch {
    throw new Error(`Adapter "${name}" not found at ${adapterPath}`);
  }

  const adapter = await import(`file://${adapterPath.replace(/\\/g, '/')}`);

  // Validate required exports
  if (!adapter.name) throw new Error(`Adapter "${name}" must export "name"`);

  return {
    name: adapter.name,
    description: adapter.description || '',
    initialScene: adapter.initialScene || (() => ({})),
    registerTools: adapter.registerTools || null,
    handleHttp: adapter.handleHttp || (async () => ({ error: 'Not implemented' })),
    clientScript: adapter.clientScript || null,
  };
}

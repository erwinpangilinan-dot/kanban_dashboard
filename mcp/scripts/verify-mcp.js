#!/usr/bin/env node
/**
 * Verifies Mission Control MCP server starts and responds to protocol messages.
 * Run: node mcp/scripts/verify-mcp.js
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mcpDir = path.dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const serverPath = path.join(mcpDir, 'src/index.js');

function send(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function readLines(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) onLine(JSON.parse(line));
    }
  });
}

const proc = spawn('node', [serverPath], {
  cwd: mcpDir,
  env: { ...process.env, MISSION_CONTROL_API_URL: 'http://localhost/api' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const responses = [];
readLines(proc.stdout, (msg) => responses.push(msg));

const timeout = setTimeout(() => {
  console.error('✗ MCP verify timed out');
  proc.kill();
  process.exit(1);
}, 10000);

proc.on('exit', (code) => {
  clearTimeout(timeout);
  if (code !== 0 && code !== null) process.exit(code ?? 1);
});

// MCP handshake
send(proc, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify-mcp', version: '1.0.0' },
  },
});

setTimeout(() => {
  send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
  send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
}, 300);

setTimeout(() => {
  const init = responses.find((r) => r.id === 1);
  const tools = responses.find((r) => r.id === 2);

  if (!init?.result?.serverInfo?.name) {
    console.error('✗ initialize failed:', JSON.stringify(init));
    proc.kill();
    process.exit(1);
  }
  console.log('✓ MCP initialize:', init.result.serverInfo.name, init.result.serverInfo.version);

  const toolNames = tools?.result?.tools?.map((t) => t.name) ?? [];
  if (toolNames.length < 10) {
    console.error('✗ tools/list failed or too few tools:', toolNames);
    proc.kill();
    process.exit(1);
  }
  console.log('✓ MCP tools/list:', toolNames.length, 'tools');
  console.log('  ', toolNames.join(', '));

  proc.kill();
  clearTimeout(timeout);
  console.log('\nMCP verification passed.');
  process.exit(0);
}, 1500);

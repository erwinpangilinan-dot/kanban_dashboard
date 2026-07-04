#!/usr/bin/env node
/**
 * Run manage_accounts authenticate against google-workspace MCP.
 * Usage: node mcp/scripts/authenticate-google.js
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = path.join(root, 'mcp/run-google-workspace.sh');

function send(proc, msg) {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}

function readMessages(stream, onMessage) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) onMessage(JSON.parse(line));
    }
  });
}

const proc = spawn('bash', [launcher], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

proc.stderr.on('data', (chunk) => process.stderr.write(chunk));

const responses = [];
readMessages(proc.stdout, (msg) => {
  responses.push(msg);
  if (msg.result?.content) {
    for (const part of msg.result.content) {
      if (part.type === 'text') process.stdout.write(`\n${part.text}\n`);
    }
  }
  if (msg.error) {
    process.stderr.write(`\nMCP error: ${JSON.stringify(msg.error, null, 2)}\n`);
  }
});

function waitFor(id, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const hit = responses.find((r) => r.id === id);
      if (hit) return resolve(hit);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for response id=${id}`));
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

send(proc, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'authenticate-google', version: '1.0.0' },
  },
});

await new Promise((r) => setTimeout(r, 500));
send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
send(proc, {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'manage_accounts',
    arguments: { operation: 'authenticate' },
  },
});

try {
  const result = await waitFor(2, 300000);
  if (result.error) {
    console.error('Authentication failed:', result.error.message || result.error);
    proc.kill();
    process.exit(1);
  }

  const text = result.result?.content?.map((c) => c.text).join('\n') ?? '';
  if (/redirect|paste|http/i.test(text)) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question('\nPaste redirect URL here (or press Enter if browser flow finished): ', resolve));
    rl.close();
  }

  console.log('\nDone. Restart Cursor if google-workspace MCP was not already connected.');
  proc.kill();
  process.exit(0);
} catch (err) {
  console.error(`✗ ${err.message}`);
  proc.kill();
  process.exit(1);
}

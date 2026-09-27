#!/usr/bin/env node
import { spawn } from 'node:child_process';

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) {
  console.error('DAP_SUPERVISOR_BRIDGE_COMMAND_REQUIRED');
  process.exit(2);
}

let seq = 1;
let buffer = Buffer.alloc(0);
let disconnecting = false;
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const writeFrame = (message) => {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
};

const finishDisconnect = (request) => {
  if (disconnecting) return;
  disconnecting = true;
  writeFrame({
    seq: seq++,
    type: 'response',
    request_seq: request.seq,
    command: 'disconnect',
    success: true,
    body: {},
  });
  console.error('[debugai-dap-supervisor-bridge] DISCONNECT_DELEGATED_TO_SANDBOX_SUPERVISOR');
  process.stdout.write('', () => process.exit(0));
};

const accept = (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      console.error('[debugai-dap-supervisor-bridge] INVALID_DAP_HEADER');
      process.exit(3);
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const frame = buffer.subarray(0, bodyStart + length);
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.subarray(bodyStart + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch (error) {
      console.error(`[debugai-dap-supervisor-bridge] INVALID_DAP_JSON:${error}`);
      process.exit(4);
    }
    if (message?.type === 'request' && message.command === 'disconnect') {
      finishDisconnect(message);
      return;
    }
    if (!disconnecting) child.stdin.write(frame);
  }
};

process.stdin.on('data', accept);
process.stdin.on('end', () => {
  try { child.stdin.end(); } catch {}
});
child.stdout.on('data', chunk => {
  if (!disconnecting) process.stdout.write(chunk);
});
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => {
  console.error(`[debugai-dap-supervisor-bridge] CHILD_ERROR:${error.message}`);
  if (!disconnecting) process.exit(5);
});
child.on('exit', (code, signal) => {
  if (disconnecting) return;
  if (signal) console.error(`[debugai-dap-supervisor-bridge] CHILD_SIGNAL:${signal}`);
  process.exit(Number.isInteger(code) ? code : 6);
});

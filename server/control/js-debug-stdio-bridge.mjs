#!/usr/bin/env node
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const entry = process.argv[2] ? path.resolve(process.argv[2]) : '';
const startTimeoutMs = Number(process.env.DEBUGAI_DAP_BRIDGE_TIMEOUT_MS || 15000);
const requestTimeoutMs = Number(process.env.DEBUGAI_DAP_REQUEST_TIMEOUT_MS || 45000);
if (!entry || !fs.existsSync(entry)) {
  console.error('JS_DEBUG_ENTRY_NOT_FOUND');
  process.exit(2);
}

const log = (message) => console.error(`[debugai-js-debug-proxy] ${message}`);
const normalizeSourceKey = (source = {}) => {
  const value = String(source.path || source.name || source.sourceReference || '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
};

class DapPeer {
  constructor(socket, label, owner) {
    this.socket = socket;
    this.label = label;
    this.owner = owner;
    this.seq = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    socket.on('data', chunk => this.accept(chunk));
    socket.on('error', error => this.failAll(error));
    socket.on('close', () => {
      this.closed = true;
      this.failAll(new Error(`DAP_PEER_CLOSED:${label}`));
    });
  }
  send(message) { const payload = Buffer.from(JSON.stringify(message), 'utf8'); this.socket.write(`Content-Length: ${payload.length}\r\n\r\n`); this.socket.write(payload); }
  request(command, args = {}, timeoutMs = requestTimeoutMs) {
    const seq = this.seq++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`DAP_REQUEST_TIMEOUT:${this.label}:${command}`)); }, timeoutMs);
      this.pending.set(seq, { command, resolve, reject, timer });
    });
    void promise.catch(() => {});
    this.send({ seq, type: 'request', command, arguments: args });
    return promise;
  }
  accept(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n'); if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii'); const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { this.owner.fatal(new Error(`DAP_HEADER_INVALID:${this.label}`)); return; }
      const length = Number(match[1]), bodyStart = headerEnd + 4; if (this.buffer.length < bodyStart + length) return;
      const raw = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8'); this.buffer = this.buffer.subarray(bodyStart + length);
      let message; try { message = JSON.parse(raw); } catch (error) { this.owner.fatal(new Error(`DAP_JSON_INVALID:${this.label}:${error}`)); return; }
      void this.dispatch(message);
    }
  }
  async dispatch(message) {
    if (message.type === 'response' && message.request_seq !== undefined) {
      const pending = this.pending.get(message.request_seq); if (!pending) return; this.pending.delete(message.request_seq); clearTimeout(pending.timer);
      if (message.success === false) pending.reject(new Error(message.message || `DAP_REQUEST_FAILED:${pending.command}`)); else pending.resolve(message.body ?? {}); return;
    }
    if (message.type === 'event' && message.event) { this.owner.onInternalEvent(this, message); return; }
    if (message.type === 'request' && message.command) await this.owner.handleReverseRequest(this, message);
  }
  failAll(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  close() { this.failAll(new Error(`DAP_PEER_CLOSED:${this.label}`)); try { this.socket.end(); } catch {} try { this.socket.destroy(); } catch {} }
}

class MultiSessionProxy {
  constructor() {
    this.serverProcess = null; this.host = '127.0.0.1'; this.port = null; this.root = null; this.targets = new Set(); this.activeTarget = null; this.childSeq = 0; this.externalSeq = 1; this.externalBuffer = Buffer.alloc(0); this.initializeArgs = null; this.breakpointRequests = new Map(); this.exceptionBreakpoints = null; this.customBreakpoints = null; this.debuggees = new Set(); this.closing = false; this.closePromise = null; this.disconnecting = false;
  }
  sendExternal(message) { const payload = Buffer.from(JSON.stringify(message), 'utf8'); process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`); process.stdout.write(payload); }
  respondExternal(request, body = {}, success = true, message = undefined) { this.sendExternal({ seq: this.externalSeq++, type: 'response', request_seq: request.seq, command: request.command, success, ...(success ? { body } : { message: String(message || 'DAP proxy request failed') }) }); }
  forwardEvent(message) { this.sendExternal({ seq: this.externalSeq++, type: 'event', event: message.event, body: message.body ?? {} }); }
  fatal(error) { log(`FATAL=${String(error?.stack || error)}`); this.close(7); }
  async start() {
    let stdoutBuffer = '', resolveReady, rejectReady; const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const timer = setTimeout(() => rejectReady(new Error('JS_DEBUG_PROXY_START_TIMEOUT')), Number.isFinite(startTimeoutMs) && startTimeoutMs > 0 ? startTimeoutMs : 15000);
    this.serverProcess = spawn(process.execPath, [entry, '0', this.host], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    this.serverProcess.stdout.on('data', chunk => { stdoutBuffer += String(chunk || ''); const lines = stdoutBuffer.split(/\r?\n/); stdoutBuffer = lines.pop() || ''; for (const line of lines) { if (!line.trim()) continue; const match = line.match(/Debug server listening at\s+(.+):(\d+)\s*$/i); if (match && !this.port) { this.host = match[1].replace(/^::ffff:/, '') || '127.0.0.1'; this.port = Number(match[2]); clearTimeout(timer); resolveReady(); } else log(`js-debug stdout: ${line.trim()}`); } });
    this.serverProcess.stderr.on('data', chunk => { const text = String(chunk || '').trimEnd(); if (text) log(`js-debug stderr: ${text}`); });
    this.serverProcess.on('error', error => rejectReady(error)); this.serverProcess.on('exit', (code, signal) => { if (!this.closing && !this.disconnecting) this.fatal(new Error(`JS_DEBUG_SERVER_EXIT:${code}:${signal || ''}`)); });
    await ready; this.root = await this.connectPeer('root'); log(`READY=${this.host}:${this.port}`);
  }
  async connectPeer(label) { const socket = net.createConnection({ host: this.host, port: this.port }); await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`DAP_CONNECT_TIMEOUT:${label}`)), 10000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('error', error => { clearTimeout(timer); reject(error); }); }); socket.setNoDelay(true); return new DapPeer(socket, label, this); }
  acceptExternal(chunk) {
    this.externalBuffer = Buffer.concat([this.externalBuffer, chunk]);
    while (true) { const headerEnd = this.externalBuffer.indexOf('\r\n\r\n'); if (headerEnd < 0) return; const header = this.externalBuffer.subarray(0, headerEnd).toString('ascii'); const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header); if (!match) return this.fatal(new Error('EXTERNAL_DAP_HEADER_INVALID')); const length = Number(match[1]), bodyStart = headerEnd + 4; if (this.externalBuffer.length < bodyStart + length) return; const raw = this.externalBuffer.subarray(bodyStart, bodyStart + length).toString('utf8'); this.externalBuffer = this.externalBuffer.subarray(bodyStart + length); let request; try { request = JSON.parse(raw); } catch (error) { return this.fatal(new Error(`EXTERNAL_DAP_JSON_INVALID:${error}`)); } if (request.type === 'request' && request.command) void this.handleExternalRequest(request); }
  }
  choosePeer(command) { const rootCommands = new Set(['initialize', 'launch', 'attach', 'configurationDone', 'disconnect', 'terminate', 'restart']); if (rootCommands.has(command)) return this.root; return this.activeTarget || this.root; }
  recordBreakpoint(args) { const source = args?.source || {}, key = normalizeSourceKey(source); if (key) this.breakpointRequests.set(key, structuredClone(args)); }
  finishDisconnect(request) {
    if (this.disconnecting) { this.respondExternal(request, {}); return; }
    this.disconnecting = true;
    this.respondExternal(request, {});
    log('DISCONNECT_DELEGATED_TO_SANDBOX_SUPERVISOR');
    for (const target of this.targets) { try { target.close(); } catch {} }
    this.targets.clear();
    try { this.root?.close(); } catch {}
    setImmediate(() => process.exit(0));
  }
  async handleExternalRequest(request) {
    try {
      if (!this.root) throw new Error('JS_DEBUG_PROXY_ROOT_NOT_READY');
      if (request.command === 'disconnect') { this.finishDisconnect(request); return; }
      let args = request.arguments && typeof request.arguments === 'object' ? { ...request.arguments } : {};
      if (request.command === 'initialize') { this.initializeArgs = { ...args, supportsStartDebuggingRequest: true, supportsRunInTerminalRequest: true }; const body = await this.root.request('initialize', this.initializeArgs); this.respondExternal(request, body); return; }
      if (request.command === 'setBreakpoints') this.recordBreakpoint(args);
      if (request.command === 'setExceptionBreakpoints') this.exceptionBreakpoints = structuredClone(args);
      if (request.command === 'setCustomBreakpoints') this.customBreakpoints = structuredClone(args);
      if (request.command === 'launch' && args.autoAttachChildProcesses === undefined) args = { ...args, autoAttachChildProcesses: false };
      const peer = this.choosePeer(request.command), body = await peer.request(request.command, args);
      this.respondExternal(request, body);
    } catch (error) { this.respondExternal(request, {}, false, error?.message || error); }
  }
  onInternalEvent(peer, message) { if (peer !== this.root && message.event === 'initialized') return; if (peer === this.root && message.event !== 'initialized' && this.activeTarget && ['thread', 'stopped', 'continued', 'breakpoint', 'process', 'output'].includes(message.event)) return; this.forwardEvent(message); }
  async handleReverseRequest(peer, request) {
    const response = { seq: peer.seq++, type: 'response', request_seq: request.seq, command: request.command, success: true, body: {} };
    try { if (request.command === 'startDebugging') await this.startTargetSession(request.arguments || {}); else if (request.command === 'runInTerminal') response.body = await this.runInTerminal(request.arguments || {}); else throw new Error(`UNSUPPORTED_REVERSE_REQUEST:${request.command}`); } catch (error) { response.success = false; response.message = String(error?.message || error); delete response.body; }
    peer.send(response);
  }
  async runInTerminal(args) {
    const argv = Array.isArray(args.args) ? args.args.map(String) : []; if (!argv.length) throw new Error('RUN_IN_TERMINAL_ARGS_MISSING'); const env = { ...process.env, ...(args.env && typeof args.env === 'object' ? args.env : {}) }; for (const [key, value] of Object.entries(env)) if (value === null || value === undefined) delete env[key];
    const child = spawn(argv[0], argv.slice(1), { cwd: typeof args.cwd === 'string' ? args.cwd : process.cwd(), env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); this.debuggees.add(child); child.stdout?.on('data', chunk => log(`debuggee stdout: ${String(chunk).trimEnd()}`)); child.stderr?.on('data', chunk => log(`debuggee stderr: ${String(chunk).trimEnd()}`)); await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.once('exit', () => this.debuggees.delete(child)); return { processId: child.pid };
  }
  async startTargetSession(args) {
    if (!this.initializeArgs) throw new Error('START_DEBUGGING_BEFORE_INITIALIZE'); const configuration = args.configuration && typeof args.configuration === 'object' ? { ...args.configuration } : {}; const request = String(args.request || configuration.request || 'launch'); if (!configuration.__pendingTargetId) throw new Error('START_DEBUGGING_PENDING_TARGET_MISSING'); if (request !== 'launch' && request !== 'attach') throw new Error(`START_DEBUGGING_REQUEST_INVALID:${request}`);
    const target = await this.connectPeer(`target-${++this.childSeq}`); this.targets.add(target); this.activeTarget = target;
    const initialized = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('TARGET_INITIALIZED_TIMEOUT')), 30000); const original = this.onInternalEvent.bind(this); const hook = (peer, message) => { original(peer, message); if (peer === target && message.event === 'initialized') { clearTimeout(timeout); this.onInternalEvent = original; resolve(); } }; this.onInternalEvent = hook; });
    const capabilities = await target.request('initialize', this.initializeArgs); await initialized; if (this.exceptionBreakpoints) await target.request('setExceptionBreakpoints', this.exceptionBreakpoints); for (const breakpoint of this.breakpointRequests.values()) await target.request('setBreakpoints', breakpoint); if (this.customBreakpoints) await target.request('setCustomBreakpoints', this.customBreakpoints); if (capabilities.supportsConfigurationDoneRequest === true) await target.request('configurationDone', {}); await target.request(request, { ...configuration, request }); log(`TARGET_SESSION_READY=${target.label}|BREAKPOINT_FILES=${this.breakpointRequests.size}`);
  }
  waitChildExit(child, timeoutMs = 5000) { if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true); return new Promise(resolve => { let done = false; const finish = value => { if (done) return; done = true; clearTimeout(timer); child.off('exit', onExit); child.off('close', onExit); resolve(value); }; const onExit = () => finish(true); const timer = setTimeout(() => finish(false), timeoutMs); child.once('exit', onExit); child.once('close', onExit); }); }
  async terminateChild(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; try { child.kill(); } catch {} if (await this.waitChildExit(child, 5000)) return; try { child.kill('SIGKILL'); } catch {} await this.waitChildExit(child, 2500); }
  close(code = 0) { if (code) process.exitCode = code; if (this.closePromise) return this.closePromise; this.closing = true; this.closePromise = (async () => { const debuggees = [...this.debuggees]; this.debuggees.clear(); for (const target of this.targets) { try { target.close(); } catch {} } this.targets.clear(); try { this.root?.close(); } catch {} await Promise.all(debuggees.map(child => this.terminateChild(child))); await this.terminateChild(this.serverProcess); })(); return this.closePromise; }
}

const proxy = new MultiSessionProxy();
try { await proxy.start(); } catch (error) { log(`START_FAILED=${String(error?.stack || error)}`); await proxy.close(3); }
if (!process.exitCode) { process.stdin.on('data', chunk => proxy.acceptExternal(chunk)); process.stdin.on('end', () => { void proxy.close(0).finally(() => process.exit(0)); }); process.stdin.on('close', () => { void proxy.close(0).finally(() => process.exit(0)); }); process.stdin.resume(); }
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { void proxy.close(0).finally(() => process.exit(0)); });
process.on('exit', () => { try { proxy.serverProcess?.kill(); } catch {} for (const child of proxy.debuggees) { try { child.kill(); } catch {} } });

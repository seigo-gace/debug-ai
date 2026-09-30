import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXPOSED_TOOLS,
  buildCliArgs,
  createDebugAIMcpServer,
  invokeDebugAITool,
} from '../server.mjs';

test('MCP surface exposes guarded tools but no approve/apply shortcut', () => {
  assert.deepEqual(EXPOSED_TOOLS, [
    'debugai_health',
    'debugai_analyze',
    'debugai_start',
    'debugai_resume',
    'debugai_wait',
    'debugai_patch_candidate',
    'debugai_verify',
    'debugai_status',
    'debugai_inspect',
  ]);
  assert.equal(EXPOSED_TOOLS.some((name) => /approve|apply/i.test(name)), false);
});

test('MCP inputs map to existing CLI contract without a second workflow', () => {
  assert.deepEqual(buildCliArgs('debugai_analyze', {
    request: 'find the failure', repo: '/repo/a', run_id: 'run-1',
  }), ['analyze', 'find the failure', '--repo', '/repo/a', '--run-id', 'run-1']);

  assert.deepEqual(buildCliArgs('debugai_patch_candidate', {
    purpose: 'fix root cause', run_id: 'run-2', paths: ['a.js', 'b.js'],
  }), ['patch', 'fix root cause', '--run-id', 'run-2', '--paths', 'a.js,b.js']);

  assert.deepEqual(buildCliArgs('debugai_verify', {
    repo: '/repo/a', task: 'verify fix', paths: ['a.js'], change_scope: ['a.js', 'test/a.test.js'],
  }), ['verify', '--repo', '/repo/a', 'verify fix', '--paths', 'a.js', '--change-scope', 'a.js,test/a.test.js']);
});

test('MCP invocation delegates to existing execute function and returns structured text', async () => {
  const calls = [];
  const execute = async (args, options) => {
    calls.push({ args, options });
    return { exitCode: 0, result: { ok: true, delegated: true } };
  };
  const result = await invokeDebugAITool('debugai_health', {}, { execute, env: { X: '1' }, cwd: '/tmp/repo' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['health']);
  assert.equal(calls[0].options.cwd, '/tmp/repo');
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.schema, 'debugai.mcp-result/v1');
  assert.equal(payload.result.delegated, true);
});

test('MCP invocation fail-closes execution errors', async () => {
  const result = await invokeDebugAITool('debugai_status', { run_id: 'run-x' }, {
    execute: async () => { throw new Error('BOOM'); },
  });
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.schema, 'debugai.mcp-error/v1');
  assert.equal(payload.error, 'BOOM');
});

test('MCP server factory constructs with the registered tool surface', () => {
  const server = createDebugAIMcpServer({
    execute: async () => ({ exitCode: 0, result: { ok: true } }),
  });
  assert.ok(server);
  assert.equal(typeof server.registerTool, 'function');
});

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
    'debugai_server_read',
    'debugai_server_status',
    'debugai_gitops_request',
    'debugai_gitops_status',
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

test('control tools delegate exact structured contracts and fail closed', async () => {
  const cases = [
    ['debugai_server_read', 'server-command', 'request', { command_id: 'github.gh_read', repo: '/workspace/debug-ai', arguments: ['pr', 'view', '40'] }],
    ['debugai_server_status', 'server-command', 'status', { id: 'cmd_abc' }],
    ['debugai_gitops_request', 'gitops', 'request', { action: 'publish', human_approved: false, repo: '/workspace/debug-ai', expected_head: 'a'.repeat(40), files: ['a.js'], candidate_id: 'patch_x', candidate_hash: 'b'.repeat(64) }],
    ['debugai_gitops_status', 'gitops', 'status', { repo: '/workspace/debug-ai', id: 'gitops_abc' }],
  ];
  for (const [name, command, operation, input] of cases) {
    const expected = [command, operation, '--input-json', JSON.stringify(input)];
    assert.deepEqual(buildCliArgs(name, input), expected);
    const result = await invokeDebugAITool(name, input, { execute: async args => {
      assert.deepEqual(args, expected);
      throw new Error('SERVICE_REJECTED');
    } });
    assert.equal(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).error, 'SERVICE_REJECTED');
  }
  const result = await invokeDebugAITool('debugai_server_read', { command_id: 'project.pwd' }, {
    execute: async () => ({ exitCode: 1, result: { error: 'FAIL' } }),
  });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).exit_code, 1);
  const originalVerify = await invokeDebugAITool('debugai_verify', { repo: '/workspace/debug-ai' }, {
    execute: async () => ({ exitCode: 2, result: { verdict: 'UNKNOWN' } }),
  });
  assert.equal(originalVerify.isError, undefined);
  assert.equal(JSON.parse(originalVerify.content[0].text).exit_code, 2);
});

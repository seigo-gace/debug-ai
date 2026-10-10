import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCliArgs, invokeDebugAITool } from '../server.mjs';

test('MCP durable continuation tools map to the existing explicit-run CLI contract', () => {
  assert.deepEqual(buildCliArgs('debugai_start', {
    request: 'find the durable failure', repo: '/repo/a',
  }), ['start', 'find the durable failure', '--repo', '/repo/a']);
  assert.deepEqual(buildCliArgs('debugai_resume', { run_id: 'run-42' }), [
    'resume', '--run-id', 'run-42',
  ]);
  assert.deepEqual(buildCliArgs('debugai_wait', {
    run_id: 'run-42', interval_ms: 250, timeout_ms: 120000,
  }), ['wait', 'run-42', '--interval-ms', '250', '--timeout-ms', '120000']);
  assert.deepEqual(buildCliArgs('debugai_status', { run_id: 'run-42' }), [
    'status', 'run-42',
  ]);
  assert.deepEqual(buildCliArgs('debugai_inspect', { run_id: 'run-42' }), [
    'inspect', 'run-42',
  ]);
});

test('MCP continuation keeps one explicit run id across start status resume wait inspect', async () => {
  const calls = [];
  const execute = async (args) => {
    calls.push(args);
    const command = args[0];
    if (command === 'start') return { exitCode: 0, result: { run_id: 'run-42', state: 'RUNNING' } };
    if (command === 'status') return { exitCode: 0, result: { run_id: 'run-42', durable: { job_status: 'RETRY_WAIT' } } };
    if (command === 'resume') return { exitCode: 0, result: { run_id: 'run-42', state: 'RUNNING', resumed: true } };
    if (command === 'wait') return { exitCode: 0, result: { run_id: 'run-42', durable: { job_status: 'DONE' } } };
    if (command === 'inspect') return { exitCode: 0, result: { run: { run_id: 'run-42' }, artifacts: {} } };
    throw new Error(`UNEXPECTED_COMMAND:${command}`);
  };

  const start = await invokeDebugAITool('debugai_start', {
    request: 'find the durable failure', repo: '/repo/a',
  }, { execute });
  assert.equal(JSON.parse(start.content[0].text).result.run_id, 'run-42');

  for (const [tool, input] of [
    ['debugai_status', { run_id: 'run-42' }],
    ['debugai_resume', { run_id: 'run-42' }],
    ['debugai_wait', { run_id: 'run-42', interval_ms: 250, timeout_ms: 120000 }],
    ['debugai_inspect', { run_id: 'run-42' }],
  ]) {
    const result = await invokeDebugAITool(tool, input, { execute });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0].text).tool, tool);
  }

  assert.deepEqual(calls, [
    ['start', 'find the durable failure', '--repo', '/repo/a'],
    ['status', 'run-42'],
    ['resume', '--run-id', 'run-42'],
    ['wait', 'run-42', '--interval-ms', '250', '--timeout-ms', '120000'],
    ['inspect', 'run-42'],
  ]);
  assert.equal(calls.flat().some(value => /approve|apply/i.test(String(value))), false);
});

test('MCP continuation execution errors stay fail-closed and do not synthesize another run id', async () => {
  const result = await invokeDebugAITool('debugai_resume', { run_id: 'run-original' }, {
    execute: async (args) => {
      assert.deepEqual(args, ['resume', '--run-id', 'run-original']);
      const error = new Error('RUN_NOT_RECOVERABLE:BLOCKED');
      error.status = 409;
      throw error;
    },
  });
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.tool, 'debugai_resume');
  assert.equal(payload.status, 409);
  assert.match(payload.error, /RUN_NOT_RECOVERABLE:BLOCKED/);
  assert.doesNotMatch(payload.error, /run-[0-9a-f]{8}/i);
});

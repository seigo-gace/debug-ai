import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { EXPOSED_TOOLS } from '../server.mjs';

function inheritedEnv(extra = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')),
    ...extra,
  };
}

async function createHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, source: 'mcp-stdio-test' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('real stdio MCP handshake lists guarded tools and calls health', { timeout: 20000 }, async () => {
  const mock = await createHealthServer();
  const client = new Client({ name: 'debugai-mcp-regression', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/debugai-mcp.mjs'],
    cwd: process.cwd(),
    env: inheritedEnv({ DEBUGAI_URL: mock.url }),
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...EXPOSED_TOOLS].sort());
    assert.equal(names.some((name) => /approve|apply/i.test(name)), false);

    const serverRead = listed.tools.find(tool => tool.name === 'debugai_server_read');
    assert.deepEqual(Object.keys(serverRead.inputSchema.properties).sort(), ['arguments', 'command_id', 'repo']);
    assert.equal(serverRead.inputSchema.additionalProperties, false);
    const shell = await client.callTool({ name: 'debugai_server_read', arguments: { command_id: 'project.pwd', shell: 'echo unsafe' } });
    assert.equal(shell.isError, true);
    for (const [name, args] of [
      ['debugai_server_read', { command_id: 'project.pwd' }],
      ['debugai_server_status', { id: 'cmd_x' }],
      ['debugai_gitops_request', { action: 'publish', human_approved: false }],
      ['debugai_gitops_status', { repo: '/workspace/debug-ai', id: 'gitops_x' }],
    ]) {
      const failure = await client.callTool({ name, arguments: args });
      assert.equal(failure.isError, true);
      assert.equal(JSON.parse(failure.content[0].text).error, 'NOT_FOUND');
    }

    const health = await client.callTool({ name: 'debugai_health', arguments: {} });
    assert.notEqual(health.isError, true);
    const text = health.content.find((block) => block.type === 'text')?.text;
    assert.ok(text);
    const payload = JSON.parse(text);
    assert.equal(payload.schema, 'debugai.mcp-result/v1');
    assert.equal(payload.tool, 'debugai_health');
    assert.equal(payload.result.ok, true);
    assert.equal(payload.result.source, 'mcp-stdio-test');
  } finally {
    await client.close().catch(() => {});
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

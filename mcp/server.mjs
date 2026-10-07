import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const require = createRequire(import.meta.url);
const { execute: defaultExecute } = require('../bin/debugai.js');

export const MCP_SERVER_INFO = Object.freeze({
  name: 'debugai',
  version: '0.3.0-server',
});

function listToFlag(values) {
  return Array.isArray(values) && values.length ? values.join(',') : null;
}

export function buildCliArgs(toolName, input = {}) {
  switch (toolName) {
    case 'debugai_server_read':
      return ['server-command', 'request', '--input-json', JSON.stringify(input)];
    case 'debugai_server_status':
      return ['server-command', 'status', '--input-json', JSON.stringify(input)];
    case 'debugai_gitops_request':
      return ['gitops', 'request', '--input-json', JSON.stringify(input)];
    case 'debugai_gitops_status':
      return ['gitops', 'status', '--input-json', JSON.stringify(input)];
    case 'debugai_health':
      return ['health'];
    case 'debugai_analyze': {
      const args = ['analyze', input.request, '--repo', input.repo];
      if (input.run_id) args.push('--run-id', input.run_id);
      return args;
    }
    case 'debugai_start':
      return ['start', input.request, '--repo', input.repo];
    case 'debugai_resume':
      return ['resume', '--run-id', input.run_id];
    case 'debugai_wait': {
      const args = ['wait', input.run_id];
      if (input.interval_ms !== undefined) args.push('--interval-ms', String(input.interval_ms));
      if (input.timeout_ms !== undefined) args.push('--timeout-ms', String(input.timeout_ms));
      return args;
    }
    case 'debugai_patch_candidate': {
      const args = ['patch', input.purpose, '--run-id', input.run_id];
      const paths = listToFlag(input.paths);
      if (paths) args.push('--paths', paths);
      return args;
    }
    case 'debugai_verify': {
      const args = ['verify', '--repo', input.repo];
      if (input.task) args.push(input.task);
      const paths = listToFlag(input.paths);
      const scope = listToFlag(input.change_scope);
      if (paths) args.push('--paths', paths);
      if (scope) args.push('--change-scope', scope);
      return args;
    }
    case 'debugai_status':
      return ['status', input.run_id];
    case 'debugai_inspect':
      return ['inspect', input.run_id];
    default:
      throw new Error(`MCP_TOOL_UNKNOWN:${toolName}`);
  }
}

function toToolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

export async function invokeDebugAITool(toolName, input, { execute = defaultExecute, env = process.env, cwd = process.cwd() } = {}) {
  try {
    const cliArgs = buildCliArgs(toolName, input);
    const output = await execute(cliArgs, { env, cwd });
    const result = toToolResult({
      schema: 'debugai.mcp-result/v1',
      tool: toolName,
      exit_code: output.exitCode,
      result: output.result,
    });
    if (['server-command', 'gitops'].includes(cliArgs[0]) && output.exitCode !== 0) result.isError = true;
    return result;
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          schema: 'debugai.mcp-error/v1',
          tool: toolName,
          error: String(error?.message || error),
          status: error?.status ?? null,
        }, null, 2),
      }],
    };
  }
}

const repoSchema = z.string().min(1).describe('Repository path visible to the parent host; DebugAI maps it to its server workspace.');
const runIdSchema = z.string().min(1).describe('Exact DebugAI run_id. MCP never relies on implicit session state for run-scoped tools.');
const pathsSchema = z.array(z.string().min(1)).max(200).optional();

export function createDebugAIMcpServer({ execute = defaultExecute, env = process.env, cwd = process.cwd() } = {}) {
  const server = new McpServer(MCP_SERVER_INFO);
  const invoke = (name) => async (input) => invokeDebugAITool(name, input, { execute, env, cwd });

  server.registerTool('debugai_health', {
    description: 'Read DebugAI runtime health. No repository mutation.',
    inputSchema: z.object({}),
  }, invoke('debugai_health'));

  server.registerTool('debugai_analyze', {
    description: 'Run the guarded DebugAI analysis workflow for a repository failure/request. Does not approve or apply a patch.',
    inputSchema: z.object({
      request: z.string().min(1),
      repo: repoSchema,
      run_id: z.string().min(1).optional(),
    }),
  }, invoke('debugai_analyze'));

  server.registerTool('debugai_start', {
    description: 'Start a durable asynchronous DebugAI analysis run. Does not approve or apply a patch.',
    inputSchema: z.object({
      request: z.string().min(1),
      repo: repoSchema,
    }),
  }, invoke('debugai_start'));

  server.registerTool('debugai_resume', {
    description: 'Resume an existing durable DebugAI analysis run by exact run_id.',
    inputSchema: z.object({ run_id: runIdSchema }),
  }, invoke('debugai_resume'));

  server.registerTool('debugai_wait', {
    description: 'Wait/poll until a DebugAI run reaches a terminal or blocked state.',
    inputSchema: z.object({
      run_id: runIdSchema,
      interval_ms: z.number().int().min(10).max(60000).optional(),
      timeout_ms: z.number().int().min(1000).max(3600000).optional(),
    }),
  }, invoke('debugai_wait'));

  server.registerTool('debugai_patch_candidate', {
    description: 'Create a patch candidate for an analyzed run. Candidate generation only; this MCP server exposes no approve/apply shortcut.',
    inputSchema: z.object({
      purpose: z.string().min(1),
      run_id: runIdSchema,
      paths: pathsSchema,
    }),
  }, invoke('debugai_patch_candidate'));

  server.registerTool('debugai_verify', {
    description: 'Execute DebugAI read-only deterministic verification for an explicit repository path.',
    inputSchema: z.object({
      repo: repoSchema,
      paths: pathsSchema,
      change_scope: pathsSchema,
      task: z.string().optional(),
    }),
  }, invoke('debugai_verify'));

  server.registerTool('debugai_status', {
    description: 'Read current status for an exact DebugAI run_id.',
    inputSchema: z.object({ run_id: runIdSchema }),
  }, invoke('debugai_status'));

  server.registerTool('debugai_inspect', {
    description: 'Read retained/redacted inspection data for an exact DebugAI run_id.',
    inputSchema: z.object({ run_id: runIdSchema }),
  }, invoke('debugai_inspect'));

  server.registerTool('debugai_server_read', {
    description: 'Queue a bounded Server Command read using the existing service contract. command_id is service-validated; no shell string is accepted.',
    inputSchema: z.strictObject({
      command_id: z.string().min(1),
      repo: z.string().min(1).optional(),
      arguments: z.array(z.string()).optional(),
    }),
  }, invoke('debugai_server_read'));

  server.registerTool('debugai_server_status', {
    description: 'Read existing Server Command queue status by exact request id.',
    inputSchema: z.strictObject({ id: z.string().min(1) }),
  }, invoke('debugai_server_status'));

  server.registerTool('debugai_gitops_request', {
    description: 'Delegate the existing GitOps request object unchanged. Existing service and host approval, exact SHA, candidate, scope and remote readback gates remain authoritative.',
    inputSchema: z.record(z.string(), z.unknown()),
  }, invoke('debugai_gitops_request'));

  server.registerTool('debugai_gitops_status', {
    description: 'Read existing GitOps request status using its repo/id contract.',
    inputSchema: z.strictObject({ repo: z.string().min(1), id: z.string().min(1) }),
  }, invoke('debugai_gitops_status'));

  return server;
}

export const EXPOSED_TOOLS = Object.freeze([
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

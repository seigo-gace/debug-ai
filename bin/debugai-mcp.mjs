#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDebugAIMcpServer } from '../mcp/server.mjs';

void serveStdio(() => createDebugAIMcpServer());
console.error('DebugAI MCP server running on stdio');

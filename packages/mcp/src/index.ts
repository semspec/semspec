// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The MCP server of Semspec. It serves the tools and the resources over stdio.
// The server reads the inputs again on each tool call and on each resource read, so an edit shows at once.
// Stdout carries only protocol messages. The server writes its logs to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Readable, Writable } from 'node:stream';
import { QueryError } from '@semspec/core';
import { TOOLS, callTool, type Loaded, type Loader } from './tools';

export { TOOLS, callTool, type Loaded, type LoadedGraph, type Loader } from './tools';

const INSTRUCTIONS =
  'Semspec serves a requirement graph. Call "schema" first to learn the kinds, the edges and the vocabularies. ' +
  'Use "search" to find nodes by words, "get" for 1 node, "trace" for its place in the tree, "walk" for its neighbours by edge, "slice" for the brief of a task on 1 node, "impact" for what depends on it, "gaps" for what is missing, "coverage" for the status of the conditions in a selection, and "validate" before you add a node. ' +
  'A workspace has several graphs. Pass "graph" to pick one. The resources semspec://<graph>/profile and semspec://<graph>/vocabularies hold the profile and the vocabularies.';

const RESOURCE_PATH = /^semspec:\/\/([^/]+)\/(profile|vocabularies)$/;

export interface McpOptions {
  version: string;
  loader: Loader;
}

function resourcesOf(loaded: Loaded) {
  return loaded.graphs.flatMap((g) => [
    { uri: `semspec://${encodeURIComponent(g.id)}/profile`, name: `${g.id} profile`, description: `The profile of the graph "${g.id}" (${g.label}) as JSON.`, mimeType: 'application/json' },
    { uri: `semspec://${encodeURIComponent(g.id)}/vocabularies`, name: `${g.id} vocabularies`, description: `The vocabularies of the graph "${g.id}" with their codes, labels and definitions, as JSON.`, mimeType: 'application/json' },
  ]);
}

function readResource(loaded: Loaded, uri: string) {
  const match = RESOURCE_PATH.exec(uri);
  if (!match) throw new QueryError(`Unknown resource "${uri}". A resource is semspec://<graph>/profile or semspec://<graph>/vocabularies.`);
  const id = decodeURIComponent(match[1]);
  const g = loaded.graphs.find((x) => x.id === id);
  if (!g) throw new QueryError(`Unknown graph "${id}". The graphs are: ${loaded.graphs.map((x) => x.id).join(', ')}.`);
  const body = match[2] === 'profile' ? g.profile : g.profile.vocabularies ?? {};
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body) }] };
}

export function createMcpServer(options: McpOptions): Server {
  const server = new Server({ name: 'semspec', version: options.version }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callTool(options.loader, request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resourcesOf(options.loader()) }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => readResource(options.loader(), request.params.uri));
  return server;
}

// Serves on stdio until the input ends or the client closes the connection.
export async function serveStdio(options: McpOptions, stdin: Readable = process.stdin, stdout: Writable = process.stdout): Promise<void> {
  const server = createMcpServer(options);
  const closed = new Promise<void>((done) => {
    server.onclose = () => done();
    stdin.once('end', () => done());
  });
  await server.connect(new StdioServerTransport(stdin, stdout));
  await closed;
  await server.close().catch(() => undefined);
}

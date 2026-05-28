import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Services } from '../server/app.js';
import { mcpTools } from './tools.js';
import { AppError } from '../shared/errors.js';

export async function registerMcp(app: FastifyInstance, services: Services): Promise<void> {
  const tools = mcpTools(services);

  app.all('/mcp', async (req, reply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: { code: 'unauthorized', message: 'missing bearer' } });
    }
    const token = header.slice(7);
    const user = token.startsWith('cs_s_')
      ? await services.auth.resolveSessionToken(token)
      : await services.auth.resolveApiKey(token);
    if (!user) return reply.status(401).send({ error: { code: 'unauthorized', message: 'invalid token' } });
    const ctx = { userId: user.id, authorKind: token.startsWith('cs_s_') ? 'human' as const : 'agent' as const };

    const server = new Server({ name: 'agentcrew', version: '0.1.0' }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(tools).map(([name, t]) => ({
        name, description: t.description,
        inputSchema: { type: 'object' }, // SDK derives from zod via separate path; v1 uses permissive schema
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name as keyof typeof tools;
      const tool = tools[name];
      if (!tool) throw new AppError('not_found', `unknown tool ${String(name)}`, 404);
      try {
        const result = await tool.handler(ctx, req.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e: any) {
        const code = e?.code ?? 'internal_error';
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: { code, message: e.message } }) }],
        };
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
}

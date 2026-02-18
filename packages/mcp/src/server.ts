import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RecallIndexer, RecallSearch, DEFAULT_SESSIONS_PATH, DEFAULT_DB_PATH } from '@cc-recall/core';
import {
  TOOL_DEFINITIONS,
  handleSearchSessions,
  handleGetSessionContext,
  handleListDecisions,
  handleGetSessionSummary,
  type SearchSessionsInput,
  type GetSessionContextInput,
  type ListDecisionsInput,
  type GetSessionSummaryInput,
} from './tools.js';

export async function createServer(): Promise<Server> {
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const sessionsPath = process.env.SESSIONS_PATH ?? DEFAULT_SESSIONS_PATH;

  const indexer = new RecallIndexer({ dbPath, sessionsPath });
  const store = indexer.getStore();
  const search = new RecallSearch(store);

  const server = new Server(
    { name: 'cc-recall', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let text: string;

      switch (name) {
        case 'search_sessions':
          text = await handleSearchSessions(args as unknown as SearchSessionsInput, search);
          break;
        case 'get_session_context':
          text = handleGetSessionContext(args as unknown as GetSessionContextInput, store);
          break;
        case 'list_decisions':
          text = handleListDecisions(args as unknown as ListDecisionsInput, store);
          break;
        case 'get_session_summary':
          text = handleGetSessionSummary(args as unknown as GetSessionSummaryInput, store);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

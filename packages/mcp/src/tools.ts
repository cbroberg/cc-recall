import type { RecallSearch, RecallStore, ChunkType } from '@cc-recall/core';

export const TOOL_DEFINITIONS = [
  {
    name: 'search_sessions',
    description:
      'Semantic search across all Claude Code session transcripts. Returns relevant chunks with context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query in natural language, e.g. "how did we fix the dark mode issue"',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (optional)',
        },
        chunkType: {
          type: 'string',
          enum: ['decision', 'code-change', 'error-fix', 'architecture', 'conversation'],
          description: 'Filter by chunk type (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_session_context',
    description:
      'Get full context for a specific session — summary, timeline, key decisions and code changes.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session UUID (from search results)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'list_decisions',
    description: 'List all documented decisions across sessions for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project name (optional — all projects if omitted)',
        },
        limit: {
          type: 'number',
          description: 'Max number of results (default: 20)',
        },
      },
    },
  },
  {
    name: 'get_session_summary',
    description:
      'Generate a short summary of a session — what was done, which files were changed, key decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session UUID',
        },
      },
      required: ['sessionId'],
    },
  },
] as const;

// --- Tool input types ---

export interface SearchSessionsInput {
  query: string;
  project?: string;
  chunkType?: ChunkType;
  limit?: number;
}

export interface GetSessionContextInput {
  sessionId: string;
}

export interface ListDecisionsInput {
  project?: string;
  limit?: number;
}

export interface GetSessionSummaryInput {
  sessionId: string;
}

// --- Tool handlers ---

export async function handleSearchSessions(
  input: SearchSessionsInput,
  search: RecallSearch,
): Promise<string> {
  const results = await search.search(input.query, {
    project: input.project,
    chunkType: input.chunkType,
    limit: input.limit ?? 5,
  });

  if (results.length === 0) {
    return 'No results found.';
  }

  return results
    .map((r, i) => {
      const score = (r.score * 100).toFixed(1);
      return [
        `## Result ${i + 1} (${score}% match)`,
        `**Type:** ${r.chunk.type}`,
        `**Project:** ${r.session.projectName}`,
        `**Session:** ${r.chunk.sessionId}`,
        `**Summary:** ${r.chunk.summary}`,
        '',
        r.chunk.content,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

export function handleGetSessionContext(
  input: GetSessionContextInput,
  store: RecallStore,
): string {
  const session = store.getSession(input.sessionId);
  if (!session) {
    return `Session ${input.sessionId} not found.`;
  }

  const chunks = store.getChunksBySession(input.sessionId);
  const decisions = chunks.filter((c) => c.type === 'decision');
  const codeChanges = chunks.filter((c) => c.type === 'code-change');
  const errorFixes = chunks.filter((c) => c.type === 'error-fix');
  const allFiles = [...new Set(chunks.flatMap((c) => c.metadata.filesReferenced))];

  const parts = [
    `# Session: ${session.sessionId}`,
    `**Project:** ${session.projectName}`,
    `**Date:** ${session.firstTimestamp} → ${session.lastTimestamp}`,
    `**Messages:** ${session.messageCount} | **Chunks:** ${session.chunkCount}`,
  ];

  if (decisions.length > 0) {
    parts.push('', `## Decisions (${decisions.length})`);
    parts.push(...decisions.map((d) => `- ${d.summary}`));
  }
  if (codeChanges.length > 0) {
    parts.push('', `## Code Changes (${codeChanges.length})`);
    parts.push(...codeChanges.map((c) => `- ${c.summary}`));
  }
  if (errorFixes.length > 0) {
    parts.push('', `## Error Fixes (${errorFixes.length})`);
    parts.push(...errorFixes.map((e) => `- ${e.summary}`));
  }
  if (allFiles.length > 0) {
    parts.push('', '## Files Referenced');
    parts.push(...allFiles.slice(0, 20).map((f) => `- ${f}`));
  }

  return parts.join('\n');
}

export function handleListDecisions(input: ListDecisionsInput, store: RecallStore): string {
  const decisions = store.getDecisions(input.project, input.limit ?? 20);

  if (decisions.length === 0) {
    return input.project
      ? `No decisions found for project "${input.project}".`
      : 'No decisions found.';
  }

  return decisions
    .map((d) => `- **[${d.sessionId.slice(0, 8)}]** ${d.summary}`)
    .join('\n');
}

export function handleGetSessionSummary(
  input: GetSessionSummaryInput,
  store: RecallStore,
): string {
  const session = store.getSession(input.sessionId);
  if (!session) {
    return `Session ${input.sessionId} not found.`;
  }

  const chunks = store.getChunksBySession(input.sessionId);
  const allFiles = [...new Set(chunks.flatMap((c) => c.metadata.filesReferenced))];
  const allTools = [...new Set(chunks.flatMap((c) => c.metadata.toolsUsed))];
  const keyChunks = chunks.filter((c) => c.type !== 'conversation').slice(0, 5);

  const parts = [
    `# Summary: ${session.sessionId}`,
    `**Project:** ${session.projectName}`,
    `**Date:** ${session.firstTimestamp}`,
    `**Duration:** ${session.firstTimestamp} → ${session.lastTimestamp}`,
  ];

  if (keyChunks.length > 0) {
    parts.push('', '## Key Activities');
    parts.push(...keyChunks.map((c) => `- [${c.type}] ${c.summary}`));
  }
  if (allFiles.length > 0) {
    parts.push('', '## Files Changed');
    parts.push(...allFiles.slice(0, 10).map((f) => `- ${f}`));
  }
  if (allTools.length > 0) {
    parts.push('', `## Tools Used: ${allTools.join(', ')}`);
  }

  return parts.join('\n');
}

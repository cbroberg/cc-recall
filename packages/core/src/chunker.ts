import { randomUUID } from 'node:crypto';
import type { ParsedSession, IndexedEntry, SessionChunk, ChunkType, ToolCallEntry } from './types.js';
import { extractText, extractToolNames, extractFilePaths } from './parser.js';
import { redactSecrets } from './redact.js';

const DECISION_KEYWORDS = [
  'vi valgte', 'vi vælger', 'beslutning:', 'fordi', 'anbefaling:',
  'we chose', 'we decided', 'decision:', 'because', 'recommendation:',
  'reason:', 'rationale:', 'therefore', 'thus we',
];

const ARCHITECTURE_TERMS = [
  'pattern', 'interface', 'schema', 'migration', 'dependency',
  'architecture', 'design', 'api', 'database', 'service', 'component',
  'module', 'package', 'repository', 'singleton', 'factory', 'adapter',
  'middleware', 'endpoint', 'monorepo', 'refactor',
];

const CODE_CHANGE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// ~200–800 tokens
const MIN_CHUNK_CHARS = 200;
const MAX_CHUNK_CHARS = 3200;
const AVG_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

function isDecision(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isArchitecture(text: string): boolean {
  if (text.length < 500) return false;
  const lower = text.toLowerCase();
  const termCount = ARCHITECTURE_TERMS.filter((t) => lower.includes(t)).length;
  return termCount >= 2;
}

function getTextFromEntry(entry: IndexedEntry): string {
  return extractText(entry.message?.content as Parameters<typeof extractText>[0]);
}

function getToolResultText(entry: IndexedEntry): string {
  const result = entry.result;
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.content === 'string') return r.content;
    return JSON.stringify(result).slice(0, 500);
  }
  return '';
}

function detectChunkType(entries: IndexedEntry[]): ChunkType {
  const assistantEntries = entries.filter((e) => e.type === 'assistant');
  const toolNames = assistantEntries.flatMap((e) => extractToolNames(e));
  const toolSet = new Set(toolNames);

  const resultTexts = entries
    .filter((e) => e.type === 'tool_result')
    .map(getToolResultText)
    .join('\n');

  const hasError = /error|exception|failed|cannot|could not|not found/i.test(resultTexts);
  const hasCodeChange = [...toolSet].some((t) => CODE_CHANGE_TOOLS.has(t));

  if (hasError && hasCodeChange) return 'error-fix';
  if (hasCodeChange) return 'code-change';

  const assistantText = assistantEntries.map(getTextFromEntry).join('\n');
  if (isDecision(assistantText)) return 'decision';
  if (isArchitecture(assistantText)) return 'architecture';

  return 'conversation';
}

function buildChunkContent(entries: IndexedEntry[]): string {
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'human') {
      const text = getTextFromEntry(entry);
      if (text) parts.push(`[User]\n${text}`);
    } else if (entry.type === 'assistant') {
      const text = getTextFromEntry(entry);
      if (text) parts.push(`[Assistant]\n${text}`);
    } else if (entry.type === 'tool_result') {
      const text = getToolResultText(entry);
      if (text) {
        const truncated = text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
        parts.push(`[Tool Result]\n${truncated}`);
      }
    }
  }
  return parts.join('\n\n');
}

function buildSummary(entries: IndexedEntry[], type: ChunkType): string {
  const assistantText = entries
    .filter((e) => e.type === 'assistant')
    .map(getTextFromEntry)
    .join(' ')
    .slice(0, 200);

  const userText = entries
    .filter((e) => e.type === 'human')
    .map(getTextFromEntry)
    .join(' ')
    .slice(0, 100);

  const prefix: Record<ChunkType, string> = {
    decision: 'Decision:',
    'code-change': 'Code change:',
    'error-fix': 'Error fix:',
    architecture: 'Architecture:',
    conversation: 'Discussion:',
  };

  return `${prefix[type]} ${userText || assistantText}`.slice(0, 250);
}

function buildMetadata(entries: IndexedEntry[]) {
  const toolsUsed: string[] = [];
  const filesReferenced: string[] = [];

  for (const entry of entries) {
    if (entry.type === 'assistant') {
      toolsUsed.push(...extractToolNames(entry));
      filesReferenced.push(...extractFilePaths(entry));
    }
  }

  const allText = buildChunkContent(entries).toLowerCase();
  const tagCandidates = [
    'typescript', 'javascript', 'python', 'sql', 'docker',
    'react', 'node', 'pnpm', 'npm', 'git', 'api', 'database',
    'sqlite', 'mcp', 'embedding', 'vector', 'search',
  ];
  const tags = tagCandidates.filter((tag) => allText.includes(tag));

  return {
    toolsUsed: [...new Set(toolsUsed)],
    filesReferenced: [...new Set(filesReferenced)],
    tags,
  };
}

function createChunk(entries: IndexedEntry[], session: ParsedSession): SessionChunk {
  const type = detectChunkType(entries);
  const rawContent = buildChunkContent(entries);
  const content = redactSecrets(rawContent);
  const summary = redactSecrets(buildSummary(entries, type));
  const metadata = buildMetadata(entries);

  const timestamps = entries
    .filter((e) => e.timestamp)
    .map((e) => e.timestamp as string);

  return {
    id: randomUUID(),
    sessionId: session.sessionId,
    projectPath: session.projectPath,
    type,
    content,
    summary,
    messageRange: {
      startIndex: entries[0].index,
      endIndex: entries[entries.length - 1].index,
      startTimestamp: timestamps[0] ?? '',
      endTimestamp: timestamps[timestamps.length - 1] ?? '',
    },
    metadata,
    createdAt: new Date(),
  };
}

/**
 * Split a session into semantic chunks.
 *
 * Groups entries into interaction windows (human → assistant + tool_results),
 * merges windows that are too small, and splits windows that are too large.
 */
export function chunkSession(session: ParsedSession): SessionChunk[] {
  const { entries } = session;
  if (entries.length === 0) return [];

  const chunks: SessionChunk[] = [];

  // Group entries into interaction windows: each new human message starts a window
  const windows: IndexedEntry[][] = [];
  let current: IndexedEntry[] = [];

  for (const entry of entries) {
    if (entry.type === 'human' && current.length > 0) {
      windows.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) windows.push(current);

  // Merge small windows, split large ones
  let buffer: IndexedEntry[] = [];

  for (const window of windows) {
    const windowContent = buildChunkContent(window);

    // If this window alone exceeds max, emit it as its own chunk immediately
    if (windowContent.length > MAX_CHUNK_CHARS) {
      if (buffer.length > 0) {
        chunks.push(createChunk(buffer, session));
        buffer = [];
      }
      chunks.push(createChunk(window, session));
      continue;
    }

    buffer.push(...window);
    const bufferContent = buildChunkContent(buffer);

    if (bufferContent.length >= MIN_CHUNK_CHARS) {
      if (bufferContent.length <= MAX_CHUNK_CHARS) {
        chunks.push(createChunk(buffer, session));
        buffer = [];
      } else {
        // Buffer too large — emit everything before this window, keep this window
        const prev = buffer.slice(0, buffer.length - window.length);
        if (prev.length > 0) chunks.push(createChunk(prev, session));
        buffer = [...window];
      }
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    chunks.push(createChunk(buffer, session));
  }

  return chunks;
}

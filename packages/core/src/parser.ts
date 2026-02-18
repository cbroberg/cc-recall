import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname } from 'node:path';
import type { RawEntry, IndexedEntry, ParsedSession, ContentBlock, ToolCallEntry } from './types.js';

/**
 * Extract plain text from message content (string or content block array).
 */
export function extractText(content: string | ContentBlock[] | undefined | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block as string;
        if (block && typeof block === 'object') {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') return b.text;
          if (typeof b.content === 'string') return b.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Extract tool names from an assistant entry's tool_calls.
 */
export function extractToolNames(entry: RawEntry): string[] {
  const calls = entry.message?.tool_calls;
  if (!calls || !Array.isArray(calls)) return [];
  return (calls as ToolCallEntry[])
    .map((tc) => tc.name ?? tc.function?.name ?? '')
    .filter(Boolean);
}

/**
 * Extract file paths referenced in tool call inputs.
 */
export function extractFilePaths(entry: RawEntry): string[] {
  const calls = entry.message?.tool_calls;
  if (!calls || !Array.isArray(calls)) return [];
  const paths: string[] = [];
  for (const tc of calls as ToolCallEntry[]) {
    const input = tc.input;
    if (!input) continue;
    if (typeof input.file_path === 'string') paths.push(input.file_path);
    if (typeof input.path === 'string') paths.push(input.path);
  }
  return paths;
}

/**
 * Parse a Claude Code JSONL session file.
 * Gracefully skips malformed lines and sidechain entries.
 */
export async function parseSessionFile(filePath: string): Promise<ParsedSession> {
  const sessionId = basename(filePath, '.jsonl');
  const projectPath = basename(dirname(filePath));

  const entries: IndexedEntry[] = [];
  let firstTimestamp = '';
  let lastTimestamp = '';

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let index = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      index++;
      continue;
    }
    try {
      const entry = JSON.parse(trimmed) as RawEntry;
      // Skip sidechain entries (internal tool orchestration, not user-facing)
      if (entry.isSidechain) {
        index++;
        continue;
      }
      const indexed: IndexedEntry = { ...entry, index };
      entries.push(indexed);
      if (entry.timestamp) {
        if (!firstTimestamp) firstTimestamp = entry.timestamp;
        lastTimestamp = entry.timestamp;
      }
    } catch {
      // Malformed line — skip silently
    }
    index++;
  }

  const messageCount = entries.filter(
    (e) => e.type === 'human' || e.type === 'assistant',
  ).length;

  return {
    sessionId,
    projectPath,
    filePath,
    entries,
    firstTimestamp,
    lastTimestamp,
    messageCount,
  };
}

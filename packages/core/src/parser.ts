import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname } from 'node:path';
import type { RawEntry, IndexedEntry, ParsedSession, ContentBlock } from './types.js';

/**
 * Extract plain text from message content.
 * Only returns text from `type: "text"` blocks — skips tool_use and tool_result blocks.
 */
export function extractText(content: string | ContentBlock[] | undefined | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => typeof b === 'object' && b !== null && b.type === 'text')
      .map((b) => (b as ContentBlock).text ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Extract tool names from an assistant entry's content blocks (type: "tool_use").
 */
export function extractToolNames(entry: RawEntry): string[] {
  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return [];
  return (content as ContentBlock[])
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b) => b.name!)
    .filter(Boolean);
}

/**
 * Extract file paths from tool_use input fields in an assistant entry.
 */
export function extractFilePaths(entry: RawEntry): string[] {
  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return [];
  const paths: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' && block.input) {
      const input = block.input;
      if (typeof input.file_path === 'string') paths.push(input.file_path);
      if (typeof input.path === 'string') paths.push(input.path);
    }
  }
  return paths;
}

/**
 * Extract tool result text from a user entry's content blocks (type: "tool_result").
 */
export function extractToolResults(entry: RawEntry): string {
  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((b) => b.type === 'tool_result')
    .map((b) => {
      if (typeof b.content === 'string') return b.content;
      if (Array.isArray(b.content)) {
        return (b.content as ContentBlock[])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Parse a Claude Code JSONL session file.
 * Gracefully skips malformed lines, sidechain entries, and metadata entries.
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

      // Skip sidechain entries and non-conversation entries
      if (entry.isSidechain) {
        index++;
        continue;
      }

      // Only keep user and assistant messages
      if (entry.type !== 'user' && entry.type !== 'assistant') {
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

  const messageCount = entries.length;

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

import { createHash } from 'node:crypto';
import { statSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { EmbeddingProviderInterface, IndexOptions, SessionMetadata } from './types.js';
import { parseSessionFile } from './parser.js';
import { chunkSession } from './chunker.js';
import { RecallStore, DEFAULT_DB_PATH } from './store.js';
import { RecallEmbeddingProvider } from './embeddings.js';

export const DEFAULT_SESSIONS_PATH = `${homedir()}/.claude/projects`;

function fileHash(filePath: string): string {
  // Fast change detection: size + mtime (avoids reading the full file)
  const stat = statSync(filePath);
  return createHash('sha256')
    .update(`${stat.size}:${stat.mtimeMs}`)
    .digest('hex');
}

function projectNameFromPath(projectPath: string): string {
  // projectPath is e.g. '-Users-cb-Apps-cbroberg-codepromptmaker'
  const parts = projectPath.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? projectPath;
}

export class RecallIndexer {
  private store: RecallStore;
  private embedder: EmbeddingProviderInterface;
  private sessionsPath: string;

  constructor(options: IndexOptions = {}) {
    const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.sessionsPath = options.sessionsPath ?? DEFAULT_SESSIONS_PATH;
    this.store = new RecallStore(dbPath);
    this.embedder = new RecallEmbeddingProvider(options.embeddingModel);
  }

  /**
   * Index a single JSONL file.
   * Skips if hash matches (already indexed, file unchanged).
   * Re-indexes if file has changed.
   */
  async indexFile(filePath: string): Promise<{ skipped: boolean; chunks: number }> {
    const stat = statSync(filePath);
    if (stat.size === 0) return { skipped: true, chunks: 0 };

    const sessionId = basename(filePath, '.jsonl');
    const hash = fileHash(filePath);

    const existingHash = this.store.getSessionHash(sessionId);
    if (existingHash === hash) {
      return { skipped: true, chunks: 0 };
    }

    // Clear old data for this session before re-indexing
    if (existingHash) {
      this.store.deleteSessionChunks(sessionId);
    }

    const session = await parseSessionFile(filePath);
    const chunks = chunkSession(session);

    // Embed each chunk
    for (const chunk of chunks) {
      const result = await this.embedder.embed(chunk.content);
      chunk.embedding = result.vector;
    }

    const projectPath = basename(dirname(filePath));
    const meta: SessionMetadata = {
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      projectName: projectNameFromPath(projectPath),
      filePath,
      fileSize: stat.size,
      fileHash: hash,
      messageCount: session.messageCount,
      firstTimestamp: session.firstTimestamp,
      lastTimestamp: session.lastTimestamp,
      chunkCount: chunks.length,
      indexedAt: new Date(),
    };

    this.store.upsertSession(meta);
    this.store.insertChunks(chunks);

    return { skipped: false, chunks: chunks.length };
  }

  /**
   * Force re-index a file (ignores hash).
   */
  async reindexFile(filePath: string): Promise<{ chunks: number }> {
    const sessionId = basename(filePath, '.jsonl');
    this.store.deleteSessionChunks(sessionId);
    const result = await this.indexFile(filePath);
    return { chunks: result.chunks };
  }

  /**
   * Index all JSONL sessions found under sessionsPath.
   */
  async indexAll(): Promise<{ total: number; indexed: number; skipped: number; errors: number }> {
    const files = this.findAllSessions();
    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    console.log(`[cc-recall] Found ${files.length} session files in ${this.sessionsPath}`);

    for (const file of files) {
      try {
        const result = await this.indexFile(file);
        if (result.skipped) {
          skipped++;
        } else {
          indexed++;
          console.log(`[cc-recall] Indexed ${basename(file)} → ${result.chunks} chunks`);
        }
      } catch (err) {
        errors++;
        console.error(`[cc-recall] Error indexing ${basename(file)}:`, err);
      }
    }

    console.log(
      `[cc-recall] Done. Indexed: ${indexed}, Skipped: ${skipped}, Errors: ${errors}`,
    );
    return { total: files.length, indexed, skipped, errors };
  }

  private findAllSessions(): string[] {
    const files: string[] = [];
    try {
      const projectDirs = readdirSync(this.sessionsPath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(this.sessionsPath, d.name));

      for (const dir of projectDirs) {
        try {
          const jsonlFiles = readdirSync(dir)
            .filter((f) => f.endsWith('.jsonl'))
            .map((f) => join(dir, f));
          files.push(...jsonlFiles);
        } catch {
          // Skip unreadable directories
        }
      }
    } catch (err) {
      console.error('[cc-recall] Error reading sessions path:', err);
    }
    return files;
  }

  getStore(): RecallStore {
    return this.store;
  }
}

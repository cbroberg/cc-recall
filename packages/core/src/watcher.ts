import { watch } from 'chokidar';
import { basename } from 'node:path';
import { RecallIndexer, DEFAULT_SESSIONS_PATH } from './indexer.js';

export class SessionWatcher {
  private sessionsPath: string;
  private indexer: RecallIndexer;

  constructor(indexer: RecallIndexer, sessionsPath?: string) {
    this.indexer = indexer;
    this.sessionsPath = sessionsPath ?? DEFAULT_SESSIONS_PATH;
  }

  start(): void {
    const watcher = watch(`${this.sessionsPath}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after last write before processing
        pollInterval: 500,
      },
    });

    watcher.on('add', async (path) => {
      console.log(`[cc-recall] New session: ${basename(path)}`);
      try {
        const result = await this.indexer.indexFile(path);
        console.log(`[cc-recall] Indexed ${result.chunks} chunks from ${basename(path)}`);
      } catch (err) {
        console.error(`[cc-recall] Error indexing ${basename(path)}:`, err);
      }
    });

    watcher.on('change', async (path) => {
      console.log(`[cc-recall] Session updated: ${basename(path)}`);
      try {
        const result = await this.indexer.reindexFile(path);
        console.log(`[cc-recall] Re-indexed ${result.chunks} chunks from ${basename(path)}`);
      } catch (err) {
        console.error(`[cc-recall] Error re-indexing ${basename(path)}:`, err);
      }
    });

    console.log(`[cc-recall] Watching for sessions in ${this.sessionsPath}`);
  }
}

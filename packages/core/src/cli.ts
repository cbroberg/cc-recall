import { RecallIndexer, DEFAULT_SESSIONS_PATH } from './indexer.js';
import { DEFAULT_DB_PATH } from './store.js';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const command = args[0];

const SESSIONS_PATH = process.env.SESSIONS_PATH ?? DEFAULT_SESSIONS_PATH;
const DB_PATH = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;

async function main(): Promise<void> {
  switch (command) {
    case 'index': {
      console.log(`[cc-recall] Indexing sessions from: ${SESSIONS_PATH}`);
      console.log(`[cc-recall] Database: ${DB_PATH}`);
      const indexer = new RecallIndexer({
        sessionsPath: SESSIONS_PATH,
        dbPath: DB_PATH,
        embeddingModel: EMBEDDING_MODEL,
      });
      const result = await indexer.indexAll();
      console.log(`[cc-recall] Complete: ${result.indexed} indexed, ${result.skipped} skipped, ${result.errors} errors`);
      break;
    }

    case 'status': {
      const { RecallStore } = await import('./store.js');
      const store = new RecallStore(DB_PATH);
      const sessions = store.getAllSessions();
      const totalChunks = sessions.reduce((sum, s) => sum + s.chunkCount, 0);
      console.log(`[cc-recall] Database: ${DB_PATH}`);
      console.log(`[cc-recall] Sessions: ${sessions.length}`);
      console.log(`[cc-recall] Total chunks: ${totalChunks}`);
      const projects = [...new Set(sessions.map((s) => s.projectName))];
      console.log(`[cc-recall] Projects: ${projects.join(', ')}`);
      store.close();
      break;
    }

    default: {
      console.log(`cc-recall CLI

Usage:
  cc-recall index     Index all Claude Code sessions
  cc-recall status    Show indexing status

Environment:
  SESSIONS_PATH   Path to Claude Code sessions (default: ${DEFAULT_SESSIONS_PATH})
  DB_PATH         Path to cc-recall database  (default: ${DEFAULT_DB_PATH})
  EMBEDDING_MODEL Embedding model name        (default: Xenova/all-MiniLM-L6-v2)
`);
    }
  }
}

main().catch((err) => {
  console.error('[cc-recall] Fatal error:', err);
  process.exit(1);
});
